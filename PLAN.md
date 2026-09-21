# Remediation Plan — google-ai-mode-mcp

Status: drafted 2026-09-22, after a live audit of the 1.0.3 code against the real
Google AI Mode page. Commit `0193a29` already landed the emergency fixes (Phase 1
of the *bug* work); this plan covers what makes those fixes hold.

---

## 1. What the audit actually found

Twenty-odd defects, but only **five root causes**. Fixing the list without fixing
the causes buys a month.

| # | Root cause | Evidence | Consequence |
|---|---|---|---|
| **C1** | **Silent success** — every failure path returns `success: true` with empty or sourceless output | Live 1.0.3 run: `Extracted 5 citations with 0 total sources`, `success: true` | The calling LLM cannot tell "no answer" from "answer"; it hallucinates over the gap |
| **C2** | **Selector rot is invisible** — 19 citation selectors matched 0 nodes; nothing failed | `"Seotud lingid"` in code, `"Seotud tulemused"` on the page | Google ships a label change; the server degrades silently and nobody knows for weeks |
| **C3** | **Claims outrun the code** — "adaptive stealth", human typing, mouse movement, 8 env vars | `src/utils/stealth-utils.ts` (497 lines) imported by nothing in `src/` | Users tune knobs that are not wired to anything; reviewers trust comments over behaviour |
| **C4** | **Retry without a hypothesis** — zero sources re-ran the entire search | `tool-handler.ts:63` | 2× browser time and 2× CAPTCHA exposure against a structural cause it could never fix |
| **C5** | **Default configuration does not work** — `headless: true` is CAPTCHA-bait | Headless → `/sorry` immediately on this IP, cold *and* warm profile; headed succeeds | The out-of-the-box experience is a CAPTCHA loop |

Everything else (path traversal, `progressToken` on the wrong object, `marker_id || 999`,
`timeout_ms` ignored, missing `isError`, exit code 0 on crash) is a symptom of the same
thing: **the code was never run against the thing it talks to.**

## 2. Ground truth established by probe (2026-09-21/22)

Decisions below rest on measurements, not reading:

1. **Citation URLs are opaque redirects.** Every source href is
   `https://www.google.com/goto?url=CAES…`. The old extractor's `skipDomains`
   filter dropped anything containing `google.com`, i.e. 100% of sources.
2. **Those redirects resolve in one hop.** `context.request.get(href, {maxRedirects: 0})`
   → `302` with `location: https://en.wikipedia.org/wiki/Quantum_tunnelling`,
   measured **59–508 ms** per link, parallelizable, cookies already in the context.
3. **Google's own payload also carries plain URLs.** The `/async/folwr` response
   (~537 KB) embeds `https://en.wikipedia.org/…`, publisher names, favicons — but as
   positional, null-padded arrays that would need a fuzzy join back to DOM markers.
   **Rejected** in favour of (2): exact beats clever.
4. **Completion timing.** The old `button svg[viewBox="0 0 24 24"]` signal fired at
   **427 ms against a 0-char answer**; the real answer completes at ~5.6 s.
5. **Headless is not viable on residential IPs** (see C5).

---

## 3. Final solutions (decisions, with the alternatives that lost)

### S1 — Fail loud, in a shape a machine can branch on
`SearchResult` gains `status: "ok" | "degraded" | "failed"`, `errorCode`, and
`warnings: string[]`. Degradation rules, evaluated in one place:

| Condition | Result |
|---|---|
| markdown < 200 chars | `failed`, `errorCode: EXTRACTION_EMPTY`, `isError: true` |
| citations > 0, sources == 0 | `degraded`, `warning: "citation labels did not parse — selector/format drift"` |
| completion method == `timeout` | `degraded`, `warning: "answer may be truncated"` |
| AI Mode unavailable / CAPTCHA | `failed` with `AI_MODE_UNAVAILABLE` / `CAPTCHA_REQUIRED` |

*Rejected:* throwing on degradation (a truncated answer is still useful), and
free-text `error` only (clients cannot branch on prose).

### S2 — Make selector rot fail in CI, offline
Move the in-page extraction into one pure DOM function, `extractCitationsFromDom(document)`,
and run it under jsdom against **golden fixtures captured from the live page** in
`en`, `de`, `et`. Plus an inventory test: every selector in `CITATION_SELECTORS` must
match ≥1 node in ≥1 fixture, or it is dead and gets deleted.

*Rejected:* live tests in CI (Google CAPTCHAs datacenter IPs; a flaky red job
teaches the team to ignore red). Live checking moves to `npm run smoke`, run by a
human before release.

### S3 — Return real URLs
Resolve each `/goto?url=` through the browser's request context, `maxRedirects: 0`,
read `location`; concurrency cap 8, 5 s per request, `Promise.allSettled`, fall back
to the redirect URL on failure. Tool param `resolve_source_urls` (default `true`).
Grounded in probe (2): worst case observed +0.5 s wall clock for 12 sources.

### S4 — Retry only what retrying can fix
Delete the zero-source re-search. Keep exactly one bounded retry around *transient*
navigation/timeout failures, where a second attempt has a mechanism to succeed.
Structural extraction failure surfaces as `degraded` (S1) instead.

