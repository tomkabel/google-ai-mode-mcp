# Releasing `@tomkabel/google-ai-mode-mcp`

Operator runbook for publishing this package. It is also the document **V2**
(`scripts/check-publish-posture.mjs`) audits: the disclosure line below is a
machine-checked contract, not prose.

## Provenance status — disclosure

<!-- provenance-disclosure: repository visibility is PRIVATE, so npm generates no provenance attestation for any release. -->

A private repository is a hard ceiling on this pipeline. `docs.npmjs.com/trusted-publishers`
states provenance is generated only when **all** of these hold: publishing via
trusted publishing, publishing from a *public* repository, publishing a public
package. It adds, explicitly, that provenance is **not supported for private
repositories even when publishing public packages**. The package is public; the
repository is not.

So today a consumer can verify *what* was published (registry shasum, and the
shasums this repo checks against it) but cannot verify *where and how* it was
built. Making the repository public is the single change that lifts this, and it
is a decision with its own cost: every commit, this file and the ADR become
world-readable.

V2 enforces the honesty of this paragraph: it fails with `P02_disclosure_missing`
if the line above is removed, and with `P03_disclosure_visibility_stale` if the
repository's live visibility stops matching the word `PRIVATE` in it. Flipping
the repository to public therefore *forces* this paragraph to be rewritten rather
than letting it quietly become false.

## Measured state (2026-11-21)

Already true, and verified rather than assumed:

- `@tomkabel/google-ai-mode-mcp` exists on the registry. Its only published
  version is the staged-publishing placeholder `0.0.0-stage`, which is what
  `latest` currently resolves to.
- `1.1.0` is **staged** and awaiting a maintainer 2FA approval — stage id
  `676389b9-3b13-4f8f-8562-f38438b2100e`, shasum
  `4d4dbda851c6adb69823dd75151b4cfe701d79f3`, dist-tag `latest`.
- That shasum equals `npm pack` of this tree, so "the staged artifact is this
  code" is a checked fact.
- GitHub Actions schedules jobs in this repository: probe run `44847913983`
  picked up a runner 3 s after the push and completed `success`.
- `README.md` advertises `@tomkabel/google-ai-mode-mcp@1.1.0`, which currently
  returns `E404` because that version is staged and not yet approved.

Not yet done: the npm trusted-publisher connection does not exist. Nothing on
npmjs.com has been changed.

## Order of operations

The two hard constraints make the order non-negotiable:

- the workflow filename and the environment name in the connection are
  **immutable** once created — changing either means deleting the connection and
  making a new one;
- a new connection **expires after 2 days** if it does not complete a first
  successful publish, and an expired connection cannot be edited.

1. **Merge this branch to `main`.** `.github/workflows/publish.yml` must exist on
   the commit you will tag. (Until this branch merges, `main` still carries the
   upstream package identity and the workflow's name/`repository.url` would not
   match the trusted publisher.)
2. **Create the GitHub environment** `npm-publish` with required reviewers
   (Settings → Environments). This is the human approval gate in front of the
   runner.
3. **Configure the trusted publisher** at
   `https://www.npmjs.com/package/@tomkabel/google-ai-mode-mcp/access`:

   | Field | Value |
   | --- | --- |
   | Publisher | GitHub Actions |
   | Organization or user | `tomkabel` |
   | Repository | `google-ai-mode-mcp` |
   | Workflow filename | `publish.yml` (filename only) |
   | Environment name | `npm-publish` |
   | Allow `npm publish` | **leave unticked** |
   | Allow `npm dist-tag` | leave unticked |

   This must be done in a browser with 2FA. Since August 2026 a 2FA-bypass token
   can no longer change trusted-publishing configuration at all, so no CLI or
   token path exists for this step.

   Leaving both boxes unticked is the strongest documented posture: the
   connection may only submit packages for review (`npm stage publish` is always
   allowed for new connections), and never lands a version on the registry by
   itself.

4. **Validate the connection within 2 days**: approve the staged `1.1.0` if it is
   still what you want to ship, or cut a tag and let the workflow stage a fresh
   one. Confirm the OIDC exchange works (no `ENEEDAUTH`) before the window closes.
5. **Only after a green release**, set Publishing access to
   **"Require two-factor authentication and disallow bypass 2fa tokens
   (recommended)"**, then revoke any leftover automation token on the account.
   Setting this first would lock you out of finishing step 3/4 if something goes
   wrong, which is why the docs put it after validation.
6. **Add a tag-protection ruleset** for `v*` so only maintainers can create the
   refs that publish.

## What the workflow does

Triggered by a `v*` tag push or manually (`workflow_dispatch`). It checks out
the tagged commit, pins Node and npm to the exact versions that produced the
verified tarball, builds, requires the tag to equal `package.json`'s version,
runs `npm run check:code`, runs the V2 posture gate, and then stages the release.
The runner holds `contents: read` and `id-token: write` and nothing else; the
repository's default workflow permission is `read`.

Two deliberate choices that are easy to "fix" wrongly:

- **`npm install -g npm@12.2.3` and `node-version: 24.22.3` are reproducible-build
  pins, not decoration.** V1 (`E10_published_artifact_mismatch`) compares the
  registry shasum against a `npm pack` run *on the local machine*. If the runner
  packs with a different npm major, the gzip bytes differ and a genuine pass
  turns into a false red. Pin both, or expect E10 noise.
- **`npm run build` is explicit because npm 12 turned install-time scripts off by
  default.** Do not rely on the `prepare` lifecycle running under `npm ci`.

The workflow does **not** run `npm run check:harness`. That check is
machine-local by design, and its published-artifact probe is conditional on a
harness actually resolving the pinned package — on a clean runner it verifies
nothing.

## Acceptance

```bash
# V1 — registry artifact == this tree's build (green once 1.1.0 is approved)
node scripts/check-harness-wiring.mjs --deep

# V2 — pipeline posture + disclosure honesty (must be green)
node scripts/check-publish-posture.mjs

# V2 as a selftest: 12 structural mutations, each must be caught
node scripts/check-publish-posture.mjs --mutate

# Attestation readability (only meaningful once the repository is public)
npm audit signatures
```

## Known gaps and unverified items

- **`P13_attestation_absent` is unexercised.** It can only fire when the
  repository is public, so no mutation in the selftest reaches it. Treat the
  public-branch of that check as untested code until the repository is public.
- **npm 12 install-script defaults may affect consumers.** npm 12 sets
  `allowScripts` off, so a dependency's `postinstall` no longer runs on a plain
  install. If `patchright` downloads a browser in its `postinstall`, a fresh
  consumer install will no longer fetch it. This has not been measured here;
  the probe is a clean-room `npm ci` on npm 12.2.3 followed by a launch attempt.
- **The Dependabot queue in this repository is stuck** (three jobs `queued`
  since 2026-11-20T13:22:11Z) while ordinary workflows run normally. Unrelated to
  publishing, but do not read that queue as "Actions is down".
- **The workflow has never run.** Its first real execution is the validation
  publish in step 4; the structural invariants are enforced by V2, not by
  experience.
