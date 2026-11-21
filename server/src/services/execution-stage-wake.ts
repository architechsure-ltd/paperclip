import { legacyExecutionNeedsReconciliationWithEvidence } from "./legacy-execution-recovery.js";
import { issueRecoveryActionService } from "./issue-recovery-actions.js";
import { hasPendingRunCleanup } from "./execution-blocker.js";
import { hasStoppedLocalProcessTree } from "./heartbeat/process-settlement.js";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { agentWakeupRequests, companies, environmentLeases, heartbeatRuns, issueRecoveryActions, issues, type Db } from "@paperclipai/db";
import type { WakeupOptions } from "./heartbeat/run-preparation.js";
import { executionStageWakeIsCurrent, parseIssueExecutionState } from "./issue-execution-policy.js";
import { notifyDeferredExecutionWork, type DeferredReceiptRecoveryOptions } from "./deferred-execution-notifications.js";
import { hasRemoteTerminationReceipt } from "./remote-execution-termination.js";
import { hasRequiredWorkspaceRecovery } from "./workspace-restore-recovery-state.js";

type Issue = typeof issues.$inferSelect;
type Wake = typeof agentWakeupRequests.$inferSelect;
const receiptSchema = "paperclip.execution-stage-wake.v1";

function receipt(wake: Wake) {
  const value = wake.payload?.executionStageDelivery as Record<string, unknown> | undefined;
  return value?.schema === receiptSchema ? value : null;
}

/** Called under the issue update lock; the retained wake and transition commit together. */
export async function saveExecutionStageWake(db: Db, issue: Issue,
  input: { agentId: string; wakeup: WakeupOptions }, sourceRunId: string | null) {
  const state = parseIssueExecutionState(issue.executionState);
  if (!state) return;
  const idempotencyKey = `execution-stage:${issue.id}:${state.currentStageId}:${state.lastDecisionId}:${state.status}:${input.agentId}`;
  const [existing] = await db.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.companyId, issue.companyId), eq(agentWakeupRequests.idempotencyKey, idempotencyKey),
  )).limit(1);
  if (existing) return;
  await notifyDeferredExecutionWork(db, { companyId: issue.companyId });
  await db.insert(agentWakeupRequests).values({
    companyId: issue.companyId, agentId: input.agentId, source: "assignment", triggerDetail: "system",
    reason: input.wakeup.reason, requestedByActorType: input.wakeup.requestedByActorType,
    requestedByActorId: input.wakeup.requestedByActorId, idempotencyKey,
    status: "deferred_issue_execution", payload: {
      ...input.wakeup.payload, _paperclipWakeContext: input.wakeup.contextSnapshot,
      executionStageDelivery: { schema: receiptSchema, stageId: state.currentStageId,
        lastDecisionId: state.lastDecisionId, stateStatus: state.status, sourceRunId },
    },
  });
}

/** A terminal run is not a release receipt. Never admit before cleanup settles. */
export async function executionStageWakeReadiness(db: Db, issue: Issue, wake: Wake): Promise<"stale" | "waiting" | "uncertain" | "ready"> {
  if (!executionStageWakeIsCurrent(issue, wake)) return "stale";
  const sourceRunId = receipt(wake)?.sourceRunId;
  if (typeof sourceRunId === "string") {
    const [source] = await db.select().from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, issue.companyId), eq(heartbeatRuns.id, sourceRunId),
    ));
    if (!source || (source.issueId ?? source.nativeIssueId ?? source.contextSnapshot?.issueId) !== issue.id ||
        !source.finishedAt || !["succeeded", "cancelled", "failed", "interrupted", "timed_out"].includes(source.status) ||
        hasRequiredWorkspaceRecovery(source.resultJson) || await hasPendingRunCleanup(db, issue.companyId, source.id)) return "waiting";
    if (source.runtimeMode === "legacy" && await legacyExecutionNeedsReconciliationWithEvidence(db, source)) {
      const [reconciled] = await db.select({ id: issueRecoveryActions.id }).from(issueRecoveryActions).where(and(
        eq(issueRecoveryActions.companyId, issue.companyId), eq(issueRecoveryActions.sourceIssueId, issue.id),
        eq(issueRecoveryActions.fingerprint, `legacy-execution:${source.id}`), eq(issueRecoveryActions.status, "resolved"),
        sql`${issueRecoveryActions.evidence}->'executionReconciliation'->>'runId' = ${source.id}`,
        sql`${issueRecoveryActions.evidence}->'reviewHandoverOnly' = 'true'::jsonb`,
      )).limit(1);
      if (!reconciled) return "uncertain";
    }
    const sourceLeases = await db.select().from(environmentLeases).where(and(
      eq(environmentLeases.companyId, issue.companyId), eq(environmentLeases.heartbeatRunId, source.id),
    ));
    if (source.processPid && !sourceLeases.some(lease => lease.provider && lease.provider !== "local") &&
        !hasStoppedLocalProcessTree(source)) return "waiting";
  }
  const [live] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, issue.companyId),
    sql`coalesce(${heartbeatRuns.issueId}::text, ${heartbeatRuns.nativeIssueId}::text, ${heartbeatRuns.contextSnapshot}->>'issueId') = ${issue.id}`,
    inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"]),
  )).limit(1);
  if (live) return "waiting";
  const leases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, issue.companyId), eq(environmentLeases.issueId, issue.id),
  ));
  if (leases.some(lease => !lease.releasedAt || !["released", "expired", "failed"].includes(lease.status) ||
      (lease.cleanupStatus !== null && lease.cleanupStatus !== "success") ||
      (lease.provider && lease.provider !== "local" && !hasRemoteTerminationReceipt(lease)))) return "waiting";
  return "ready";
}