### S5 — Stop paying for a headless attempt that cannot work
Persist a `headlessBlocked` flag (+24 h TTL) in the profile dir the first time a
headless navigation lands on `/sorry`; subsequent searches go straight to visible.
Stop treating "restart the browser" as the default CAPTCHA remedy — the warm profile
is the single most valuable anti-CAPTCHA asset, and the restart throws it away.
Backoff becomes exponential with jitter.

### S6 — Delete what is not true
`stealth-utils.ts`, its test, and the 9 config keys + 8 env vars nothing reads, out.
README and `package.json` describe only what the code does: Patchright, a persistent
profile, and a UA probed from the installed Chrome. A doc-drift test asserts the
README env table equals the keys in `src/config.ts`.

---

## 4. Phased implementation

Ordered by risk removed per hour. Each phase is independently shippable and leaves
the repo green.

### Phase 0 — Unblock the repo *(5 min, needs you)*
`origin` = `git@github.com:tomkabel/google-ai-mode-mcp.git` returns "repository not
found" (SSH auth is fine; `gh repo view` 404s). Commit `0193a29` is local-only.
**Decision needed:** new remote URL, or recreate the repo.

### Phase 1 — Fail loud + stop lying *(~3 h)*
- `src/types.ts`: `status`, `errorCode` (enum), `warnings` on `SearchResult`.
- `src/search/search-handler.ts`: single `classifyResult()` applying the S1 table.
- `src/index.ts`: `isError` from `status === "failed"`; version read from
  `package.json` (three hardcoded `1.0.3` strings today); drop the unused
  `logging: {}` capability.
- `src/tools/tool-handler.ts`: delete the zero-source retry (S4).
- Delete `src/utils/stealth-utils.ts`, `tests/stealth-utils.test.ts`, dead config
  keys (`stealth*`, `typingWpm*`, `minDelayMs`, `maxDelayMs`, `viewport`,
  `citationTimeout`, `VIEWPORT_SIZES`), matching env vars and README rows (S6).
- `ensureDirectories()` out of module import, into server start.
- Fix `timeout_ms` doc (says 120000, is 30000).

**Done when:** no path returns `success: true` with < 200 chars of markdown;
`grep -r "stealthHumanTyping" src/` is empty; unit tests cover every S1 rule.

### Phase 2 — Make rot detectable *(~4 h)*
- Capture `main-col` fixtures (en/de/et) into `tests/fixtures/`, session data scrubbed.
- Extract `src/search/citation-dom.ts` (pure, DOM-API only); `page.evaluate` calls it.
- jsdom tests: markers injected in document order, sources parsed, locale coverage.
- Selector-inventory test (S2).
- Promote `tests/manual-e2e.ts` to `npm run smoke` with assertions and an exit code.
- Document the tsx/esbuild `keepNames` trap: `page.evaluate` bodies break under
  `npm run dev` (`__name is not defined`); live runs use `npm run build && node dist/`.

**Done when:** renaming an aria-label in a fixture turns CI red.

### Phase 3 — Make the output worth reading *(~3 h)*
- `resolveSourceUrls()` per S3, with `resolve_source_urls` tool param.
- Thread `timeout_ms` into `waitForAiCompletion` and `extractAiResponse`
  (both still read module constants / global `CONFIG`).
- Type `performSearch(page: Page)` — currently `any`.
- Wrap returned markdown in an explicit untrusted-content delimiter and say so in the
  tool description: this is unvetted web text reaching an LLM, and the prompt-injection
  surface is the whole product.
- Single-flight queue for `search_ai`: concurrent calls share one context today, and a
  CAPTCHA-driven context swap closes it under an in-flight search.

**Done when:** `sources[].url` is a publisher URL in `npm run smoke`; two concurrent
tool calls both return successfully.

### Phase 4 — A CAPTCHA strategy that matches reality *(~3 h)*
- `headlessBlocked` sticky flag + TTL (S5).
- Exponential backoff with jitter; restart only after a solved-CAPTCHA attempt failed.
- README: state plainly that headless-by-default fails on many residential IPs, with
  the headed / `xvfb-run` recipe next to it.

**Done when:** a blocked headless run makes exactly one headless attempt, and the
next search skips headless entirely.

### Phase 5 — CI and release hygiene *(~2 h)*
- `.github/workflows/ci.yml`: Node 20 + 22 → `npm ci`, `tsc --noEmit`, `vitest run`,
  `npm pack --dry-run`. No browser jobs.
- `npm run check` = typecheck + test; `prepublishOnly` = check + build.
- Doc-drift test (README env table vs `src/config.ts`).
- `CHANGELOG.md`, version → 1.1.0.

**Done when:** CI is green on PR and `npm pack` ships `dist/` only.

---

## 5. Deliberately not doing

Proxy rotation · CAPTCHA-solving services · intercepting `/async/folwr` (§2.3) ·
eslint/prettier (`tsc --noEmit` + tests carry the weight) · session pooling ·
per-citation snippet extraction · a headless stealth arms race with Google.

## 6. Open decisions for you

1. **Remote** — where does this push? (Phase 0 blocker.)
2. **`resolve_source_urls` default** — `true` costs ~0.5 s and gives real URLs; `false`
   is faster and returns Google redirects. Recommend `true`.
3. **Headless default** — keep `true` (fails fast, then falls back per S5) or flip to
   `false` and be honest about what works? Recommend keeping `true` with S5.
4. **npm publish** — is 1.1.0 going out under this name, or is this a fork you run locally?
