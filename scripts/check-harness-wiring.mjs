#!/usr/bin/env node
/**
 * Per-surface verifier: every AI coding harness on this machine that exposes
 * `search_ai` must spawn a build of THIS project carrying the shutdown fixes —
 * either this repo's own `dist/index.js`, or the pinned published package
 * `@tomkabel/google-ai-mode-mcp@<version>`, whose registry tarball must be
 * byte-identical (same shasum) to what this tree produces. It must never spawn
 * the npm-published `google-ai-mode-mcp` — the archived upstream, stuck at npm
 * 1.0.3, and the build seen spinning at ~100% CPU in bug.md.
 *
 * One surface = one probe. A live `npx` run proves nothing about a config file,
 * so each harness config is parsed and its resolved argv compared against the
 * accepted targets. Codes:
 *
 *   E00_surface_unreadable      config exists but could not be parsed at all
 *   E01_target_not_local        argv names no accepted build of this project
 *   E02_build_missing           this repo has no dist/index.js (local wiring only)
 *   E03_build_stale             dist/ is not a byte-identical compile of src/
 *   E04_fix_absent              dist/index.js lacks the orphan-shutdown fix
 *   E05_npx_published_route     argv runs the ARCHIVED upstream package
 *   E06_surface_missing         harness config has no google-ai entry (--require-all)
 *   E07_extension_missing       pi: extension file missing or not bridging dist/
 *   E08_npx_cache_present       an npx cache entry for the archived package exists
 *   E09_spawn_failed            wired argv does not complete an MCP handshake (--spawn)
 *   E10_published_artifact_mismatch  pinned published tarball != this tree's build
 *   E11_unpinned_published_route     published route without an exact version pin
 *   SKIPPED_absent              surface not configured on this machine (non-failing)
 *
 * Usage: node scripts/check-harness-wiring.mjs [--home DIR] [--repo DIR]
 *        [--deep] [--spawn] [--spawn-timeout MS] [--require-all]
 *        [--registry-shasum SHA] [--json]
 * Defaults: --home $HOME, --repo <this repo>. A surface that is not configured
 * on this machine is SKIPPED (non-failing) so the check is portable and can run
 * from `npm run check`; --require-all turns those into E06 failures for an
 * audit of one machine. --deep compiles src/ into a temp dir and byte-compares
 * it with dist/. --spawn launches each distinct wired argv and requires an MCP
 * initialize + tools/list carrying `search_ai`. --registry-shasum pins the
 * registry shasum for E10 (offline / mutation use).
 *
 * Only a code that is neither PASS nor SKIPPED_* fails the run, and skipped
 * surfaces are printed and counted in the verdict rather than hidden.
 */
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i === -1 ? def : argv[i + 1];
};
const HOME = resolve(flag("--home", process.env.HOME ?? "/home/notroot"));
const REPO = resolve(flag("--repo", join(dirname(fileURLToPath(import.meta.url)), "..")));
const DEEP = argv.includes("--deep");
const SPAWN = argv.includes("--spawn");
const SPAWN_TIMEOUT = Number(flag("--spawn-timeout", "20000"));
const REQUIRE_ALL = argv.includes("--require-all");
const REGISTRY_SHASUM = flag("--registry-shasum", null);
const JSON_OUT = argv.includes("--json");
const DIST = join(REPO, "dist", "index.js");

/** The published fork: the only registry name we accept, pinned to an exact version. */
const PUBLISHED_NAME = "@tomkabel/google-ai-mode-mcp";

/** Tokens that only exist once the orphan-shutdown fix is compiled in. */
const FIX_TOKENS = [
  "stdin closed (host disconnected)",
  "stdout closed (host disconnected)",
  "shuttingDown",
];

// ---------- tolerant parsers (JSONC + a minimal TOML/YAML block scan) ----------

const readText = (p) => readFileSync(p, "utf8");
const parseJsonc = (text) => JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));

function tomlBlock(text, header) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) return null;
  const out = {};
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith("[")) break;
    const m = l.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** All `[mcp_servers.<name>]` blocks whose body mentions google-ai. */
