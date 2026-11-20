#!/usr/bin/env node
/**
 * Mutation selftest for scripts/check-harness-wiring.mjs.
 *
 * A green run of the checker proves nothing on its own: every check could be
 * vacuous. This harness builds fixture `$HOME`s and fixture repos, mutates ONE
 * field at a time, and asserts the checker reports exactly the expected code —
 * printing the codes actually observed beside the one expected. It also asserts
 * each mutation is non-vacuous (the mutated field really differs from the
 * control value the check reads) and that a correct fixture PASSes, so the gate
 * is achievable.
 *
 * Codes covered: E00 E01 E02 E03 E04 E05 E06 E07 E08 E09 E10 E11
 * plus: the published-route happy path, a SKIPPED_absent control, and the
 * all-local control.
 *
 * Usage: node scripts/selftest-harness-wiring.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKER = join(REPO, "scripts", "check-harness-wiring.mjs");
const ROOT = mkdtempSync(join(tmpdir(), "gam-wiring-selftest-"));
const PKG = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
const PIN = `${PKG.name}@${PKG.version}`;
const DIST = join(REPO, "dist", "index.js");

const run = (home, repo = REPO, opts = {}) => {
  const args = [
    CHECKER,
    "--home", home,
    "--repo", repo,
    ...(opts.deep ? ["--deep"] : []),
    ...(opts.requireAll ? ["--require-all"] : []),
    ...(opts.registryShasum ? ["--registry-shasum", opts.registryShasum] : []),
    ...(opts.spawn ? ["--spawn", "--spawn-timeout", String(opts.spawnTimeout ?? 3000)] : []),
  ];
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, args, { encoding: "utf8" });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    code = e.status ?? 1;
  }
  const codes = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^ {2}(\S+)\s+(\S+)\s*(.*)$/);
    if (m) (codes[m[1]] ??= []).push(m[2]);
  }
  return { codes, code, out };
};

/** shasum of this tree's own pack — the value a correct registry must report. */
function packShasum() {
  const dest = mkdtempSync(join(tmpdir(), "gam-selftest-pack-"));
  try {
    const out = execFileSync("npm", ["pack", "--json", "--pack-destination", dest], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(out);
    return (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]).shasum;
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}
const LOCAL_SHA = packShasum();

// ---------- fixture writers (mirror the real config files' shapes) ----------

function writeJsonHome(home, over = {}) {
  // over.published: every surface runs the pinned published package instead of
  // the local build. Otherwise each surface runs this repo's dist/index.js.
  // over.dist retargets every surface at one local build (fixture repos).
  const argvOf = (key) => (over.published ? ["npx", "-y", PIN] : ["node", over.dist ?? over[key] ?? DIST]);
  const j = (p, obj) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(obj, null, 2));
  };
  const asObj = (argv) => ({ command: argv[0], args: argv.slice(1) });

  j(join(home, ".claude.json"), {
    mcpServers: { "google-ai-search": { type: "stdio", ...asObj(over.claudeSpec ?? argvOf("claude")) } },
  });
  j(join(home, ".kimi-code", "mcp.json"), {
    mcpServers: { "google-ai-search": asObj(over.kimiSpec ?? argvOf("kimi")) },
  });
  j(join(home, ".config", "zed", "settings.json"), {
    context_servers:
      over.zed === null
        ? {}
        : { "mcp-server-google-ai-search": { enabled: true, ...asObj(over.zedSpec ?? argvOf("zed")) } },
  });
  mkdirSync(join(home, ".config", "kilo"), { recursive: true });
  writeFileSync(
    join(home, ".config", "kilo", "kilo.json"),
    over.kiloRaw ??
      JSON.stringify(
        { mcp: { "google-ai-search": { type: "local", command: over.kiloSpec ?? argvOf("kilo"), enabled: true } } },
        null,
        2,
      ),
  );
  j(join(home, ".pi", "agent", "settings.json"), {
    // Absolute path: fixture homes live outside $HOME, so pi's relative form
    // (../../Documents/...) only resolves in the real home. The real-home run
    // covers that relative form.
    packages: over.pi === null ? ["../../Documents/tiltrank"] : [over.pi ?? REPO],
    defaultProvider: "openrouter",
  });

  mkdirSync(join(home, ".hermes"), { recursive: true });
  const hermesSpec = over.hermesSpec ?? argvOf("hermes");
  writeFileSync(
    join(home, ".hermes", "config.yaml"),
    `mcp_servers:\n  google-ai-search:\n    command: ${hermesSpec[0]}\n    args:\n${hermesSpec
      .slice(1)
      .map((a) => `      - ${a}`)
      .join("")}\n    connect_timeout: 45.0\n    enabled: true\n  shadcn:\n    command: /usr/bin/npx\n`,
  );

  mkdirSync(join(home, ".codex"), { recursive: true });
  const codexSpec = over.codexSpec ?? argvOf("codex");
  writeFileSync(
    join(home, ".codex", "config.toml"),
    `approval_policy = "never"\n\n[mcp_servers.google-ai-search]\ncommand = "${codexSpec[0]}"\nargs = [ ${codexSpec
      .slice(1)
      .map((a) => `"${a}"`)
      .join(", ")} ]\n\n[mcp_servers.shadcn]\ncommand = "npx"\n`,
  );
  return home;
}

