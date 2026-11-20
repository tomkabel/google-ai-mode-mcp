# 0001. Publish the fork as a scoped npm package and pin every harness to a verified build

Date: 2026-11-20

## Status

Accepted

## Context

`bug.md` reported `google-ai-mode-mcp` burning a full CPU core indefinitely
(31.6 CPU-hours in 43.5 h of uptime) after its MCP host exited. The shutdown fix
had landed in this fork, but three separate defects meant it was not running
where it mattered:

1. **`dist/` was stale** — built 2026-09-22 while the fixes landed 2026-11-18.
   Claude Code, Hermes and the pi extension all execute the built artifact.
2. **Three harnesses ran the archived upstream** — Codex, Zed and Kilo were wired
   to `npx google-ai-mode-mcp@latest`, which resolves to npm `1.0.3` of
   `PleasePrompto/google-ai-mode-mcp` (archived 2026-09-10). That is the exact
   build in the bug report.
3. **Two live orphans were spinning** — measured at 5950584 ticks (~16.5
   CPU-hours) and 15489410 ticks (~43.0 CPU-hours), both reparented to
   `systemd --user`. A third member of the same class, the claude-mem plugin's
   `chroma-mcp` child, had accumulated ~14 CPU-hours.

The published name cannot be repaired by this fork: `google-ai-mode-mcp` is
maintained by the upstream author (`npm view` shows maintainer
`pleaseprompto`), `npm access list packages` for this account returns 403, and a
publish attempt against it fails. `NPM_STAGING_TOKEN` authenticates as
`tomkabel`, and a dry-run publish to the `@tomkabel` scope succeeds.

Decisions were made with the `tiltrank` rubric (script: `scripts/rubric.py` in
the tiltrank skill); the ranking records are in the local `.decisions.log`
(gitignored — see Assumptions) and the options/`lead rests on` lines are quoted
below.

## Requirements

- "never edit that test file" (the frozen `tests/orphan-shutdown.test.ts`) — hard.
- "require a failure that reports CPU ticks burned while still alive" — hard.
- "ps for orphaned servers (ppid = 1/systemd) still burning CPU on any of those
  paths, measure their /proc CPU ticks before killing them" — hard.
- "check and verify all ai coding harnesses (claude, hermes, codex, pi) use this
  project with the fixed version, not the archived original project" — hard.
- "for npm registry access, NPM_STAGING_TOKEN from ~/.zsh_secrets can be
  leveraged" — hard.
- "do all 4 with extensive, final, proper rigor and quality" — soft.

## Options considered

- **Gate hardening.** *Layer a deterministic second verifier; leave the frozen
  test byte-identical* (chosen) vs *rewrite the frozen test* (excluded — fails
  "never edit that test file") vs *keep the racy gate and document the rate*.
- **chroma-mcp.** *Measure, kill the daemon tree, add a report-only orphan
  watchdog* (chosen; lead rested on `fit_to_constraints`) vs *kill and record
  only* vs *kill only the chroma child* (rejected after the probe showed the
  plugin's launcher respawns the daemon, so a bare child kill is temporary) vs
  *leave it* (excluded — fails the measure-and-kill requirement).
- **Preflight wiring.** *Make the checker treat absent surfaces as SKIP and run
  it from `pnpm run check`* (chosen; lead rested on `fit_to_constraints`) vs
  *local-only plus a cron run* vs *manual only*.
- **Publication.** *Publish the scoped fork; harnesses stay on the local build*
  vs *publish and switch every harness to it* (chosen by the operator, diverging
  from the recommendation) vs *add an unscoped alias* vs *do not publish*
  (excluded — fails "a fixed, installable build exists on the npm registry").
- **Invocation mechanism** (after the operator chose to switch every harness).
  *Inline `npx` with an exact version pin in each surface* (chosen) vs *global
  install* vs *repo-local `node_modules/.bin`*; both `npx --package <tarball>` and
  a temp-prefix global install were probed and serve an MCP handshake, so the
  band stayed marginal and the choice was the operator's.
- **pi.** *Extension spawns the pinned published package* — the only feasible
  option once "every harness on the published package" was required.

## Decision

- Publish the fork as **`@tomkabel/google-ai-mode-mcp@1.1.0`**, public, with
  `package.json` identity, README links and the pi extension pin all moved to the
  fork. The registry tarball's shasum is asserted equal to `npm pack` of this
  tree, so "the published artifact is this code" is a checked fact.
- Repoint the six MCP surfaces (claude, hermes, codex, zed, kilo, kimi-code) at
  `npx -y @tomkabel/google-ai-mode-mcp@1.1.0`; the pi extension pins the same
  version in source, guarded by a doc test.
- Add a **second, deterministic** shutdown gate
  (`tests/orphan-shutdown-dead-stderr.test.ts`) beside the frozen racy one, and
  keep both as named gates.
- Add the report-only orphan watchdog (`scripts/check-orphan-mcp.mjs`) and run
  the harness check from `npm run check` with absent surfaces reported as skips.
- Measure, then kill the orphaned claude-mem daemon tree.

## Consequences

- The unscoped `npx google-ai-mode-mcp@latest` route **cannot be fixed from this
  account**; anyone following the archived upstream README still gets 1.0.3. The
  mitigation is local: README, the doc test, and the wiring verifier all fail or
  object if anything resolves the unscoped package.
- Harness startup now depends on `npx` resolving a registry package instead of a
  local file; the pin is exact, and `E10` fails if the published tarball stops
  matching this tree (a version bump without a publish is reported as an explicit
  skip, not a silent pass).
- `npm run check` now covers machine-local harness wiring, so it can fail for
  reasons unrelated to the code — by design, since "the fix is not running" is
  the defect this ADR is about.
- Publishing is gated by the account's 2FA: `npm publish` returns `EOTP` even
  with the token. Unblocking requires an operator action (an OTP, a token with
  2FA bypass, or the web auth flow). Until then the harnesses stay on the local
  `dist/` build, which the verifier accepts.

## Assumptions

- The registry is `registry.npmjs.org` and `@tomkabel` is this account's scope
  (verified by a successful dry-run publish).
- The `.decisions.log` ranking record is kept out of git: it contains the
  operator's quoted requirements and machine paths, and this repository is
  public. The ADR is the committed record.
- Killing the claude-mem daemon is acceptable because the plugin's own launcher
  respawns it on the next Claude Code session.

## What would make this wrong

- If the operator wants harnesses to follow `latest` rather than an exact pin,
  `E11_unpinned_published_route` must be relaxed deliberately — it exists because
  `latest` is what pointed three harnesses at the archived package.
- If `dist/` is ever published without rebuilding, `E10` catches the mismatch
  only after the version is on the registry.
- If the frozen racy gate is later "fixed" to fire on pre-fix code deterministically,
  this ADR's red-rate measurement (3 reds in 15 runs) becomes stale.
