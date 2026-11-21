# ATS Paperclip fork — GitHub Actions operating policy

**Repository:** `architechsure-ltd/paperclip` (fork of `paperclipai/paperclip`).

**Purpose:** Consume upstream Paperclip selectively, build a dependable ATS deployment, and avoid running upstream maintainers' release programmes, paid evaluations, or recurring dependency bots.

## Normal operating process

1. **Review upstream deliberately.** Compare the fork with upstream, identify changes relevant to ATS, and choose a pinned upstream commit/version. Do not enable automatic upstream synchronisation.
2. **Prepare a feature/update branch.** Bring in reviewed changes, update lockfiles when manifests require it, and open a PR against `master`. No direct push to `master`.
3. **Validate on PR.** Preserve the existing PR/CI and relevant targeted security or regression checks. Select more expensive test suites only for changes that need them.
4. **Merge deliberately.** A human reviews the diff and verification evidence; squash/rebase merge in accordance with the organisation ruleset. No automatic PR merges.
5. **Build and deploy deliberately.** Reuse the proven ATS build and deployment path, inspect image provenance, back up state, perform smoke tests, and retain a rollback image/version.
6. **Review inherited automation after every upstream update.** Check changes to `.github/workflows/`, permissions, triggers, secrets, publish steps, and any new bot accounts before accepting them.

## Automatic trigger policy

- **No scheduled GitHub Actions in this fork.** Use the ATS operations scheduler only for explicitly authorised recurring ATS work.
- **Allow PR validation.** Keep `PR` and narrowly scoped test/security checks while refining required-check coverage.
- **Keep manual diagnostics available.** Preserve `workflow_dispatch` and `workflow_call` where useful and avoid executing paid provider tests without explicit approval.
- **Keep Docker/agent-runtime image publication triggers temporarily.** Confirm whether the running ATS deployment depends on images from this fork before switching those to manual-only builds.
- **Do not enable broad GitHub Actions PR-creation/approval permissions** to work around inherited upstream bot failures.
- **Keep branch protection, GitHub Dependabot/security alerts, and repository history.** They are separate from upstream scheduled Actions and should be maintained intentionally.

## Changes in the initial simplification

- Retire `refresh-lockfile.yml`: its inherited daily/push bot tries to create and potentially auto-merge a PR and is not part of ATS's controlled update process.
- Remove the upstream schedules from `ci-test-durations.yml`, `release.yml`, `runner-chaos-evals.yml`, `runner-full-stack-e2e.yml`, `runner-live-evals.yml` and `runner-protocol-live-evals.yml`.
- Remove automatic `master` push release triggering from `release.yml`; retain manual release tooling for deliberate evaluation.
- Remove upstream-only `master` push triggers from `cloud-readiness.yml` and `cloud-migrator-artifacts.yml`; retain manual diagnosis.
- No change to `docker.yml`, `agent-runtime-images.yml`, `pr.yml`, `pr-trusted.yml`, branch protection or ATS production deployment.

## Follow-on review (separate change)

1. Trace the currently deployed ATS image digest and exact GHCR source before altering automatic Docker/image builds.
2. Verify which GitHub Actions check names are required by branch/rulesets before retiring any CI check.
3. Replace the failing `commitperclip PR Review` bot step with an ATS-suitable minimal dependency/security review, if useful; do not remove dependency review without an equivalent gate.
4. Retire no-op or skipped upstream-only PR profiling/visual workflows only after confirming no review/check dependencies.
5. Check GitHub Actions billing, storage and notifications after the first deliberately controlled PR and deployment.

**Approval boundary:** This document and workflow changes may be reviewed in a draft PR; they take effect only after merging to `master`. 
