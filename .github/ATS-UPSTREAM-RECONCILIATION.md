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

## ACPX package reconciliation — VALIDATED (21 November 2026)

The ACPX patch blocker described at 18:00 UTC was resolved **at package source level**, not by blindly splicing generated patch hunks.

- Verified the upstream stable patch and ATS original PR #11 patch independently apply to the exact `acpx@0.13.1` npm distribution. Source-level three-way merge produced exactly six semantic conflict sections in three files.
- Reconciled six known sections with fail-closed assertions: process detachment/ownership, process-group callback, admission-error descendant shutdown, latest upstream replay comment, and two TypeScript callback declarations. All other upstream and ATS source-level changes were retained by Git's merge.
- Regenerated the complete `patches/acpx@0.13.1.patch` from the npm base to the combined sources, **74,383 bytes**, SHA-256 `a861fc566594fdfa90311efde61737e3c37ea3403cb5e52234c25bcf9a99d107`.
- [Package-level verification run #44933952801](https://github.com/architechsure-ltd/paperclip/actions/runs/44933952801) PASS: reapply patch to clean npm package, Node syntax checks, byte-for-byte package file reproduction and 4/4 isolated ownership / process shutdown tests.
- Candidate patch committed as `2b8c6400cfcec1e740663f01bbde231af7d35abd`. Updated **only four ACPX patch-hash references** in `pnpm-lock.yaml` (from `25xv27loodfejozcsygclyiyau` to `znmbdzl4jxbijsedt3w4udsaem`), without adopting unrelated registry metadata changes.
- [Initial Paperclip install and regression #44934242170](https://github.com/architechsure-ltd/paperclip/actions/runs/44934242170) PASS: 7/7 exact original ATS owned-process lifecycle tests, 33/33 ACPX adapter-utils regression tests.
- [Final **frozen-lockfile** installation and regression #44934552271](https://github.com/architechsure-ltd/paperclip/actions/runs/44934552271) PASS: `pnpm install --frozen-lockfile` without regenerating the lockfile, then 7/7 ATS process lifecycle tests and 33/33 ACPX adapter tests; clean job conclusion SUCCESS.

**Scope of acceptance:** The combined ACPX dependency patch is validated on the upstream stable branch with the ATS lifecycle tests. The full paperclip ATS merge, including PR #9 handover and PR #12 MCP policy integration and full application build, is **not** yet completed, so this is not production approval. The full-source merge's ACPX patch-file conflict must now resolve by selecting the validated integration-branch patch; do not revert to either original side.

**Next bounded slice:** Complete the remaining server conflict reconciliation (imports and the durable Stop / ATS agent-key self-handover predicate), keep upstream recovery semantics, reconcile documentation and report-lock evidence, run integrated CI and prepare a draft-only PR. There is no laptop or deployment requirement at this stage.

## Server-source reconciliation — PASS; integrated CI pending (21 November 2026)

- Updated the fail-closed merge procedure on this branch in commits `f08da61` and `e18d3c3`: known server conflicts are reconciled using upstream's durable native stop flow and ATS's exact agent-key/legacy handover predicate; the combined ACPX package and its frozen lockfile are restored as **one already validated dependency pair**.
- Provenance is explicitly pinned: ACPX patch SHA-256 `a861fc566594fdfa90311efde61737e3c37ea3403cb5e52234c25bcf9a99d107`; lockfile blob `884de5a436743eafe49c6b0edc06e026ca16bbc2`. The upstream stable lockfile and this validated lockfile differ only in four ACPX patch hash references.
- [GitHub read-only source merge run #44958123181](https://github.com/architechsure-ltd/paperclip/actions/runs/44958123181) **PASS**: exactly nine expected textual conflicts resolved, four server sources handled, no remaining merge markers, Git staged diff check PASS, ACPX patch structural check PASS.
- The first rehearsal [#44958040761](https://github.com/architechsure-ltd/paperclip/actions/runs/44958040761) intentionally failed closed on an overly strict lockfile hash-count assumption; the validated whole-file lock is now used instead. Earlier ACPX runtime verification remains PASS.
- Added a read-only integrated CI rehearsal in `2518f93` to install frozen dependencies, run handover/agent-wake/recovery/ACPX tests, then typecheck and build. [Run #44958208216](https://github.com/architechsure-ltd/paperclip/actions/runs/44958208216) is the evidence source; its result must be checked before marking application acceptance.
- **Not yet approved:** semantics of report-lock evidence, all-app test status, persistent merge commit/draft PR, database migration review, real ATS infrastructure handover and deployment. No change to master or production.

## Integrated CI regression checkpoint — 21 November 2026, 22:50 UTC

- [Integrated application run #44958208216](https://github.com/architechsure-ltd/paperclip/actions/runs/44958208216): frozen install and source reconciliation **PASS**; 117 of 120 focused tests passed, 3 failures in `heartbeat-runtime-mcp-servers.test.ts`; typecheck and build were skipped by the failing test gate.
- Exact error in all three: `401 gateway_token_run_invalid` from `listRuntimeToolPoliciesForNamedGateway`. The original tests minted gateway tokens referencing random, **unpersisted** `runId`s. Upstream correctly requires a real active `heartbeat_runs` record for a run-scoped token.
- [Fixture correction `acfdb0f`](https://github.com/architechsure-ltd/paperclip/commit/acfdb0f2a9217eea0887694a543ab4c744bba278) seeds actual active runs for the three affected test paths. No gateway authentication or authorisation rules were loosened.
- [Rerun #44959062854](https://github.com/architechsure-ltd/paperclip/actions/runs/44959062854) launched with the corrected fixtures (workflow trigger update `b7759c4`). Verify its actual outcome before preparing the persistent merge commit and draft PR.
- Test evidence from the first integrated run: both `agent_jwt` and `agent_key` complete Hermes→Lead→revision→approval→parent unblocking paths passed; execution-stage wake tests passed.
- `tests/runner-e2e/report-lock.patch` remains a historical upstream trusted lockfile-refresh artefact, not proof of the new ACPX lockfile. Its report SHA matches the historical patch itself, but the output SHA does **not** match the current integrated lockfile. Reconciliation of that historical evidence is still an explicit PR review item; do not mislabel it as current frozen-lock evidence.

No change to ATS master, no merge approval, no production change, and no paid provider calls.

## MCP regression reconciliation and migration boundary — 21 November 2026

- The original full merged regression [#44958208216](https://github.com/architechsure-ltd/paperclip/actions/runs/44958208216) revealed three tests using nonexistent run UUIDs. Updated `heartbeat-runtime-mcp-servers.test.ts` to seed real active heartbeat rows; this preserves upstream fail-closed gateway token validation. Rerun [#44959062854](https://github.com/architechsure-ltd/paperclip/actions/runs/44959062854) improved to **119/120 PASS**.
- The remaining failure was **not**, on closer inspection, proof of empty database snapshot entries. In the ephemeral three-way merge ATS master contributed two outdated assertions on `servers[0].tools`, which upstream's run-scoped MCP gateway response no longer exposes. The focused diagnostic [#44959937615](https://github.com/architechsure-ltd/paperclip/actions/runs/44959937615) failed at that legacy assertion, before inspecting the actual profile.
- The merge reconciliation script removes only those two obsolete inline tool-list assertions, retaining the stronger existing assertions for exactly **251 persisted catalog-entry selectors**, required exclusions, and no newly discovered tools becoming accessible. The narrow regression in [#44960178712](https://github.com/architechsure-ltd/paperclip/actions/runs/44960178712) **PASS**. Overall focused tests and build still require the final run result.
- Additional defensive implementation in `run-preparation.ts`: on failed profile creation, an existing partial immutable profile cannot be mistaken for an accepted concurrent creator unless its persisted selectors exactly match the requested snapshot. Treat this as a proposed fork hardening change subject to typecheck and review; current upstream main also has a more extensive atomic profile-creation implementation, but it is outside the pinned stable release.
- **Database migration delta:** ATS master goes through `0431`; upstream stable `v2026.1117.0` adds exactly 20 migrations `0432`–`0451` (no ATS-only migration filenames in that comparison). Migration `0443_native_warm_follow_up_default.sql` updates agent lifecycle config defaults for native runners; verify its effect on ATS Codex/Hermes configuration on staging before approving production, and retain a database backup. No migrations have been executed in ATS infrastructure.
