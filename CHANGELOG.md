# Changelog

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
