# 0003. Make the repository public so releases can carry provenance

Date: 2026-11-21

## Status

Accepted

## Context

ADR 0002 built the trusted-publishing pipeline and recorded one hard ceiling on
it: npm generates provenance attestations only when publishing via trusted
publishing **from a public repository**, and — explicitly — not from private
repositories "even when publishing public packages". The package is public; the
repository was not, so a consumer could verify *what* shipped but not *where or
how* it was built.

The drift was already on the record. ADR 0001's Assumptions state that "this
repository is public"; the live API reported `PRIVATE` when this decision was
taken. The intent predates the implementation.

Visibilities were ranked with the tiltrank rubric (record: `.decisions.log`,
pick and runner-up logged). The rubric returned `Contested` /
`ESCALATE not-separable`, so it was escalated rather than decided: a probe ran
over the full commit history of every ref to falsify the public option, and it
weakened the case against it instead — no secret-shaped string appears anywhere
in the history, every file ever committed is ordinary source, documentation or
test, and `.decisions.log`, the one artefact ADR 0001 deliberately keeps out of
git, is untracked and therefore stays private under either visibility.

## Requirements

- "the most recommended, most well-recommended (by cybersecurity experts) and
  most extensive way according to documentation possible" — hard, the operator.
  Both surviving options pass it; provenance is what separates them.
- "this repository is public" — soft, the repository (ADR 0001, Assumptions).

## Options considered

- **Make the repository public** (chosen). Highest fit and the established shape
  for this problem, at the cost of exposure that cannot be walked back: history
  is crawled and forked.
- **Keep it private, shipping with the enforced disclosure** (runner-up). Trivially
  reversible and keeps the working history closed, but leaves the
  security-relevant property — verifiable build origin — permanently absent.
  *The ranking's lead rested on fit and precedent; this option tops the order as
  soon as exposure is weighted higher.*
- **Sync a public release mirror and publish from there** (not chosen). Satisfies
  the same requirement while keeping the development history closed, but adds a
  permanent second repository and points the attestation's source at a mirror
  rather than at the code's home.

## Decision

The repository is public as of 2026-11-21. The trusted-publisher connection
binds repo, workflow filename and environment, none of which change here, so the
pipeline from ADR 0002 is unaffected.

Secret scanning, push protection and Dependabot security updates were enabled
while doing it. `secret_scanning_validity_checks` and
`secret_scanning_non_provider_patterns` were requested and are still `disabled`:
the settings API returns success and does not apply them, so they are treated as
unavailable on this account rather than as configured.

`RELEASING.md`'s provenance disclosure was rewritten in the same change — V2
refused the tree until it was, failing with `P03_disclosure_visibility_stale`
because the disclosure still said `PRIVATE`. That red was the designed behaviour,
observed on the live change rather than only under mutation.

## Consequences

- Every future release published through `publish.yml` can carry a provenance
  attestation, verifiable with `npm audit signatures`.
- The guarantee is forward-looking. Nothing already published carries one: the
  registry holds `0.0.0-stage`, which predates the pipeline. The disclosure states
  this rather than implying otherwise.
- The whole history, both ADRs, `bug.md` and `PLAN.md` are now world-readable.
- Making the repository private again does not revoke issued attestations, but
  stops new ones; V2 fails with `P03` until the disclosure is updated, so the
  change cannot be made silently.

## Assumptions

- No secret-shaped string exists in any commit of any ref, and no file requiring
  privacy was ever tracked. Measured by a history-wide sweep, not sampled.
- Publication does not expose anything the npm tarball does not already carry:
  `files` limits the package to `dist`, `extensions`, `README.md` and `LICENSE`.

## What would make this wrong

- If a secret exists that the sweep's patterns do not cover, publication is the
  moment it becomes exploitable. The sweep covers common provider prefixes and
  private-key headers only.
- If the repository is expected to hold private material later, that material must
  go elsewhere; this decision cannot be quietly reversed.
