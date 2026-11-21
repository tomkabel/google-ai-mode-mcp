#!/usr/bin/env node
/**
 * V2 — publish-posture verifier.
 *
 * A SECOND, independent verifier beside V1 (`scripts/check-harness-wiring.mjs`,
 * codes E00–E11). V1 is left byte-identical. V1 answers "is the published
 * tarball this tree's build?" by comparing registry and local pack shasums;
 * V2 answers what V1 was never asked:
 *
 *   - is the release pipeline configured to authenticate with OIDC only, with
 *     no long-lived token in reach?
 *   - does the repository STATE the provenance gap its own visibility forces,
 *     and state it with the LIVE visibility value?
 *
 * V1's blind spot, stated rather than implied: it recomputes the same quantity
 * on both sides and so cannot see a defective formula. V2 does not re-check
 * V1's arithmetic; it takes a reading V1 never takes.
 *
 * Codes
 *   P00_input_unreadable               package.json unparseable (judge input)
 *   P01_release_doc_missing            RELEASING.md absent
 *   P02_disclosure_missing             the provenance-disclosure line is gone
 *   P03_disclosure_visibility_stale    disclosed visibility != live visibility
 *   P04_workflow_missing               .github/workflows/publish.yml absent
 *   P05_workflow_malformed             file is not a workflow at all
 *   P06_oidc_permission_missing        no `id-token: write` for the OIDC exchange
 *   P07_action_unpinned                an action ref is not a 40-hex commit SHA
 *   P08_token_fallback_present         a long-lived token is reachable by the job
 *   P09_direct_publish_present         publishes directly instead of staging
 *   P10_environment_undeclared         job declares no human-approval environment
 *   P11_toolchain_unpinned             runner npm not pinned to the verified version
 *   P12_cache_enabled                  release build uses a dependency cache
 *   P13_attestation_absent             public repo, published version, no attestation
 *   SKIPPED_attestations_repo_private  documented gap — see the RELEASING.md disclosure
 *   SKIPPED_registry_unpublished       version not on the registry yet
 *   SKIPPED_visibility_unprobed        no `gh` auth to read live visibility
 *
 * Usage
 *   node scripts/check-publish-posture.mjs [--root DIR] [--visibility private]
 *                                          [--json] [--mutate]
 *
 * Verdict: every record that is neither `PASS` nor a reported `SKIPPED_*` fails
 * the run. `--mutate` is the selftest: one structural mutation per check,
 * applied to a throwaway copy, asserting the expected code appears there and
 * does NOT appear on the clean copy.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i === -1 ? def : argv[i + 1];
};

const ROOT = path.resolve(flag("--root", "."));
const VISIBILITY_OVERRIDE = flag("--visibility", null);
const JSON_OUT = argv.includes("--json");
const MUTATE = argv.includes("--mutate");

const WORKFLOW_REL = ".github/workflows/publish.yml";
const DOC_REL = "RELEASING.md";
const REPO = "tomkabel/google-ai-mode-mcp";
const EXPECTED_ENVIRONMENT = "npm-publish";
const DISCLOSURE_RE = /<!--\s*provenance-disclosure:\s*repository visibility is\s+(public|private)\b[^>]*-->/i;

const results = [];
const record = (surface, code, detail) => {
  results.push({ surface, code, detail });
  return code;
};
const pass = (surface, detail) => record(surface, "PASS", detail);

/** A judge's own input file is an input too: guard the read, never throw. */
function readRel(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf-8");
  } catch {
    return null;
  }
}

function liveVisibility() {
  if (VISIBILITY_OVERRIDE) {
    return { value: VISIBILITY_OVERRIDE.toLowerCase(), source: "--visibility override" };
  }
  try {
    const out = execFileSync("gh", ["repo", "view", REPO, "--json", "visibility", "--jq", ".visibility"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    })
      .trim()
      .toLowerCase();
    return out ? { value: out, source: "gh repo view" } : { value: null, source: "gh repo view returned nothing" };
  } catch (e) {
    return { value: null, source: `gh repo view failed: ${String(e.message).split("\n")[0]}` };
  }
}

