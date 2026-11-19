# Changelog

## Unreleased

### Fixed
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
