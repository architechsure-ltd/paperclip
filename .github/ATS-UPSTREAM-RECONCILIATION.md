# ATS / Paperclip v2026.1117.0 — integration reconciliation

**Status:** investigation and integration only; NOT authorised for production deployment or merge into ATS master.

| Reference | Pinned object |
|---|---|
| Last common upstream ancestor | `3a283fbc9b8df4d80dd4194ddc7efc2fa2042817` (4 Nov 2026) |
| ATS master to preserve | `96a712e1968be89701ec7fc9f5ae452dce081914` (includes PR #14) |
| Upstream stable candidate | `c0f132898d2a2677312d8c72096187b27a3d9a38` (`v2026.1117.0`) |

## Purpose

Preserve ATS behaviour while evaluating verified upstream recovery fixes. The original ATS work includes PR #7/#8 (CI), #9 (bounded legacy review handover), #11 (ACPX process groups), #12 (Codex managed MCP policies), #13 (lockfile evidence) and #14 (GitHub Actions simplification). PR #13 lockfile files must be regenerated against the chosen upstream source rather than blindly copied.

## File-level reconnaissance

Compared Git blob identity at three fixed refs. **65 ATS-differing files; 33 non-overlapping file edits and 32 files changed independently in upstream.** This is NOT a count of actual merge conflicts. A non-overlapping file still requires semantic review; a concurrently edited file may merge cleanly at hunk level.

| ATS path | ATS action | Upstream relation |
|---|---|---|
| `.github/ATS-GITHUB-ACTIONS-POLICY.md` | Added | Non-overlap |
| `.github/scripts/tests/ci-plan.test.mjs` | Modified | Both changed |
| `.github/scripts/tests/cloud-readiness.test.mjs` | Modified | Non-overlap |
| `.github/scripts/tests/lockfile-refresh-cache.test.mjs` | Removed | Non-overlap |
| `.github/scripts/tests/lockfile-refresh-merge.test.mjs` | Removed | Both changed |
| `.github/scripts/tests/lockfile-refresh-workflows.test.mjs` | Modified | Non-overlap |
| `.github/workflows/acpx-ci-baseline.yml` | Added | Non-overlap |
| `.github/workflows/acpx-owned-process-lifecycle.yml` | Added | Non-overlap |
| `.github/workflows/arc106-verification.yml` | Added | Non-overlap |
| `.github/workflows/ci-routing.yml` | Modified | Non-overlap |
| `.github/workflows/ci-test-durations.yml` | Modified | Both changed |
| `.github/workflows/cloud-migrator-artifacts.yml` | Modified | Non-overlap |
| `.github/workflows/cloud-readiness.yml` | Modified | Non-overlap |
| `.github/workflows/pr-trusted.yml` | Modified | Both changed |
| `.github/workflows/pr.yml` | Modified | Non-overlap |
| `.github/workflows/refresh-lockfile.yml` | Removed | Both changed |
| `.github/workflows/release.yml` | Modified | Non-overlap |
| `.github/workflows/runner-chaos-evals.yml` | Modified | Non-overlap |
| `.github/workflows/runner-full-stack-e2e.yml` | Modified | Both changed |
| `.github/workflows/runner-live-evals.yml` | Modified | Non-overlap |
| `.github/workflows/runner-protocol-live-evals.yml` | Modified | Both changed |
| `doc/acpx-owned-process-groups.md` | Added | Non-overlap |
| `doc/DEVELOPING.md` | Modified | Both changed |
| `doc/execution-semantics.md` | Modified | Both changed |
| `packages/adapter-utils/src/acpx-engine/execute.ts` | Modified | Both changed |
| `packages/adapter-utils/src/acpx-engine/run-site-host.ts` | Modified | Non-overlap |
| `packages/adapter-utils/src/index.ts` | Modified | Both changed |
| `packages/adapter-utils/src/types.ts` | Modified | Both changed |
| `packages/adapters/codex-local/src/server/codex-home.test.ts` | Modified | Non-overlap |
| `packages/adapters/codex-local/src/server/codex-home.ts` | Modified | Non-overlap |
| `packages/adapters/codex-local/src/server/execute.test.ts` | Modified | Non-overlap |
| `packages/adapters/codex-local/src/server/execute.ts` | Modified | Non-overlap |
| `patches/acpx@0.13.1.patch` | Modified | Both changed |
| `pnpm-lock.yaml` | Modified | Both changed |
| `scripts/__tests__/e2e-shard.test.mjs` | Modified | Both changed |
| `server/src/__tests__/acpx-owned-process-lifecycle.test.mjs` | Added | Non-overlap |
| `server/src/__tests__/codex-local-execute.test.ts` | Modified | Non-overlap |
| `server/src/__tests__/deferred-execution-receipt-work.test.ts` | Modified | Both changed |
| `server/src/__tests__/execution-stage-wake.test.ts` | Added | Non-overlap |
| `server/src/__tests__/heartbeat-runtime-mcp-servers.test.ts` | Modified | Non-overlap |
| `server/src/__tests__/issue-comment-reopen-routes.test.ts` | Modified | Non-overlap |
| `server/src/__tests__/issue-execution-policy-routes.test.ts` | Modified | Non-overlap |
| `server/src/__tests__/legacy-review-handover.integration.test.ts` | Added | Non-overlap |
| `server/src/__tests__/tool-gateway-listing-memory.test.ts` | Modified | Non-overlap |
| `server/src/adapters/index.ts` | Modified | Non-overlap |
| `server/src/modules/run-dispatch/adapters/postgres.ts` | Modified | Both changed |
| `server/src/modules/run-dispatch/domain/policy.test.ts` | Modified | Both changed |
| `server/src/modules/run-dispatch/domain/policy.ts` | Modified | Both changed |
| `server/src/modules/wake-queue/adapters/postgres.ts` | Modified | Both changed |
| `server/src/routes/issues.ts` | Modified | Both changed |
| `server/src/services/execution-recovery-resolution.ts` | Modified | Both changed |
| `server/src/services/execution-stage-wake.ts` | Added | Non-overlap |
| `server/src/services/heartbeat.ts` | Modified | Both changed |
| `server/src/services/heartbeat/deferred-receipt-work.ts` | Modified | Both changed |
| `server/src/services/heartbeat/queue.ts` | Modified | Both changed |
| `server/src/services/heartbeat/run-control.ts` | Modified | Both changed |
| `server/src/services/heartbeat/run-preparation.test.ts` | Modified | Non-overlap |
| `server/src/services/heartbeat/run-preparation.ts` | Modified | Both changed |
| `server/src/services/heartbeat/runtime-execution.ts` | Modified | Both changed |
| `server/src/services/issue-execution-policy.ts` | Modified | Non-overlap |
| `server/src/services/legacy-execution-recovery.ts` | Modified | Both changed |
| `server/src/services/legacy-review-handover.ts` | Added | Non-overlap |
| `server/src/services/tool-gateway.ts` | Modified | Both changed |
| `tests/runner-e2e/report-lock.json` | Modified | Both changed |
| `tests/runner-e2e/report-lock.patch` | Modified | Both changed |

## Reconciliation gates (do not waive)

1. **Git merge assessment:** run the isolated `ATS Upstream Merge Assessment` workflow; fetch exact upstream and ATS revisions; capture exact textual conflicts without changing the repository. Keep the source pinned.
2. **PR #14 operational policy:** no inherited scheduled upstream jobs, no lockfile auto-merge bot, no release-on-push. Preserve ordinary PR validation. Do not loosen Actions PR creation permissions.
3. **PR #9 review handover:** verify release of old execution lease before reviewer wake; no lost or duplicate wakes; preserve agent-key authorisation; prove the parent receives completed children.
4. **PR #11 ACPX:** maintain owned process groups, descendant stop/drain and bounded shutdown. Check upstream equivalent before retaining custom patch; current upstream dependency versions may differ.
5. **PR #12 Codex MCP:** preserve per-tool effective permission snapshot, deny by default, non-interactive authorised invocations; require live agent check later.
6. **Build / CI:** run targeted tests, dependency resolution, typecheck and Docker build on a pinned candidate. Treat existing upstream/fork CI failures as separate evidence, not waived regressions.
7. **Database / storage:** compare migrations (especially skill-package storage/rollback floor) and produce an explicit backup/restore/rollback plan. No live migration before staging acceptance.
8. **Runtime acceptance on ATS infrastructure:** Coordinator → TL → Engineer → review; retry and restart; completed child wake; Hermes 429/529; checkpoint/deadline enforcement. Production remains unchanged until separately approved.

## Known upstream caveats

- [#18679](https://github.com/paperclipai/paperclip/issues/18679) and [#18315](https://github.com/paperclipai/paperclip/issues/18315): reviewer handover events can be lost around environment lease cleanup.
- [#19588](https://github.com/paperclipai/paperclip/issues/19588): parent child-completion wake may coalesce into a run that already built its prompt.
- [#17526](https://github.com/paperclipai/paperclip/issues/17526): Hermes gateway provider 429/529 may not be classified as retryable.

## Approval boundaries

No automatic merge to ATS master, production update, credential exposure, paid provider calls, schema migration, or broad repository permissions change. Record actual CI and runtime evidence before upgrading. This candidate may be revised or discarded independently of production.

## Checkpoint — 21 November 2026, 18:00 UTC

**GitHub integration progress: preparation completed; source merge deliberately not committed.**

- The isolated branch now carries the ATS no-scheduled-Actions policy, manual-only upstream release/test triggers, cloud push-trigger removal and retirement of the inherited lockfile bot, with corresponding policy test adjustments.
- The GitHub-hosted three-way merge assessment initially found 11 conflicts. Reassessment after applying the ATS operations policy found exactly 9 remaining conflicted paths:
  - `doc/DEVELOPING.md`
  - `patches/acpx@0.13.1.patch`
  - `pnpm-lock.yaml`
  - `server/src/routes/issues.ts`
  - `server/src/services/heartbeat.ts`
  - `server/src/services/heartbeat/queue.ts`
  - `server/src/services/legacy-execution-recovery.ts`
  - `tests/runner-e2e/report-lock.json`
  - `tests/runner-e2e/report-lock.patch`
- [Read-only merge assessment PASS](https://github.com/architechsure-ltd/paperclip/actions/runs/44932718212): verified no scheduled workflows/bot remain, and enumerated exact conflict paths.
- [Read-only candidate reconciliation](https://github.com/architechsure-ltd/paperclip/actions/runs/44933073416) **FAIL (intentional fail-closed)**: the ACPX 0.13.1 patch has many overlapping patch-format hunks; the early hard case was resolved only provisionally and the checker stopped on unexpected conflict #48. It did not commit or push. Blindly choosing one side risks losing upstream ACPX behaviour or ATS process-group shutdown guarantees.
- The core server conflicts are three import-only locations plus one reassignment flow in `issues.ts`. There, ATS `isLegacySelfHandoff` can preserve the agent-key policy exemption while upstream's durable native stop handling must remain intact. This is a **proposed textual resolution, not yet validated**.
- `pnpm-lock.yaml` and the report lock evidence are to be regenerated and checked, not copied from the old fork.

**Next bounded engineering slice:** reconstruct a valid combined ACPX package patch against `acpx@0.13.1`, retaining upstream additions and ATS owned process groups. Prove patch applies and passes ACPX lifecycle tests. Only then complete the source merge in an isolated branch, run CI, and prepare a draft PR. No laptop, staging or production operation has occurred.

The fork's `master` must remain at `96a712e1968be89701ec7fc9f5ae452dce081914` until a separate approved merge.