// ---------------------------------------------------------------- package.json
const pkgRaw = readRel("package.json");
let pkg = null;
if (pkgRaw === null) {
  record("package", "P00_input_unreadable", "package.json not found");
} else {
  try {
    pkg = JSON.parse(pkgRaw);
  } catch (e) {
    record("package", "P00_input_unreadable", `package.json is not JSON: ${String(e.message).split("\n")[0]}`);
  }
}
const pkgName = pkg?.name ?? "<unknown>";
const pkgVersion = pkg?.version ?? "<unknown>";

// ------------------------------------------------------------------- disclosure
const doc = readRel(DOC_REL);
if (doc === null) {
  record("disclosure", "P01_release_doc_missing", `${DOC_REL} not found`);
} else {
  const m = doc.match(DISCLOSURE_RE);
  if (!m) {
    record("disclosure", "P02_disclosure_missing", `no provenance-disclosure line in ${DOC_REL}`);
  } else {
    const declared = m[1].toLowerCase();
    pass("disclosure", `disclosure line present, declares visibility "${declared}"`);
    const live = liveVisibility();
    if (live.value === null) {
      record("disclosure", "SKIPPED_visibility_unprobed", `cannot read live visibility (${live.source})`);
    } else if (declared !== live.value) {
      record(
        "disclosure",
        "P03_disclosure_visibility_stale",
        `disclosure says "${declared}" but live visibility is "${live.value}" (${live.source}) — provenance availability changed; update ${DOC_REL}`,
      );
    } else {
      pass("disclosure", `declared visibility matches live value "${live.value}" (${live.source})`);
    }
  }
}

// --------------------------------------------------------------------- workflow
const wf = readRel(WORKFLOW_REL);
if (wf === null) {
  record("workflow", "P04_workflow_missing", `${WORKFLOW_REL} not found`);
} else if (wf.trim() === "" || !/^name:/m.test(wf) || !/^jobs:/m.test(wf)) {
  record("workflow", "P05_workflow_malformed", `${WORKFLOW_REL} is empty or has no top-level name:/jobs:`);
} else {
  pass("workflow", `${WORKFLOW_REL} present and structurally recognisable`);

  // Comment-only lines are stripped before the structural scans: a comment
  // explaining a rule must not be read as that rule being broken. Inline
  // comments are NOT stripped, so never put a bare direct-publish command or
  // a token name inside one.
  const wfCode = wf
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  if (/^\s*id-token:\s*write\s*$/m.test(wfCode)) {
    pass("workflow", "OIDC enabled (id-token: write)");
  } else {
    record("workflow", "P06_oidc_permission_missing", "no `id-token: write` — the OIDC exchange cannot happen");
  }

  // `uses:` values contain no whitespace, so a trailing `# vX` version comment
  // is tolerated here (and does not hide an unpinned ref).
  const refs = [...wfCode.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((m) => m[1]);
  const unpinned = refs.filter((r) => !/@[0-9a-f]{40}$/.test(r));
  if (refs.length === 0) {
    record("workflow", "P07_action_unpinned", "no action refs found — the pin check cannot bind");
  } else if (unpinned.length) {
    record("workflow", "P07_action_unpinned", `not SHA-pinned: ${unpinned.join(", ")}`);
  } else {
    pass("workflow", `all ${refs.length} action refs pinned to commit SHAs`);
  }

  const tokenLines = wfCode.split("\n").filter((l) => /NODE_AUTH_TOKEN|_authToken|secrets\.NPM/i.test(l));
  if (tokenLines.length) {
    record("workflow", "P08_token_fallback_present", `long-lived token reachable: ${tokenLines[0].trim()}`);
  } else {
    pass("workflow", "no long-lived npm token reachable by the publish job");
  }

  const direct = wfCode.split("\n").filter((l) => /\bnpm\s+publish\b/.test(l) && !/\bnpm\s+stage\s+publish\b/.test(l));
  const staged = /\bnpm\s+stage\s+publish\b/.test(wfCode);
  if (direct.length) {
    record("workflow", "P09_direct_publish_present", `direct publish reachable: ${direct[0].trim()}`);
  } else if (!staged) {
    record("workflow", "P09_direct_publish_present", "no `npm stage publish` — nothing stages a reviewable release");
  } else {
    pass("workflow", "publishes via `npm stage publish` (maintainer 2FA approval required)");
  }

  const envDecl = wfCode.match(/^\s*environment:\s*(\S+)\s*$/m);
  if (!envDecl) {
    record("workflow", "P10_environment_undeclared", "no `environment:` — no human approval gate on the runner");
  } else if (envDecl[1] !== EXPECTED_ENVIRONMENT) {
    record(
      "workflow",
      "P10_environment_undeclared",
      `declares environment "${envDecl[1]}" but the runbook and the trusted-publisher binding name "${EXPECTED_ENVIRONMENT}"`,
    );
  } else {
    pass("workflow", `declares environment "${EXPECTED_ENVIRONMENT}"`);
  }

  const npmPin = wfCode.match(/npm\s+install\s+-g\s+npm@(\d+\.\d+\.\d+)/);
  if (!npmPin) {
    record(
      "workflow",
      "P11_toolchain_unpinned",
      "runner npm is not pinned — a different npm major repacks the tarball and false-fails V1/E10",
    );
  } else {
    pass("workflow", `runner npm pinned to ${npmPin[1]} (must equal the version that produced the verified tarball)`);
  }

  if (/package-manager-cache:\s*false\s*$/m.test(wfCode)) {
    pass("workflow", "dependency cache disabled for the release build");
  } else {
    record("workflow", "P12_cache_enabled", "package-manager-cache is not false");
  }
}

// --------------------------------------------------- provenance (registry side)
const live = liveVisibility();
if (live.value === null) {
  record("provenance", "SKIPPED_visibility_unprobed", `cannot read live visibility (${live.source})`);
} else if (live.value === "private") {
  record(
    "provenance",
    "SKIPPED_attestations_repo_private",
    "repository is private, so npm generates no provenance attestation — the gap must be DISCLOSED in RELEASING.md (enforced by P02/P03)",
  );
} else {
  try {
    const out = execFileSync("npm", ["view", `${pkgName}@${pkgVersion}`, "dist.attestations", "--json"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    if (out && out !== "undefined" && out !== "{}" && out !== "null") {
      pass("provenance", `${pkgName}@${pkgVersion} carries a provenance attestation`);
    } else {
      record(
        "provenance",
        "P13_attestation_absent",
        `${pkgName}@${pkgVersion} is published with no attestation although the repository is public`,
      );
    }
  } catch {
    record("provenance", "SKIPPED_registry_unpublished", `${pkgName}@${pkgVersion} is not on the registry yet`);
  }
}

// ----------------------------------------------------------------------- verdict
const isFailure = (r) => r.code !== "PASS" && !r.code.startsWith("SKIPPED_");
const failures = results.filter(isFailure);

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ results, failures: failures.length, root: ROOT }, null, 2) + "\n");
} else {
  for (const r of results) console.log(`${r.code.padEnd(34)} ${r.surface.padEnd(11)} ${r.detail}`);
  const counts = [
    `${results.filter((r) => r.code === "PASS").length} pass`,
    `${results.filter((r) => r.code.startsWith("SKIPPED_")).length} skipped`,
    `${failures.length} failed`,
  ];
  console.log(`\n${counts.join(", ")}`);
}

