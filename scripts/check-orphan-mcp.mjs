#!/usr/bin/env node
/**
 * Orphan-MCP watchdog: REPORT ONLY, never kills.
 *
 * The failure this exists for: an MCP host exits, its stdio pipes die, and the
 * server keeps running. Measured on this machine, the build without the
 * shutdown fix left two such servers behind — 5950584 ticks (~16.5 CPU-hours)
 * and 15489410 ticks (~43.0 CPU-hours) — reparented to `systemd --user`, at
 * ~96% CPU each. The claude-mem plugin's chroma-mcp child was a third member of
 * the same class (59.5% CPU, 13h56m CPU time, parent daemon itself orphaned).
 *
 * A report-only watchdog is deliberate: this is a generic cross-tool scan, and
 * a script that kills by name on a shared machine will eventually kill a server
 * that is mid-search for someone else. It prints the evidence and exits
 * non-zero, so a human or a supervisor decides.
 *
 * Usage: node scripts/check-orphan-mcp.mjs [--min-cpu PCT] [--window MS] [--json]
 * Exit:  0 = no orphan burns CPU · 1 = at least one orphan is burning CPU
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { argv, exit } from "node:process";

const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i === -1 ? def : argv[i + 1];
};
const MIN_CPU = Number(flag("--min-cpu", "5")); // percent of one core
const WINDOW = Number(flag("--window", "3000")); // ms between the two samples
const JSON_OUT = argv.includes("--json");

const read = (p, fallback = "") => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return fallback;
  }
};

/** utime+stime in clock ticks (Linux). */
function ticks(pid) {
  const raw = read(`/proc/${pid}/stat`);
  if (!raw) return null;
  const f = raw.split(") ")[1]?.split(" ");
  if (!f || f.length < 13) return null;
  const u = Number(f[11]);
  const s = Number(f[12]);
  return Number.isFinite(u) && Number.isFinite(s) ? u + s : null;
}

const cmdline = (pid) => read(`/proc/${pid}/cmdline`).replace(/\0/g, " ").trim();
const ppidOf = (pid) => {
  const raw = read(`/proc/${pid}/stat`);
  const n = Number(raw.split(") ")[1]?.split(" ")[1]);
  return Number.isFinite(n) ? n : null;
};

/** A server is orphaned when its parent is init (1) or systemd --user, or is gone. */
const ORPHAN_PARENTS = new Set([1]);
function isOrphan(pid) {
  const ppid = ppidOf(pid);
  if (ppid === null) return { orphan: false, ppid: null, parent: "(gone)" };
  const parent = cmdline(ppid) || "(gone)";
  const orphan = ORPHAN_PARENTS.has(ppid) || /systemd/.test(parent) || !existsSync(`/proc/${ppid}`);
  return { orphan, ppid, parent };
}

const pids = readdirSync("/proc")
  .filter((d) => /^\d+$/.test(d))
  .map(Number);

const candidates = pids
  .map((pid) => ({ pid, cmd: cmdline(pid) }))
  .filter(({ cmd }) => /mcp/i.test(cmd) && !/check-orphan-mcp|grep/.test(cmd));

const first = new Map();
for (const { pid, cmd } of candidates) {
  const t = ticks(pid);
  if (t === null) continue;
  first.set(pid, { cmd, t0: t, ...isOrphan(pid) });
}
await new Promise((r) => setTimeout(r, WINDOW));

const findings = [];
for (const [pid, info] of first) {
  const t1 = ticks(pid);
  if (t1 === null) continue; // exited during the window: nothing to report
  const delta = t1 - info.t0;
  const cores = delta / 100 / (WINDOW / 1000);
  if (info.orphan && cores * 100 >= MIN_CPU) {
    findings.push({
      pid,
      ppid: info.ppid,
      parent: info.parent.slice(0, 60),
      cores: Number(cores.toFixed(2)),
      total_cpu_s: Math.round(t1 / 100),
      cmd: info.cmd.slice(0, 140),
    });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ window_ms: WINDOW, min_cpu_pct: MIN_CPU, scanned: first.size, findings }, null, 2));
} else {
  console.log(`orphan-mcp watchdog: scanned ${first.size} MCP-ish processes over ${WINDOW}ms, min ${MIN_CPU}% of a core`);
  if (!findings.length) {
    console.log("  no orphaned MCP server is burning CPU");
  } else {
    for (const f of findings) {
      console.log(
        `  BURNING pid=${f.pid} orphan(ppid=${f.ppid} ${f.parent}) ${f.cores} cores, ${f.total_cpu_s}s CPU total`,
      );
      console.log(`          ${f.cmd}`);
    }
    console.log("  report only — kill deliberately, after checking the parent is really gone");
  }
}
exit(findings.length ? 1 : 0);