/** Reuses the existing deferred-receipt worker and its commit/cleanup/restart signals. */
export async function resumeExecutionStageWakes(db: Db,
  enqueue: (agentId: string, options: WakeupOptions, requestId?: string) => Promise<unknown>,
  scope: DeferredReceiptRecoveryOptions = {}) {
  const pending = await db.select({ wake: agentWakeupRequests, issue: issues }).from(agentWakeupRequests)
    .innerJoin(issues, and(eq(issues.companyId, agentWakeupRequests.companyId),
      sql`${issues.id}::text = ${agentWakeupRequests.payload}->>'issueId'`))
    .innerJoin(companies, and(eq(companies.id, issues.companyId), eq(companies.status, "active")))
    .where(and(eq(agentWakeupRequests.status, "deferred_issue_execution"), isNull(agentWakeupRequests.runId),
      sql`${agentWakeupRequests.payload}->'executionStageDelivery'->>'schema' = ${receiptSchema}`,
      scope.companyId ? eq(agentWakeupRequests.companyId, scope.companyId) : undefined,
      scope.requestId ? eq(agentWakeupRequests.id, scope.requestId) : undefined))
    .orderBy(asc(agentWakeupRequests.updatedAt)).limit(50);
  for (const { wake, issue } of pending) {
    try {
      const readiness = await executionStageWakeReadiness(db, issue, wake);
      if (readiness === "waiting") continue;
      if (readiness === "uncertain") {
        await db.transaction(async tx => {
          const [current] = await tx.select().from(issues).where(and(eq(issues.companyId, issue.companyId), eq(issues.id, issue.id))).for("update");
          if (!current || await executionStageWakeReadiness(tx as unknown as Db, current, wake) !== "uncertain") return;
          const runId = String(receipt(wake)?.sourceRunId);
          const [existing] = await tx.select({ id: issueRecoveryActions.id }).from(issueRecoveryActions).where(and(
            eq(issueRecoveryActions.companyId, issue.companyId), eq(issueRecoveryActions.sourceIssueId, issue.id),
            eq(issueRecoveryActions.fingerprint, `legacy-execution:${runId}`),
          )).limit(1);
          if (existing) return;
          await issueRecoveryActionService(tx as unknown as Db).upsertSourceScoped({
            companyId: issue.companyId, sourceIssueId: issue.id, kind: "active_run_watchdog", ownerType: "board",
            returnOwnerAgentId: issue.assigneeAgentId, cause: "legacy_execution_requires_reconciliation",
            fingerprint: `legacy-execution:${runId}`, evidence: { runId, reviewStageWakeRequestId: wake.id },
            nextAction: "The source execution failed after review submission. Verify provider termination and external action outcomes before continuing the saved review.",
            maxAttempts: 3, wakePolicy: null,
          });
        });
        continue;
      }

      if (readiness === "stale") {
        await db.transaction(async tx => {
          const [current] = await tx.select().from(issues).where(and(eq(issues.companyId, issue.companyId), eq(issues.id, issue.id))).for("update");
          if (current && executionStageWakeIsCurrent(current, wake)) return;
          await tx.update(agentWakeupRequests).set({ status: "skipped", error: "Execution stage changed", finishedAt: new Date() })
            .where(and(eq(agentWakeupRequests.id, wake.id), eq(agentWakeupRequests.status, "deferred_issue_execution")));
        });
        continue;
      }
      await enqueue(wake.agentId, {
        executionStageRequestId: wake.id, source: "assignment", triggerDetail: "system", reason: wake.reason,
        payload: wake.payload, contextSnapshot: wake.payload?._paperclipWakeContext as Record<string, unknown>,
        idempotencyKey: wake.idempotencyKey, requestedByActorType: wake.requestedByActorType as "user" | "agent" | "system",
        requestedByActorId: wake.requestedByActorId, allowRunCoalescing: false,
      }, wake.id);
    } catch (error) { if (scope.onError) scope.onError(error); else throw error; }
  }
}

export { executionStageWakeIsCurrent } from "./issue-execution-policy.js";
