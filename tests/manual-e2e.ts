/**
 * Manual end-to-end run of the real SearchHandler (not part of `npm test`).
 * Run: GOOGLE_AI_PROFILE_DIR=/tmp/gam-e2e GOOGLE_AI_CAPTCHA_TIMEOUT=10000 \
 *      npx tsx tests/manual-e2e.ts "query"
 */
import { SearchHandler } from "../src/search/search-handler.js";

const handler = new SearchHandler();
const result = await handler.executeSearch(process.argv[2] || "node lts version");
console.log(
  JSON.stringify(
    {
      success: result.success,
      error: result.error,
      captchaRequired: result.captchaRequired,
      sources: result.sources.length,
      markdownLen: result.markdown.length,
      markdownHead: result.markdown.slice(0, 300),
    },
    null,
    2
  )
);
await handler.cleanup();