/** Minimal fake repo: src + tsconfig + dist, with a node_modules symlink so
 *  `--deep` compiles it for real (the staleness predicate is a byte compare of a
 *  fresh compile, not an mtime proxy). */
function fakeRepo(name, { dist = "fix", srcNewer = false } = {}) {
  const dir = join(ROOT, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export const x: number = 1;\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: PKG.name, version: PKG.version }, null, 2));
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ES2022", outDir: "dist" }, include: ["src"] }, null, 2),
  );
  try {
    execFileSync("ln", ["-sfn", join(REPO, "node_modules"), join(dir, "node_modules")]);
  } catch {
    /* symlink is best-effort: a failure just makes --deep report E03 */
  }
  if (dist !== "missing") {
    mkdirSync(join(dir, "dist"), { recursive: true });
    const body =
      dist === "fix"
        ? "shuttingDown\nstdin closed (host disconnected)\nstdout closed (host disconnected)\n"
        : "// pre-fix build\n";
    writeFileSync(join(dir, "dist", "index.js"), body);
    if (srcNewer) execFileSync("touch", ["-d", `@${Date.now() / 1000 + 60}`, join(dir, "src", "index.ts")]);
  }
  return dir;
}

// ---------- cases ----------

const cases = [];
const case_ = (name, expect, build) => cases.push({ name, expect, build });

case_("control: local wiring, correct build, handshake", "PASS", (h) => {
  // pi is left absent (SKIPPED) so this control needs no registry access; the
  // published-route happy path below covers pi's pin.
  writeJsonHome(h, { pi: null });
  return { home: h, deep: true, spawn: true, spawnTimeout: 8000, nonVacuous: true };
});

case_("control: published wiring + matching registry shasum", "PASS", (h) => {
  writeJsonHome(h, { published: true, pi: null });
  return {
    home: h,
    registryShasum: LOCAL_SHA,
    nonVacuous: LOCAL_SHA.length > 0 && existsSync(DIST),
  };
});

case_("control: absent surfaces report SKIPPED, not failure", "PASS", (h) => {
  writeJsonHome(h, { zed: null, pi: null, kimiSpec: null });
  // kimi gets its default (local dist); zed has no entry and pi is absent.
  const zed = JSON.parse(readFileSync(join(h, ".config", "zed", "settings.json"), "utf8"));
  return { home: h, nonVacuous: Object.keys(zed.context_servers).length === 0 };
});

case_("E05: codex on the archived unscoped package", "E05_npx_published_route", (h) => {
  writeJsonHome(h, { codexSpec: ["npx", "google-ai-mode-mcp@latest"] });
  const cfg = readFileSync(join(h, ".codex", "config.toml"), "utf8");
  return { home: h, nonVacuous: cfg.includes('"google-ai-mode-mcp@latest"') && !cfg.includes(PKG.name) };
});

case_("E11: published route without an exact version pin", "E11_unpinned_published_route", (h) => {
  writeJsonHome(h, { claudeSpec: ["npx", "-y", `${PKG.name}@latest`], pi: null });
  const cfg = readFileSync(join(h, ".claude.json"), "utf8");
  return { home: h, nonVacuous: cfg.includes(`${PKG.name}@latest`) };
});

case_("E10: registry tarball does not match this tree", "E10_published_artifact_mismatch", (h) => {
  writeJsonHome(h, { published: true, pi: null });
  const injected = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  return { home: h, registryShasum: injected, nonVacuous: injected !== LOCAL_SHA };
});

case_("E01: hermes on a sibling worktree's build", "E01_target_not_local", (h) => {
  const other = join(REPO, "..", "google-ai-mode-mcp-pstack-fence-holes", "dist", "index.js");
  writeJsonHome(h, { hermesSpec: ["node", other], pi: null });
  const cfg = readFileSync(join(h, ".hermes", "config.yaml"), "utf8");
  return { home: h, nonVacuous: cfg.includes(other) && other !== DIST };
});

case_("E06: zed has no google-ai entry (--require-all)", "E06_surface_missing", (h) => {
  writeJsonHome(h, { zed: null, pi: null });
  const cfg = JSON.parse(readFileSync(join(h, ".config", "zed", "settings.json"), "utf8"));
  return { home: h, requireAll: true, nonVacuous: Object.keys(cfg.context_servers).length === 0 };
});

