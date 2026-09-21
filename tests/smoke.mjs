/**
 * Live smoke test against real Google (not part of `npm test`; needs a display
 * or xvfb-run). Imports from dist/ on purpose: tsx/esbuild `keepNames` breaks
 * page.evaluate bodies (`__name is not defined`).
 *
 * Run: npm run smoke -- "query"
 * Exit 0 only when the result is ok/degraded with >=1 publisher URL.
 */
import assert from "node:assert/strict";
import { SearchHandler } from "../dist/search/search-handler.js";

const handler = new SearchHandler();
const query = process.argv[2] || "how does quantum tunneling work";
const result = await handler.executeSearch(query);
await handler.cleanup();

console.log(
  JSON.stringify(
    {
      status: result.status,
      errorCode: result.errorCode,
      error: result.error,
      warnings: result.warnings,
      sources: result.sources.length,
      publisherUrls: result.sources.filter((s) => !/google\.com\/goto/.test(s.url)).length,
      markdownLen: result.markdown.length,
      markdownHead: result.markdown.slice(0, 300),
    },
    null,
    2
  )
);

try {
  assert.notEqual(result.status, "failed", `search failed: ${result.errorCode} ${result.error}`);
  assert.ok(result.markdown.length >= 200, "markdown shorter than 200 chars");
  assert.ok(result.sources.length > 0, "no sources extracted");
  assert.ok(
    result.sources.some((s) => !/google\.com\/goto/.test(s.url)),
    "no source resolved to a publisher URL"
  );
  console.log("SMOKE OK");
} catch (e) {
  console.error(`SMOKE FAIL: ${e.message}`);
  process.exit(1);
}
