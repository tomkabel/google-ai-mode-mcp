# Changelog

## Unreleased

### Breaking
- `search_ai` no longer returns `sources`; it returns `sourceCount` instead. Source titles, URLs and publishers are page text and appeared outside the untrusted fence. They remain in the source list inside the fenced `markdown`.
- The fenced `markdown` body now sits in a backtick code fence inside the markers, one backtick longer than the longest backtick run in the body (minimum three). Raw HTML such as `<!--`, `<script>` or `<style>` in page text could hide the END marker in a renderer with HTML enabled (e.g. markdown-it `html: true`); in a code fence it renders as text. Clients that strip the markers must also strip the fence lines. Saved files are unchanged.

### Fixed
- Every client snippet in the README now installs the pinned scoped package instead of a local build; a local build remains documented for development and is accepted by the wiring verifier. `npm run check` now includes the harness-wiring check.
- Clients were wired to the **archived upstream package**, not this fork: `npx google-ai-mode-mcp@latest` resolves to npm `1.0.3` (upstream `PleasePrompto/google-ai-mode-mcp` is archived since 2026-09-10), which carries none of the shutdown fixes below — that is the build seen spinning at ~100% CPU in `bug.md`. Codex, Zed, Kilo and the npx cache were retargeted at this repo's `dist/index.js`; README install snippets no longer advertise the published route.
- `dist/` could silently lag `src/` (Claude Code, Hermes and pi all execute the built `dist/index.js`), so a fix could be committed and never run. `npm run check:harness` now fails with `E03_build_stale` when `dist/` is not a byte-identical compile of `src/`.

### Added
- **Published as `@tomkabel/google-ai-mode-mcp@1.1.0`** (public). The unscoped `google-ai-mode-mcp` belongs to the archived upstream and cannot be fixed by this fork: `npm access`/publish against it returns 403 for this account. The scoped package's registry tarball is asserted byte-identical (same shasum as `npm pack` of this tree) by the wiring verifier, so "the published artifact is this code" is a checked fact rather than an assumption. `package.json` identity, README badges/links and the pi extension pin now point at the fork.
- `scripts/check-harness-wiring.mjs`: per-surface verifier for every configured MCP client (Claude, Codex, Zed, Kilo, Kimi Code, Hermes, pi) plus the npx cache. Accepts two targets — this repo's `dist/index.js`, or the pinned published package whose tarball shasum must equal this tree's pack. Codes `E00`–`E11`; a code that is neither `PASS` nor a reported `SKIPPED_absent` fails the run; `--deep` byte-compares a fresh compile against `dist/`, `--spawn` completes a real MCP `tools/list` handshake requiring `search_ai`, `--require-all` turns absent surfaces into failures.
- `scripts/check-orphan-mcp.mjs`: report-only watchdog for orphaned MCP servers burning CPU (never kills — it is a cross-tool scan on a shared machine). Run with `npm run check:orphans`.
- `tests/orphan-shutdown-dead-stderr.test.ts` + `tests/support/async-stderr.mjs`: deterministic sibling of the frozen shutdown gate. The frozen test's red is racy (measured 3 reds in 15 runs at the pre-fix commit, all under load); this one injects the real-world async EPIPE from a dead log reader and asserts the server still exits 0. Measured 3/3 red at the pre-fix commit (exit 1, uncaughtException) and 3/3 green at HEAD.
- `npm run check:harness`, `check:harness:spawn`, `check:harness:selftest`, `check:orphans`; the harness check now runs inside `npm run check` (absent surfaces skip, so it is portable), while `prepublishOnly` gates only on `check:code`.
- Server no longer spins at 100% CPU forever after the MCP host exits. With all stdio pipes closed, the shutdown log line hit `EPIPE` on stderr; `console.error` only swallows synchronous write errors, so the async `error` event became an `uncaughtException`, whose handler logged to stderr again, an endless `nextTick` loop that starved the event loop. stderr now has a persistent `error` listener that silences logging, stdout `EPIPE` and `SIGHUP` trigger shutdown, faults during shutdown exit at once, and shutdown is capped at 10 s. Regression test: `tests/orphan-shutdown.test.ts`.
- Page text could close the untrusted-content fence early: the static `<<<END_UNTRUSTED_WEB_CONTENT>>>` marker survived as HTML entities, emphasis splits, zero-width or soft-hyphen characters and backslash escapes. Both markers now carry a random per-response id, `<<<UNTRUSTED_WEB_CONTENT id=…>>>` … `<<<END_UNTRUSTED_WEB_CONTENT id=…>>>`; only the END marker with the opening id closes the fence, and page text passes through unaltered. Clients that matched the old bare markers must match the `id=` form. Saved files stay unwrapped.

## 1.1.0 — 2026-09-22

Remediation release grounded in live probes against the real AI Mode page (see `PLAN.md`).

### Breaking
- `SearchResult` gains `status: "ok" | "degraded" | "failed"`, `errorCode` and `warnings[]`. `success` stays for compatibility (`status !== "failed"`).
- Answers under 200 chars are now `failed` / `EXTRACTION_EMPTY` with MCP `isError: true` instead of `success: true` with empty markdown.
- Returned `markdown` is wrapped in `<<<UNTRUSTED_WEB_CONTENT>>>` … `<<<END_UNTRUSTED_WEB_CONTENT>>>`. Saved files are unwrapped.
- Removed config keys and env vars that nothing read: `GOOGLE_AI_STEALTH_*`, `GOOGLE_AI_TYPING_WPM_*`, `GOOGLE_AI_MIN/MAX_DELAY_MS`, `GOOGLE_AI_CITATION_TIMEOUT`, `viewport`, `VIEWPORT_SIZES`. `src/utils/stealth-utils.ts` deleted.

### Added
- `resolve_source_urls` tool param / `GOOGLE_AI_RESOLVE_SOURCE_URLS` (default `true`): Google `/goto?url=` redirects are resolved to publisher URLs via the browser's request context (8 concurrent, 5 s each, falls back to the redirect URL).
- `headless-blocked` flag in the profile dir (24 h TTL): after headless lands on a CAPTCHA once, subsequent searches go straight to the visible browser. Explicit `headless: true` overrides.
- Single-flight queue for `search_ai`: concurrent calls run one at a time on the shared context.
- `npm run check` (typecheck + tests), `npm run smoke` (live run with assertions and exit code), `prepublishOnly` runs `check`.
- Doc-drift test: README and `.env.example` env vars must equal what `src/config.ts` reads.

### Changed
- Zero-source re-search removed; missing sources surface as `status: "degraded"` with a warning.
- `timeout_ms` now reaches completion detection and extraction, not just navigation. Default documented as 30000 (was wrongly 120000).
- CAPTCHA restart cooldown is exponential with jitter (30 s → 60 s → 120 s → 240 s cap). The profile is never wiped.
- After a solved CAPTCHA the browser stays visible instead of relaunching headless.
- Version read from `package.json` in one place; `ensureDirectories()` runs at server start, not on import.
- README describes only what the code does.

### Not done (needs a live session)
- Golden DOM fixtures (en/de/et) and the jsdom selector-inventory test (PLAN.md Phase 2).
- GitHub Actions workflow (repo has no remote).
