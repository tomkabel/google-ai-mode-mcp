#!/usr/bin/env node
/**
 * Point every configured harness at the pinned published package.
 *
 * Default is a DRY RUN: it prints what would change. `--apply` writes, after
 * copying each config file into a timestamped backup directory. The rewrite is
 * per-surface and format-preserving where the file is text (codex TOML, hermes
 * YAML) and a JSON round-trip where it is JSON/JSONC (claude, kimi, zed, kilo).
 *
 * pi needs no entry here: its extension pins the published package in
 * extensions/google-ai-search.ts, which scripts/check-harness-wiring.mjs checks.
 *
 * Usage: node scripts/point-harnesses-at-published.mjs [--apply] [--home DIR]
 *        [--spec NAME@VERSION] [--backup-dir DIR]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i === -1 ? def : argv[i + 1];
};
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = resolve(flag("--home", process.env.HOME ?? "/home/notroot"));
const APPLY = argv.includes("--apply");
const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
const SPEC = flag("--spec", `${pkg.name}@${pkg.version}`);
const ARGV = ["npx", "-y", SPEC];
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const BACKUP_DIR = resolve(flag("--backup-dir", join(HOME, "config-backups", `harness-wiring-${STAMP}`)));

const parseJsonc = (t) => JSON.parse(t.replace(/,(\s*[}\]])/g, "$1"));
const actions = [];

function rewriteJson(id, file, mutate) {
  if (!existsSync(file)) return actions.push({ id, file, action: "skip (absent)" });
  const text = readFileSync(file, "utf8");
  let doc;
  try {
    doc = parseJsonc(text);
  } catch (e) {
    return actions.push({ id, file, action: `FAILED to parse: ${String(e.message).split("\n")[0]}` });
  }
  const before = JSON.stringify(doc);
  mutate(doc);
  if (JSON.stringify(doc) === before) return actions.push({ id, file, action: "already on the pin" });
  if (APPLY) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    copyFileSync(file, join(BACKUP_DIR, `${id}-${file.split("/").pop()}`));
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  }
  actions.push({ id, file, action: `set ${ARGV.join(" ")}` });
}

function rewriteText(id, file, transform) {
  if (!existsSync(file)) return actions.push({ id, file, action: "skip (absent)" });
  const text = readFileSync(file, "utf8");
  const next = transform(text);
  if (next === null) return actions.push({ id, file, action: "FAILED to locate the google-ai block" });
  if (next === text) return actions.push({ id, file, action: "already on the pin" });
  if (APPLY) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    copyFileSync(file, join(BACKUP_DIR, `${id}-${file.split("/").pop()}`));
    writeFileSync(file, next);
  }
  actions.push({ id, file, action: `set ${ARGV.join(" ")}` });
}

const specOf = (obj) => {
  if (!obj) return null;
  if (Array.isArray(obj.command)) return obj.command;
  return [obj.command, ...(obj.args ?? [])].filter(Boolean);
};
const upToDate = (line) => JSON.stringify(specOf(line).slice(-3)) === JSON.stringify(ARGV);

// claude
rewriteJson("claude", join(HOME, ".claude.json"), (d) => {
  const e = d.mcpServers?.["google-ai-search"];
  if (!e || upToDate({ command: e.command, args: e.args })) return;
  e.command = ARGV[0];
  e.args = ARGV.slice(1);
});
// kimi-code
rewriteJson("kimi-code", join(HOME, ".kimi-code", "mcp.json"), (d) => {
  const e = d.mcpServers?.["google-ai-search"];
  if (!e || upToDate(e)) return;
  e.command = ARGV[0];
  e.args = ARGV.slice(1);
});
// zed
rewriteJson("zed", join(HOME, ".config", "zed", "settings.json"), (d) => {
  const cs = d.context_servers ?? {};
  const key = Object.keys(cs).find((k) => k.includes("google"));
  if (!key || upToDate(cs[key])) return;
  cs[key].command = ARGV[0];
  cs[key].args = ARGV.slice(1);
});
// kilo
rewriteJson("kilo", join(HOME, ".config", "kilo", "kilo.json"), (d) => {
  const e = d.mcp?.["google-ai-search"];
  if (!e || JSON.stringify(e.command) === JSON.stringify(ARGV)) return;
  e.command = ARGV;
});
// codex
rewriteText("codex", join(HOME, ".codex", "config.toml"), (t) => {
  const block = /\[mcp_servers\.google-ai-search\][\s\S]*?(?=\n\[|$)/;
  if (!block.test(t)) return null;
  return t.replace(
    block,
    `[mcp_servers.google-ai-search]\ncommand = "${ARGV[0]}"\nargs = [ ${ARGV.slice(1)
      .map((a) => `"${a}"`)
      .join(", ")} ]\n`,
  );
});
// hermes
rewriteText("hermes", join(HOME, ".hermes", "config.yaml"), (t) => {
  const re = /(  google-ai-search:\n)([\s\S]*?)(?=\n  \S|$)/;
  if (!re.test(t)) return null;
  const body = `    command: ${ARGV[0]}\n    args:\n${ARGV.slice(1)
    .map((a) => `      - ${a}`)
    .join("\n")}\n${t.match(re)[2].match(/^ {4}(connect_timeout|enabled):.*$/gm)?.join("\n") ?? "    enabled: true"}\n`;
  return t.replace(re, `$1${body}`);
});

console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — target ${ARGV.join(" ")}\n`);
for (const a of actions) console.log(`  ${a.action.padEnd(34)} ${a.id.padEnd(10)} ${a.file}`);
const failed = actions.filter((a) => a.action.startsWith("FAILED") || a.action.startsWith("skip (absent)"));
if (APPLY) console.log(`\nbackups: ${BACKUP_DIR}`);
console.log(
  `\n${actions.filter((a) => a.action.startsWith("set")).length} surface(s) to change, ${
    actions.filter((a) => a.action === "already on the pin").length
  } already pinned, ${failed.length} needing attention`,
);
process.exit(actions.some((a) => a.action.startsWith("FAILED")) ? 1 : 0);
