# 0002. Publish through npm trusted publishing, stage-only, with a disclosed provenance gap

Date: 2026-11-21

## Status

Accepted

## Context

ADR 0001 published this fork as `@tomkabel/google-ai-mode-mcp@1.1.0` from a
developer machine, and recorded the blocker: `npm publish` returns `EOTP` even
with an account token, so publishing needed an operator action. Two
documentation findings make that route both weaker and time-limited:

1. npm's own recommended posture is trusted publishing over tokens — short-lived,
   workflow-scoped credentials that cannot leak from a CI log, with provenance
   attestations generated automatically.
2. `2FA-bypass` granular access tokens lose the ability to publish directly
   around **January 2027**, and already lost the ability to change
   trusted-publishing configuration in August 2026. A long-lived publish token is
   therefore not a durable answer.

Measured state at the time of this decision: the package exists on the registry
as the staged-publishing placeholder `0.0.0-stage`; `1.1.0` is staged (id
`676389b9-…`, shasum `4d4dbda851c6adb69823dd75151b4cfe701d79f3`) and the shasum
equals `npm pack` of this tree; GitHub Actions schedules jobs in this repository
(probe run `44847913983`, runner assigned in 3 s), while the Dependabot queue has
been stuck since 2026-11-20T13:22:11Z.

The forced constraint: **this repository is private**, and npm does not generate
provenance attestations from private repositories, even when the published
package is public.

## Options considered

- **Posture.** *Trusted publishing with stage-only allowed actions plus a
  `npm-publish` environment* (chosen) vs *trusted publishing allowing direct
  publish* (weaker: no human in the loop) vs *keep the token route* (fails the
  January 2027 deprecation and the account's own 2FA enforcement).
- **Provenance gap.** *State the gap in the release document as a
  machine-checked disclosure* (chosen) vs *encode its absence as a permanent
  failing check* (rejected: a gate that can never go green stops carrying
  information) vs *say nothing* (rejected: an implied blind spot reads as a
  guarantee).
- **Verification.** *A second, independent verifier beside V1* (chosen) vs
  *extend V1* (rejected: V1's byte-identical write-protection is what makes its
  shasum claim honest) vs *no gate* (rejected: an unenforced posture rots).

## Decision

- `.github/workflows/publish.yml` stages releases over OIDC from the `npm-publish`
  environment, with `permissions: {}` at the top level and only `contents: read`
  plus `id-token: write` on the job. It carries no token of any kind.
- Node and npm are pinned on the runner to the exact versions that produced the
  verified tarball (`24.22.3` / `12.2.3`), because V1's `E10` compares the
  registry shasum against a *local* `npm pack`; a different npm major repacks the
  tarball and turns a real pass into a false red.
- `scripts/check-publish-posture.mjs` is a **new** verifier (V2, codes P00–P13).
  It audits the pipeline's posture and the honesty of the provenance disclosure.
  V1 is untouched.
- `RELEASING.md` carries the disclosure line V2 enforces, the exact
  trusted-publisher field values, and the order of operations.

## Consequences

- Releases require a maintainer's 2FA twice: the GitHub environment approval and
  the staged-package approval. That is the design, not a limitation.
- The trusted-publisher connection is immutable in two respects — the workflow
  filename and the environment name are fixed once created — and expires if it
  does not complete a first publish within 2 days. The workflow must therefore be
  on `main`, and the environment must exist, *before* the connection is created.
- Provenance remains absent while the repository is private, so consumers can
  verify *what* shipped but not *where it was built*. V2 fails with
  `P03_disclosure_visibility_stale` when the repository's live visibility stops
  matching the disclosure, so making the repository public forces this document
  to be updated instead of silently invalidating it.

## Assumptions

- `npm stage publish` reaching a staged-but-unapproved state counts as the
  connection's validating interaction within the 2-day window. This is not
  stated in npm's documentation and is **unverified**; the fallback is to
  temporarily allow direct publish, complete one publish, then remove that
  permission.
- `P13_attestation_absent` cannot be exercised while the repository is private
  and is therefore untested code until the visibility changes.

## What would make this wrong

- If npm 12's install-script defaults stop a dependency's `postinstall` from
  running for consumers, the published artifact is installable but not usable —
  a consumer-side failure the registry cannot see. Probe: clean-room `npm ci`
  under npm 12.2.3, then launch the server.
- If the runner's packed tarball does not byte-match the local `npm pack`, `E10`
  fails on a correct release. The pins above are the mitigation, and `E10` is the
  instrument that reveals any residual mismatch.
- If the repository is made public, the disclosure paragraph becomes false until
  rewritten, and `P03` is what says so.
