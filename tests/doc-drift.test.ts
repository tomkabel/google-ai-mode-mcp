/**
 * README / .env.example must describe exactly the env vars src/config.ts reads.
 * Turns "docs mention knobs that are wired to nothing" (PLAN.md C3) into a red test.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf-8");
const vars = (text: string) => new Set(text.match(/GOOGLE_AI_[A-Z0-9_]+/g) ?? []);

const inCode = vars(read("src/config.ts"));

describe("doc drift", () => {
  it("README env table matches src/config.ts", () => {
    const table = read("README.md")
      .split("\n")
      .filter((l) => /^\| `GOOGLE_AI_/.test(l))
      .join("\n");
    expect([...vars(table)].sort()).toEqual([...inCode].sort());
  });

  it("README mentions no env var the code does not read", () => {
    for (const v of vars(read("README.md"))) expect(inCode, v).toContain(v);
  });

  it(".env.example matches src/config.ts", () => {
    expect([...vars(read(".env.example"))].sort()).toEqual([...inCode].sort());
  });

  it("tool schema params match SearchOptions handled by the tool handler", async () => {
    const { SEARCH_AI_TOOL } = await import("../src/tools/search-tool.js");
    const schemaParams = Object.keys(SEARCH_AI_TOOL.inputSchema.properties ?? {}).sort();
    const destructured = read("src/tools/tool-handler.ts").match(/const \{ ([^}]+) \} = args;/)?.[1] ?? "";
    const handled = destructured.split(",").map((s) => s.trim());
    expect(schemaParams).toEqual([...handled].sort());
  });
});
