import { and, eq, sql } from "drizzle-orm";
import { activityLog, environmentLeases, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { parseIssueExecutionState } from "./issue-execution-policy.js";
import { hasRequiredWorkspaceRecovery } from "./workspace-restore-recovery-state.js";
import { hasRemoteTerminationReceipt } from "./remote-execution-termination.js";

type Run = typeof heartbeatRuns.$inferSelect;
type Issue = typeof issues.$inferSelect;

/** Reassignment alone is never proof. The committed policy transition must identify this stopped source. */
export async function hasAcceptedLegacyReviewHandover(db: Db, run: Run, task: Issue): Promise<boolean> {
  const review = parseIssueExecutionState(task.executionState);
  const cancellation = run.resultJson?.executionCancellation as Record<string, unknown> | undefined;
  if (run.runtimeMode !== "legacy" || run.status !== "cancelled" || run.errorCode !== "issue_reassigned" ||
      !run.finishedAt || task.companyId !== run.companyId || task.status !== "in_review" ||
      !task.executionPolicy || review?.status !== "pending" ||
      (run.issueId ?? run.nativeIssueId ?? run.contextSnapshot?.issueId) !== task.id ||
      run.resultJson?.reassignmentStopConfirmed !== true || cancellation?.state !== "acknowledged" ||
      cancellation.forced === true || hasRequiredWorkspaceRecovery(run.resultJson) ||
      run.resultJson?.workspaceRestoreFailure ||
      (run.controllerLeaseExpiresAt && run.controllerLeaseExpiresAt > new Date())) return false;
  const [transition] = await db.select({ id: activityLog.id }).from(activityLog).where(and(
    eq(activityLog.companyId, run.companyId), eq(activityLog.entityType, "issue"), eq(activityLog.entityId, task.id),
    eq(activityLog.action, "issue.updated"),
    sql`${activityLog.details}->>'interruptedRunId' = ${run.id}`,
    sql`${activityLog.details}->'executionState'->>'status' = 'pending'`,
    sql`${activityLog.details}->'executionState'->>'currentStageId' = ${review.currentStageId}`,
    sql`${activityLog.details}->'executionState'->>'lastDecisionId' is not distinct from ${review.lastDecisionId}`,
    sql`${activityLog.details}->'executionState'->>'currentStageType' = ${review.currentStageType}`,
    sql`${activityLog.details}->'executionState'->'currentParticipant' = ${JSON.stringify(review.currentParticipant)}::jsonb`,
  )).limit(1);
  if (!transition) return false;
  const leases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.companyId, run.companyId), eq(environmentLeases.heartbeatRunId, run.id),
  ));
  if (leases.some(lease => !lease.releasedAt || !["released", "expired", "failed"].includes(lease.status) ||
      (lease.cleanupStatus !== null && lease.cleanupStatus !== "success") || lease.metadata?.pendingCleanupInFlight === true ||
      (lease.provider && lease.provider !== "local" && !hasRemoteTerminationReceipt(lease)))) return false;
  // A stop receipt cannot make a surviving host process safe to overlap.
  for (const pid of [run.processPid, run.processGroupId ? -run.processGroupId : null]) {
    if (!pid) continue;
    try { process.kill(pid, 0); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
  }
  return true;
}

export async function isSettledLegacyReviewHandover(db: Db, run: Run): Promise<boolean> {
  const recovery = run.resultJson?.executionRecovery as Record<string, unknown> | undefined;
  // A review handover is successor work, never permission to replay a stopped provider turn.
  if (recovery?.providerStopped !== true || recovery.actionOutcomes !== "settled" || run.resultJson?.acpToolInventoryComplete === false ||
      (run.resultJson?.acpPendingToolCount !== undefined && run.resultJson.acpPendingToolCount !== 0)) return false;
  const issueId = run.issueId ?? run.nativeIssueId ?? run.contextSnapshot?.issueId;
  if (typeof issueId !== "string") return false;
  const [task] = await db.select().from(issues).where(and(eq(issues.companyId, run.companyId), eq(issues.id, issueId)));
  return Boolean(task && await hasAcceptedLegacyReviewHandover(db, run, task));
}
