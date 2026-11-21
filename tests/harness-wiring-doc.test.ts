/**
 * Docs and shipped wiring must not send users to the archived upstream package.
 *
 * `npx google-ai-mode-mcp@latest` resolves to npm 1.0.3 of the archived upstream
 * repo, which lacks the orphan-shutdown fixes — the build that spun a core at
 * ~100% in bug.md. A README snippet recommending it is the same defect as a
 * config file pointing there, so it is a red test rather than a review note.
 * See scripts/check-harness-wiring.mjs for the machine-side check.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf-8");
const pkg = JSON.parse(read("package.json"));

describe("harness wiring docs", () => {
  it("README never installs the archived unscoped package", () => {
    const hits = read("README.md")
      .split("\n")
      .filter((l) => /npx (-\S+ )*google-ai-mode-mcp\b/.test(l) || l.includes("google-ai-mode-mcp@latest"))
      .filter((l) => !/Do not install|archived/.test(l));
    expect(hits).toEqual([]);
  });

  it("README installs the pinned published fork for every client", () => {
    const readme = read("README.md");
    expect(readme).toContain(`${pkg.name}@${pkg.version}`);
    for (const client of ["Claude Code", "Codex", "Hermes Agent", "pi", "Zed", "Kilo Code", "Kimi Code"]) {
      expect(readme, client).toContain(client);
    }
  });

  it("the published identity is the scoped fork, not the upstream package", () => {
    expect(pkg.name).toBe("@tomkabel/google-ai-mode-mcp");
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.repository.url).toContain("tomkabel/google-ai-mode-mcp");
  });

  it("pi's extension pins exactly the version package.json publishes", () => {
    const ext = read("extensions/google-ai-search.ts");
    expect(ext).toContain(`${pkg.name}@${pkg.version}`);
    // The unscoped upstream name must never appear as a spawn target.
    expect(/google-ai-mode-mcp@/.test(ext.replace(pkg.name, ""))).toBe(false);
  });

  it("README documents the verifiers and their npm scripts exist", () => {
    const readme = read("README.md");
    const scripts = Object.keys(pkg.scripts);
    for (const s of ["check:harness", "check:harness:spawn", "check:harness:selftest", "check:orphans"]) {
      expect(scripts, s).toContain(s);
      expect(readme, s).toContain(`npm run ${s}`);
    }
    for (const f of [
      "scripts/check-harness-wiring.mjs",
      "scripts/selftest-harness-wiring.mjs",
      "scripts/check-orphan-mcp.mjs",
      "tests/orphan-shutdown-dead-stderr.test.ts",
      "tests/support/async-stderr.mjs",
    ]) {
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    }
  });

  it("both shutdown gates stay present and distinct", () => {
    expect(read("tests/orphan-shutdown.test.ts")).toContain("burned");
    expect(read("tests/orphan-shutdown-dead-stderr.test.ts")).toContain("async-stderr.mjs");
  });
});