function tomlGoogleBlocks(text) {
  const names = [...text.matchAll(/^\[mcp_servers\.([^\]]+)\]\s*$/gm)].map((m) => m[1]);
  const hits = [];
  for (const n of names) {
    const body = tomlBlock(text, `[mcp_servers.${n}]`);
    if (body && JSON.stringify(body).includes("google-ai")) hits.push({ name: n, body });
  }
  return hits;
}

function parseTomlValue(raw) {
  if (raw === undefined) return [];
  const arr = raw.match(/^\[(.*)\]$/s);
  if (!arr) return [raw.replace(/^"|"$/g, "").trim()];
  return arr[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

/** Text scan of ~/.hermes/config.yaml: the mcp_servers entry mentioning google-ai. */
function yamlGoogleEntry(text) {
  const lines = text.split("\n");
  const top = lines.findIndex((l) => /^mcp_servers:\s*$/.test(l));
  if (top === -1) return null;
  let name = null;
  let buf = [];
  const blocks = [];
  for (let i = top + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "" || l.startsWith("#")) continue;
    if (/^\S/.test(l)) break; // next top-level key
    const m = l.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (m) {
      if (name) blocks.push({ name, body: buf.join("\n") });
      name = m[1];
      buf = [];
    } else if (name) buf.push(l);
  }
  if (name) blocks.push({ name, body: buf.join("\n") });
  return blocks.find((b) => b.body.includes("google-ai")) ?? null;
}

/** argv out of a YAML block's `command:` + `- item` list. */
function yamlArgv(body) {
  const cmd = body.match(/^\s*command:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const args = [];
  const argsBlock = body.match(/^(\s*)args:\s*$/m);
  if (argsBlock) {
    const indent = argsBlock[1].length;
    for (const l of body.split("\n")) {
      const m = l.match(new RegExp(`^ {${indent + 2}}-\\s+(.+)$`));
      if (m) args.push(m[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return cmd ? [cmd, ...args] : [];
}

// ---------- surface definitions ----------

const SURFACES = [
  {
    id: "claude",
    file: (h) => join(h, ".claude.json"),
    parse: (t) => parseJsonc(t),
    pick: (d) => d?.mcpServers?.["google-ai-search"],
    argv: (e) => (e ? [e.command, ...(e.args ?? [])] : []),
  },
  {
    id: "hermes",
    file: (h) => join(h, ".hermes", "config.yaml"),
    pick: (t) => yamlGoogleEntry(t),
    argv: (e) => yamlArgv(e.body),
  },
  {
    id: "codex",
    file: (h) => join(h, ".codex", "config.toml"),
    pick: (t) => tomlGoogleBlocks(t)[0],
    argv: (e) => [...parseTomlValue(e.body.command), ...parseTomlValue(e.body.args)],
  },
  {
    id: "zed",
    file: (h) => join(h, ".config", "zed", "settings.json"),
    parse: (t) => parseJsonc(t),
    pick: (d) => {
      const cs = d?.context_servers ?? {};
      const k = Object.keys(cs).find((x) => x.includes("google"));
      return k ? cs[k] : undefined;
    },
    argv: (e) => (e ? [e.command, ...(e.args ?? [])] : []),
  },
  {
    id: "kilo",
    file: (h) => join(h, ".config", "kilo", "kilo.json"),
    parse: (t) => parseJsonc(t),
    pick: (d) => d?.mcp?.["google-ai-search"],
    argv: (e) => (Array.isArray(e?.command) ? e.command : e?.command ? [e.command] : []),
  },
  {
    id: "kimi-code",
    file: (h) => join(h, ".kimi-code", "mcp.json"),
    parse: (t) => parseJsonc(t),
    pick: (d) => d?.mcpServers?.["google-ai-search"],
    argv: (e) => (e ? [e.command, ...(e.args ?? [])] : []),
  },
  {
    id: "pi",
    file: (h) => join(h, ".pi", "agent", "settings.json"),
    parse: (t) => parseJsonc(t),
    kind: "extension",
    // pi resolves package paths relative to the settings file's own directory.
    pick: (d) => (d?.packages ?? []).map((p) => resolve(join(HOME, ".pi", "agent"), p)).find((p) => p === REPO),
    argv: () => [REPO],
  },
];

// ---------- checks ----------

const results = [];
const pending = [];
const record = (surface, code, detail) => results.push({ surface, code, detail });
const pass = (surface, detail = "") => record(surface, "PASS", detail);
const skip = (surface, detail = "") => record(surface, "SKIPPED_absent", detail);
const replacePass = (surface, detail) => {
  const r = results.find((x) => x.surface === surface && x.code === "PASS");
  if (r) r.detail = detail;
  else pass(surface, detail);
};

const version = () => JSON.parse(readText(join(REPO, "package.json"))).version;

/** Does any surviving surface run this tree's own dist/? */
let usesLocal = false;

function buildChecks() {
  if (!existsSync(DIST)) {
    if (usesLocal) record("build", "E02_build_missing", DIST);
    else skip("build", `no dist/ and no surface wired to it (${DIST})`);
    return { ok: !usesLocal };
  }
  const text = readText(DIST);
  if (DEEP) {
    const tmp = mkdtempSync(join(tmpdir(), "gam-dist-"));
    try {
      execFileSync(join(REPO, "node_modules", ".bin", "tsc"), ["--outDir", tmp], {
        cwd: REPO,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const fresh = readFileSync(join(tmp, "index.js"));
      const built = readFileSync(DIST);
      if (!fresh.equals(built)) {
        record("build", "E03_build_stale", `dist/index.js != fresh tsc output (${built.length} vs ${fresh.length} bytes)`);
        return { ok: false, bytes: built.length };
      }
    } catch (e) {
      record("build", "E03_build_stale", `fresh compile failed: ${String(e).split("\n")[0]}`);
      return { ok: false, bytes: 0 };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  const missing = FIX_TOKENS.filter((t) => !text.includes(t));
  if (missing.length) {
    record("build", "E04_fix_absent", `dist/index.js missing: ${missing.join(", ")}`);
    return { ok: false, bytes: text.length };
  }
  pass("build", `dist/index.js is a compile of src/ with the shutdown fix (${text.length} bytes, v${version()})`);
  return { ok: true, bytes: text.length };
}

/** shasum of what `npm pack` would upload from this tree (into a temp dir). */
function localPackShasum() {
  const dest = mkdtempSync(join(tmpdir(), "gam-pack-"));
  try {
    const out = execFileSync("npm", ["pack", "--json", "--pack-destination", dest], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(out);
    const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
    return entry.shasum;
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

/** Registry shasum for a published name@version (public package: no token needed). */
function registryShasum(name, v) {
  if (REGISTRY_SHASUM) return REGISTRY_SHASUM; // injected (offline / mutation selftest)
  try {
    const out = execFileSync("npm", ["view", `${name}@${v}`, "dist.shasum", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    return JSON.parse(out);
  } catch (e) {
    const line = String(e.stderr || e.message).split("\n").find((l) => l.trim());
    return { error: line ?? "npm view failed" };
  }
}

/** Proves the pinned published tarball IS this tree's build. */
function checkPublishedArtifact() {
  const v = version();
  const registry = registryShasum(PUBLISHED_NAME, v);
  if (typeof registry !== "string") {
    // A version that is simply not published yet is reported as a skip rather
    // than a failure: it is visible in the output and counted in the verdict,
    // and it is the state you are in between bumping the version and publishing
    // it. Any OTHER registry error (auth, network, mismatch) stays a failure.
    if (/E404|404 Not Found|is not in this registry/i.test(registry.error)) {
      return skip("published", `${PUBLISHED_NAME}@${v} is not on the registry yet`);
    }
    record("published", "E10_published_artifact_mismatch", `${PUBLISHED_NAME}@${v} not resolvable: ${registry.error}`);
    return;
  }
  let local;
  try {
    local = localPackShasum();
  } catch (e) {
    record("published", "E10_published_artifact_mismatch", `npm pack failed: ${String(e.message).split("\n")[0]}`);
    return;
  }
  if (local !== registry) {
    record(
      "published",
      "E10_published_artifact_mismatch",
      `${PUBLISHED_NAME}@${v} registry shasum ${registry} != this tree's pack shasum ${local}`,
    );
    return;
  }
  pass("published", `${PUBLISHED_NAME}@${v} tarball shasum ${registry.slice(0, 12)}… == this tree's pack`);
}

function checkSurface(s) {
  const file = s.file(HOME);
  if (!existsSync(file)) {
    return REQUIRE_ALL
      ? record(s.id, "E06_surface_missing", `${file} does not exist`)
      : skip(s.id, `${file} absent on this machine`);
  }
  let text;
  try {
    text = readText(file);
  } catch (e) {
    return record(s.id, "E00_surface_unreadable", `${file}: ${e.code ?? e.message}`);
  }
  let entry;
  try {
    entry = s.pick(s.parse ? s.parse(text) : text);
  } catch (e) {
    return record(s.id, "E00_surface_unreadable", `${file}: ${String(e.message).split("\n")[0]}`);
  }
  if (entry === null || entry === undefined || (Array.isArray(entry) && entry.length === 0)) {
    const code = REQUIRE_ALL ? "E06_surface_missing" : "SKIPPED_absent";
    return record(s.id, code, `no google-ai entry in ${file}`);
  }
  if (s.kind === "extension") {
    const ext = join(REPO, "extensions", "google-ai-search.ts");
    if (!existsSync(ext)) return record(s.id, "E07_extension_missing", ext);
    const body = readText(ext);
    const spec = body.match(new RegExp(`${PUBLISHED_NAME.replace("/", "\\/")}@(\\d+\\.\\d+\\.\\d+)`));
    if (!spec) {
      return record(s.id, "E07_extension_missing", `${ext}: spawns no pinned ${PUBLISHED_NAME}@x.y.z`);
    }
    if (spec[1] !== version()) {
      return record(
        "published",
        "E10_published_artifact_mismatch",
        `pi extension pins ${PUBLISHED_NAME}@${spec[1]}, repo builds ${version()}`,
      );
    }
    pending.push({ id: s.id, argv: ["npx", "-y", `${PUBLISHED_NAME}@${spec[1]}`], line: `${ext} → npx -y ${PUBLISHED_NAME}@${spec[1]}` });
    return pass(s.id, `package ${entry} → extensions/google-ai-search.ts → npx -y ${PUBLISHED_NAME}@${spec[1]}`);
  }

  const line = s.argv(entry).join(" ");
  if (/\bnpx\b/.test(line) && /(^|[^@/])google-ai-mode-mcp($|@|\s)/.test(line)) {
    return record(s.id, "E05_npx_published_route", `${line} — that is the archived upstream package`);
  }
  const pinned = line.match(new RegExp(`${PUBLISHED_NAME.replace("/", "\\/")}@(\\S+)`));
  if (pinned) {
    if (!/^\d+\.\d+\.\d+$/.test(pinned[1])) {
      return record(s.id, "E11_unpinned_published_route", `${line} — pin an exact version`);
    }
    if (pinned[1] !== version()) {
      return record(
        "published",
        "E10_published_artifact_mismatch",
        `${s.id} pins ${PUBLISHED_NAME}@${pinned[1]}, repo builds ${version()}`,
      );
    }
    pending.push({ id: s.id, argv: ["npx", "-y", `${PUBLISHED_NAME}@${pinned[1]}`], line });
    return pass(s.id, line);
  }
  if (line.includes(DIST)) {
    usesLocal = true;
    pending.push({ id: s.id, argv: [process.execPath, DIST], line });
    return pass(s.id, line);
  }
  return record(s.id, "E01_target_not_local", line || "(empty argv)");
}

/** Launch the wired argv for real and require an MCP handshake + search_ai. */
function spawnProbe({ id, argv: cmd, line }) {
  return new Promise((done) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    let settled = false;
    const finish = (code, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (code === "PASS") replacePass(id, `${line} — handshake ok, search_ai listed`);
      else record(id, code, detail);
      done();
    };
    const timer = setTimeout(
      () =>
        finish(
          "E09_spawn_failed",
          `${cmd.join(" ")}: no tools/list within ${SPAWN_TIMEOUT}ms (stderr: ${stderr.slice(-200)})`,
        ),
      SPAWN_TIMEOUT,
    );
    child.on("error", (e) => finish("E09_spawn_failed", `${cmd.join(" ")}: ${e.message}`));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("exit", (c) => finish("E09_spawn_failed", `${cmd.join(" ")}: exited ${c} before handshake`));
    child.stdout.on("data", (b) => {
      buf += b.toString();
      // A JSON-RPC response can straddle chunks, so only parse complete lines.
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) {
        let msg;
        try {
          msg = JSON.parse(l);
        } catch {
          continue;
        }
        if (msg.id !== 2) continue;
        const names = (msg.result?.tools ?? []).map((t) => t.name);
        const ok = names.includes("search_ai");
        finish(
          ok ? "PASS" : "E09_spawn_failed",
          ok ? cmd.join(" ") : `${cmd.join(" ")}: tools/list listed [${names.join(", ")}], no search_ai`,
        );
      }
    });
    const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "harness-wiring-probe", version: "1" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

function checkNpxCache() {
  const root = join(HOME, ".npm", "_npx");
  if (!existsSync(root)) return;
  for (const dir of readdirSync(root)) {
    // The defect is an npx cache entry holding the ARCHIVED unscoped package:
    // npx records the spec it resolved in its own root package.json. A local
    // tarball or the scoped fork can legitimately land in the same cache layout,
    // so key on the recorded spec, not on the folder name.
    const pkg = join(root, dir, "package.json");
    if (!existsSync(pkg)) continue;
    let spec = null;
    let version = "?";
    try {
      const meta = JSON.parse(readText(pkg));
      spec = (meta._npx?.packages ?? []).find((p) => /(^|[^@/])google-ai-mode-mcp@/.test(p));
      const inner = join(root, dir, "node_modules", "google-ai-mode-mcp", "package.json");
      if (existsSync(inner)) version = JSON.parse(readText(inner)).version;
    } catch {
      continue; // unreadable cache dir is not this check's business
    }
    if (!spec) continue;
    record("npx-cache", "E08_npx_cache_present", `${dir} resolved "${spec}" (${version}) — delete so nothing re-resolves it`);
  }
}

// ---------- run ----------

// Surfaces first: whether the local build is required depends on their wiring.
for (const s of SURFACES) checkSurface(s);
const build = buildChecks();
if (results.some((r) => r.code === "PASS" && r.detail.includes(PUBLISHED_NAME))) checkPublishedArtifact();
checkNpxCache();
if (SPAWN) {
  // Identical argv is one fact, not N: probe each distinct wiring once.
  const distinct = [...new Map(pending.map((p) => [p.argv.join(" "), p])).values()];
  for (const p of distinct) await spawnProbe(p);
  pass("spawn", `${pending.length} wiring(s) resolve to ${distinct.length} distinct argv`);
}

const failed = results.filter((r) => !r.code.startsWith("SKIPPED") && r.code !== "PASS");
const skipped = results.filter((r) => r.code.startsWith("SKIPPED"));
if (JSON_OUT) {
  console.log(
    JSON.stringify(
      { repo: REPO, home: HOME, deep: DEEP, spawn: SPAWN, requireAll: REQUIRE_ALL, results, verdict: failed.length ? "FAIL" : "PASS" },
      null,
      2,
    ),
  );
} else {
  console.log(`harness wiring: repo=${REPO} home=${HOME} deep=${DEEP} spawn=${SPAWN} require-all=${REQUIRE_ALL}`);
  for (const r of results) console.log(`  ${r.code.padEnd(30)} ${r.surface.padEnd(10)} ${r.detail}`);
  console.log(
    `verdict: ${
      failed.length
        ? `FAIL (${failed.length} non-PASS of ${results.length - skipped.length})`
        : `PASS (${results.length - skipped.length} checks${skipped.length ? `, ${skipped.length} skipped` : ""})`
    }`,
  );
  if (!build.ok && failed.length) console.log(`note: build checks failed, so every surface is unverified regardless of its own code`);
}
process.exit(failed.length ? 1 : 0);