// -------------------------------------------------------------------- --mutate
if (MUTATE) {
  const SELF = import.meta.filename ?? new URL(import.meta.url).pathname;
  const FILES = ["package.json", DOC_REL, WORKFLOW_REL];

  const makeTree = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "posture-"));
    for (const rel of FILES) {
      const src = path.join(ROOT, rel);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(dir, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    return dir;
  };

  // A red tree is a legitimate verdict, not a crash: read the codes from a
  // non-zero exit instead of letting the runner turn it into an exception.
  const runJudge = (dir) => {
    const r = spawnSync(process.execPath, [SELF, "--root", dir, "--visibility", "private", "--json"], {
      encoding: "utf-8",
    });
    if (!r.stdout) throw new Error(`judge produced no verdict (status ${r.status}): ${r.stderr}`);
    return new Set(JSON.parse(r.stdout).results.map((x) => x.code));
  };

  /** Mutate by STRUCTURE, and refuse to count a no-op as a catch. */
  const applyMutation = (dir, mut) => {
    const file = path.join(dir, mut.file === "doc" ? DOC_REL : WORKFLOW_REL);
    if (mut.kind === "remove") {
      if (!fs.existsSync(file)) throw new Error(`${path.basename(file)} already absent`);
      fs.rmSync(file);
      return;
    }
    if (mut.kind === "empty") {
      const before = fs.readFileSync(file, "utf-8");
      if (!before.trim()) throw new Error(`${path.basename(file)} already empty`);
      fs.writeFileSync(file, "");
      return;
    }
    const before = fs.readFileSync(file, "utf-8");
    if (!mut.pattern.test(before)) throw new Error(`target not present in ${path.basename(file)}: ${mut.pattern}`);
    const after = before.replace(mut.pattern, mut.repl);
    if (after === before) throw new Error(`no-op mutation in ${path.basename(file)}: ${mut.pattern}`);
    fs.writeFileSync(file, after);
  };

  const MUTATIONS = [
    { name: "release-doc-removed", expected: "P01_release_doc_missing", file: "doc", kind: "remove" },
    {
      name: "disclosure-line-deleted",
      expected: "P02_disclosure_missing",
      file: "doc",
      kind: "replace",
      pattern: /^<!--\s*provenance-disclosure:[^>]*-->\n?/m,
      repl: "",
    },
    {
      name: "disclosure-visibility-flipped",
      expected: "P03_disclosure_visibility_stale",
      file: "doc",
      kind: "replace",
      pattern: /(provenance-disclosure:\s*repository visibility is\s+)private/i,
      repl: "$1public",
    },
    { name: "workflow-removed", expected: "P04_workflow_missing", file: "wf", kind: "remove" },
    { name: "workflow-emptied", expected: "P05_workflow_malformed", file: "wf", kind: "empty" },
    {
      name: "oidc-permission-dropped",
      expected: "P06_oidc_permission_missing",
      file: "wf",
      kind: "replace",
      pattern: /^\s*id-token:\s*write\s*$/m,
      repl: "",
    },
    {
      name: "action-unpinned",
      expected: "P07_action_unpinned",
      file: "wf",
      kind: "replace",
      pattern: /@[0-9a-f]{40}/,
      repl: "@v6",
    },
    {
      name: "token-fallback-injected",
      expected: "P08_token_fallback_present",
      file: "wf",
      kind: "replace",
      pattern: /^(\s*)- name: Stage the release/m,
      repl: "$1- env:\n$1    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n$1- name: Stage the release",
    },
    {
      name: "direct-publish",
      expected: "P09_direct_publish_present",
      file: "wf",
      kind: "replace",
      pattern: /npm stage publish/,
      repl: "npm publish",
    },
    {
      name: "environment-dropped",
      expected: "P10_environment_undeclared",
      file: "wf",
      kind: "replace",
      pattern: /^\s*environment:\s*\S+\s*$\n/m,
      repl: "",
    },
    {
      name: "toolchain-unpinned",
      expected: "P11_toolchain_unpinned",
      file: "wf",
      kind: "replace",
      pattern: /^\s*run:\s*npm install -g npm@\d+\.\d+\.\d+\s*$\n/m,
      repl: "",
    },
    {
      name: "cache-enabled",
      expected: "P12_cache_enabled",
      file: "wf",
      kind: "replace",
      pattern: /(package-manager-cache:\s*)false/,
      repl: "$1true",
    },
  ];

  const cleanCodes = runJudge(makeTree());
  console.log("\nmutation selftest");
  let caught = 0;
  let bad = 0;
  for (const mut of MUTATIONS) {
    const dir = makeTree();
    try {
      applyMutation(dir, mut);
    } catch (e) {
      console.log(`  VACUOUS   ${mut.name.padEnd(30)} mutation not applied: ${e.message}`);
      bad += 1;
      continue;
    }
    const codes = runJudge(dir);
    const observed = [...codes].filter((c) => !c.startsWith("SKIPPED_") && c !== "PASS").sort();
    if (cleanCodes.has(mut.expected)) {
      console.log(`  VACUOUS   ${mut.name.padEnd(30)} ${mut.expected} already fires on the clean tree`);
      bad += 1;
    } else if (codes.has(mut.expected)) {
      console.log(`  caught    ${mut.name.padEnd(30)} ${mut.expected}   observed: ${observed.join(", ")}`);
      caught += 1;
    } else {
      console.log(`  MISSED    ${mut.name.padEnd(30)} expected ${mut.expected}; observed: ${observed.join(", ") || "none"}`);
      bad += 1;
    }
  }
  console.log(`\n${caught}/${MUTATIONS.length} mutations caught, ${bad} vacuous or missed`);
  console.log("UNEXERCISED: P13_attestation_absent needs a public repository; unreachable from this tree.");
  if (bad > 0) process.exit(2);
}

process.exit(failures.length ? 1 : 0);