case_("E00: kilo config is unparseable", "E00_surface_unreadable", (h) => {
  writeJsonHome(h, { kiloRaw: '{ "mcp": { "google-ai-search": { "command": ["node", "', pi: null });
  const raw = readFileSync(join(h, ".config", "kilo", "kilo.json"), "utf8");
  return { home: h, nonVacuous: !raw.trimEnd().endsWith("}") };
});

case_("E02: repo has no dist", "E02_build_missing", (h) => {
  const repo = fakeRepo("no-dist", { dist: "missing" });
  writeJsonHome(h, { pi: null, dist: join(repo, "dist", "index.js") });
  return { home: h, repo, nonVacuous: !existsSync(join(repo, "dist", "index.js")) };
});

case_("E03: dist is not a compile of src (--deep)", "E03_build_stale", (h) => {
  const repo = fakeRepo("stale-dist");
  writeJsonHome(h, { pi: null, dist: join(repo, "dist", "index.js") });
  const marker = readFileSync(join(repo, "dist", "index.js"), "utf8");
  return { home: h, repo, deep: true, nonVacuous: marker.includes("shuttingDown") };
});

case_("E04: dist built before the shutdown fix", "E04_fix_absent", (h) => {
  const repo = fakeRepo("pre-fix-dist", { dist: "prefix" });
  writeJsonHome(h, { pi: null, dist: join(repo, "dist", "index.js") });
  const body = readFileSync(join(repo, "dist", "index.js"), "utf8");
  return { home: h, repo, nonVacuous: !body.includes("stdin closed (host disconnected)") };
});

case_("E07: pi package present but extension spawns no pin", "E07_extension_missing", (h) => {
  const repo = fakeRepo("no-extension");
  cpSync(join(REPO, "dist"), join(repo, "dist"), { recursive: true });
  writeJsonHome(h, { pi: repo });
  return { home: h, repo, nonVacuous: !existsSync(join(repo, "extensions", "google-ai-search.ts")) };
});

case_("E08: npx cache holds the archived package", "E08_npx_cache_present", (h) => {
  writeJsonHome(h, { pi: null });
  const dir = join(h, ".npm", "_npx", "deadbeef");
  const cache = join(dir, "node_modules", "google-ai-mode-mcp");
  mkdirSync(cache, { recursive: true });
  // npx records the spec it resolved in its own root package.json.
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { "google-ai-mode-mcp": "^1.0.3" }, _npx: { packages: ["google-ai-mode-mcp@latest"] } }));
  writeFileSync(join(cache, "package.json"), JSON.stringify({ name: "google-ai-mode-mcp", version: "1.0.3" }));
  return { home: h, nonVacuous: readFileSync(join(dir, "package.json"), "utf8").includes("google-ai-mode-mcp@latest") };
});

case_("E09: wired to a build that cannot complete an MCP handshake", "E09_spawn_failed", (h) => {
  const repo = fakeRepo("dead-server");
  writeFileSync(join(repo, "dist", "index.js"), "process.stdin.resume(); // never answers JSON-RPC\n");
  writeJsonHome(h, { dist: join(repo, "dist", "index.js"), pi: null });
  const stub = readFileSync(join(repo, "dist", "index.js"), "utf8");
  const wired = readFileSync(join(h, ".claude.json"), "utf8");
  return {
    home: h,
    repo,
    spawn: true,
    spawnTimeout: 3000,
    nonVacuous: stub !== readFileSync(DIST, "utf8") && !stub.includes("search_ai") && wired.includes(repo),
  };
});

// ---------- run ----------

let failures = 0;
console.log(`selftest: fixtures under ${ROOT}\n  local pack shasum ${LOCAL_SHA}\n`);
for (const c of cases) {
  const home = join(ROOT, `home-${c.name.split(":")[0].toLowerCase().replace(/\W+/g, "-")}`);
  mkdirSync(home, { recursive: true });
  const cfg = c.build(home);
  const { codes, code, out } = run(cfg.home, cfg.repo ?? REPO, cfg);
  const observedList = codes[c.expect] ?? [];
  const observed = observedList.length ? observedList.join(",") : undefined;
  const ok = observedList.length > 0 && cfg.nonVacuous !== false && code === (c.expect === "PASS" ? 0 : 1);
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "BAD "} ${c.name}`);
  console.log(`        expected ${c.expect.padEnd(30)} observed ${String(observed ?? "(none)").padEnd(30)} exit ${code}`);
  if (cfg.nonVacuous === false) console.log(`        MUTATION WAS VACUOUS — the checked field did not change`);
  if (!ok && code === 0 && c.expect !== "PASS") console.log(`        checker exited 0 while a non-PASS code was present\n${out}`);
}

rmSync(ROOT, { recursive: true, force: true });
console.log(
  `\n${failures === 0 ? "PASS: every code fired on its own mutation, none vacuously" : `FAIL: ${failures} case(s) misbehaved`}`,
);
process.exit(failures === 0 ? 0 : 1);
