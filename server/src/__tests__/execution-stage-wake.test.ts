import { createPostgresRunDispatchAdapter } from "../modules/run-dispatch/adapters/postgres.js";
import { remoteTerminationReceipt } from "../services/remote-execution-termination.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agentWakeupRequests, agents, companies, createDb, environmentLeases, environments,
  executionWorkspaces, heartbeatRuns, issueRecoveryActions, issues, projects } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { executionStageWakeReadiness, resumeExecutionStageWakes, saveExecutionStageWake } from "../services/execution-stage-wake.js";
import { normalizeIssueExecutionPolicy, applyIssueExecutionPolicyTransition } from "../services/issue-execution-policy.js";
import { heartbeatService } from "../services/heartbeat.js";
import { legacyExecutionNeedsReconciliationWithEvidence } from "../services/legacy-execution-recovery.js";
import { validateExecutionReconciliation } from "../services/execution-recovery-resolution.js";

describe("durable policy stage wake", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { temporary = await startEmbeddedPostgresTestDatabase("policy-stage-wake-"); db = createDb(temporary.connectionString); }, 90_000);
  afterAll(async () => { await db?.$client.end(); await temporary?.cleanup(); });
  async function seed() {
    const companyId = randomUUID(), engineer = randomUUID(), reviewer = randomUUID(), issueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Stage handover", issuePrefix: `W${companyId.replaceAll("-", "")}`, defaultResponsibleUserId: "board" });
    await db.insert(agents).values([{ id: engineer, companyId, name: "Hermes Engineer", adapterType: "hermes", status: "idle" },
      { id: reviewer, companyId, name: "Codex Technical Lead", adapterType: "paperclip_runner", status: "idle", runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } }]);
    const policy = normalizeIssueExecutionPolicy({ stages: [{ id: "11111111-1111-4111-8111-111111111111", type: "review", participants: [{ type: "agent", agentId: reviewer }] },
      { id: "22222222-2222-4222-8222-222222222222", type: "approval", participants: [{ type: "user", userId: "board" }] }] });
    const [initial] = await db.insert(issues).values({ id: issueId, companyId, title: "Review delivery", status: "in_progress", assigneeAgentId: engineer, executionPolicy: policy as unknown as Record<string, unknown> }).returning();
    const transition = applyIssueExecutionPolicyTransition({ issue: initial, policy, requestedStatus: "done", requestedAssigneePatch: {}, actor: { agentId: engineer }, commentBody: "Implementation and evidence ready." });
    const [issue] = await db.update(issues).set(transition.patch).where(eq(issues.id, issueId)).returning();
    const [source] = await db.insert(heartbeatRuns).values({ companyId, agentId: engineer, issueId, status: "succeeded", runtimeMode: "legacy", startedAt: new Date(), finishedAt: new Date(), contextSnapshot: { issueId } }).returning();
    const [project] = await db.insert(projects).values({ companyId, name: "Fixture" }).returning();
    const [workspace] = await db.insert(executionWorkspaces).values({ companyId, projectId: project.id, sourceIssueId: issueId, mode: "isolated", strategyType: "git_worktree", name: "Fixture", cwd: "/tmp/fixture" }).returning();
    await db.insert(environments).values({ name: "Fixture local", driver: "local" }).onConflictDoNothing();
    const [environment] = await db.select().from(environments).where(eq(environments.driver, "local"));
    const [lease] = await db.insert(environmentLeases).values({ companyId, issueId, heartbeatRunId: source.id, executionWorkspaceId: workspace.id, environmentId: environment.id, status: "pending_cleanup", provider: "local", cleanupStatus: "pending" }).returning();
    const wakeup = { reason: "execution_review_requested", requestedByActorType: "agent" as const, requestedByActorId: engineer,
      payload: { issueId }, contextSnapshot: { issueId, executionStage: { wakeRole: "reviewer", stageId: "11111111-1111-4111-8111-111111111111", stageType: "review", currentParticipant: { type: "agent", agentId: reviewer }, allowedActions: ["approve", "request_changes"] } } };
    await db.transaction(async tx => {
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, issueId)).for("update");
      await saveExecutionStageWake(tx as unknown as typeof db, issue, { agentId: reviewer, wakeup }, source.id);
    });
    const wake = (await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId)))[0]!;
    return { companyId, engineer, reviewer, issue, source, lease, wake, wakeup };
  }
  const release = async (f: Awaited<ReturnType<typeof seed>>) => db.update(environmentLeases).set({ status: "released", releasedAt: new Date(), cleanupStatus: "success" }).where(eq(environmentLeases.id, f.lease.id));

  it("retains the lease-release race and admits exactly one saved wake after restart", async () => {
    const f = await seed();
    // Occupy the reviewer so this test proves admission without invoking a provider.
    await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.reviewer, status: "running" });
    await heartbeatService(db).resumeExecutionWaitComments({ companyId: f.companyId });
    expect(await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.companyId), eq(heartbeatRuns.status, "queued")))).toHaveLength(0);
    await release(f);
    expect(await executionStageWakeReadiness(db, f.issue, f.wake)).toBe("ready");
    await Promise.all([heartbeatService(db).resumeExecutionWaitComments({ companyId: f.companyId }), heartbeatService(db).resumeExecutionWaitComments({ companyId: f.companyId })]);
    const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, f.companyId), eq(heartbeatRuns.status, "queued")));
    expect(runs).toHaveLength(1);
    expect(runs[0].wakeupRequestId).toBe(f.wake.id);
    expect((await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.wake.id)))[0]).toMatchObject({ status: "queued", runId: runs[0].id });
    // A later review round can retain the same agent and stage ID. Dispatch must still reject the old decision.
    await db.update(issues).set({ executionState: { ...f.issue.executionState, lastDecisionId: randomUUID() } }).where(eq(issues.id, f.issue.id));
    await expect(createPostgresRunDispatchAdapter(db).cancelStaleQueuedRun({ companyId: f.companyId,
      runId: runs[0].id, expectedStatus: "queued", now: new Date() }))
      .resolves.toMatchObject({ outcome: "cancelled", errorCode: "issue_review_participant_changed" });
  }, 30_000);

  it("requires the exact provider termination receipt after remote lease release", async () => {
    const f = await seed(); await release(f);
    const providerLeaseId = randomUUID();
    const [lease] = await db.update(environmentLeases).set({ provider: "daytona", providerLeaseId }).where(eq(environmentLeases.id, f.lease.id)).returning();
    expect(await executionStageWakeReadiness(db, f.issue, f.wake)).toBe("waiting");
    const remoteExecutionTermination = remoteTerminationReceipt(lease, { providerLeaseId, state: "stopped" });
    await db.update(environmentLeases).set({ metadata: { remoteExecutionTermination } }).where(eq(environmentLeases.id, lease.id));
    expect(await executionStageWakeReadiness(db, f.issue, f.wake)).toBe("ready");
  });

  it("retains the reviewer wake and records a hold when the submitter fails with uncertain external effects", async () => {
    const f = await seed(); await release(f);
    await db.update(heartbeatRuns).set({ status: "failed", errorCode: "provider_failed",
      resultJson: { executionRecovery: { providerStopped: true, actionOutcomes: "unknown" } } }).where(eq(heartbeatRuns.id, f.source.id));
    expect(await executionStageWakeReadiness(db, f.issue, f.wake)).toBe("uncertain");
    let starts = 0;
    await resumeExecutionStageWakes(db, async () => { starts++; }, { companyId: f.companyId });
    await resumeExecutionStageWakes(db, async () => { starts++; }, { companyId: f.companyId });
    expect(starts).toBe(0);
    expect(await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.companyId, f.companyId))).toHaveLength(1);
    expect((await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.wake.id)))[0].status).toBe("deferred_issue_execution");
    expect(await (await import("../services/execution-blocker.js")).getExecutionBlocker(db, f.companyId, f.issue.id))
      .toMatchObject({ cause: "legacy_execution_requires_reconciliation", runId: f.source.id });
  });

  it("commits or rolls back the transition and wake together and deduplicates retries", async () => {
    const f = await seed();
    await db.transaction(async tx => { await tx.select().from(issues).where(eq(issues.id, f.issue.id)).for("update");
      await saveExecutionStageWake(tx as unknown as typeof db, f.issue, { agentId: f.reviewer, wakeup: f.wakeup }, f.source.id); });
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, f.companyId))).toHaveLength(1);
    await expect(db.transaction(async tx => { await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.wake.id));
      await saveExecutionStageWake(tx as unknown as typeof db, f.issue, { agentId: f.reviewer, wakeup: f.wakeup }, f.source.id); throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect((await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, f.companyId)))[0].id).toBe(f.wake.id);
  });

  it("retires stale participants instead of waking them", async () => {
    const f = await seed(); await release(f);
    await db.update(issues).set({ assigneeAgentId: f.engineer }).where(eq(issues.id, f.issue.id));
    const current = (await db.select().from(issues).where(eq(issues.id, f.issue.id)))[0];
    expect(await executionStageWakeReadiness(db, current, f.wake)).toBe("stale");
    let starts = 0;
    await resumeExecutionStageWakes(db, async () => { starts++; }, { companyId: f.companyId });
    expect(starts).toBe(0);
    expect((await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, f.wake.id)))[0].status).toBe("skipped");
  });

  it("classifies only settled, audited handovers and preserves uncertain actions and cleanup", async () => {
    const f = await seed();
    const [stopped] = await db.update(heartbeatRuns).set({ status: "cancelled", errorCode: "issue_reassigned", resultJson: { reassignmentStopConfirmed: true,
      executionCancellation: { state: "acknowledged" }, executionRecovery: { kind: "interrupted", providerStopped: true, actionOutcomes: "settled" } } }).where(eq(heartbeatRuns.id, f.source.id)).returning();
    await db.insert(activityLog).values({ companyId: f.companyId, actorType: "system", actorId: "test", action: "issue.updated", entityType: "issue", entityId: f.issue.id,
      details: { interruptedRunId: stopped.id, executionState: f.issue.executionState } });
    expect(await legacyExecutionNeedsReconciliationWithEvidence(db, stopped)).toBe(true);
    await release(f);
    expect(await legacyExecutionNeedsReconciliationWithEvidence(db, stopped)).toBe(false);
    expect(await legacyExecutionNeedsReconciliationWithEvidence(db, { ...stopped, resultJson: { ...stopped.resultJson,
      executionRecovery: { providerStopped: true, actionOutcomes: "unknown" } } })).toBe(true);
    expect(await legacyExecutionNeedsReconciliationWithEvidence(db, { ...stopped, resultJson: { ...stopped.resultJson,
      executionCancellation: { state: "requested" } } })).toBe(true);
    expect(await legacyExecutionNeedsReconciliationWithEvidence(db, { ...stopped, resultJson: { ...stopped.resultJson,
      acpPendingToolCount: 1 } })).toBe(true);
    expect(await legacyExecutionNeedsReconciliationWithEvidence(db, { ...stopped, resultJson: { ...stopped.resultJson,
      executionCancellation: { state: "acknowledged", forced: true } } })).toBe(true);
    await expect(validateExecutionReconciliation({ db, companyId: f.companyId, issueId: f.issue.id, agentId: f.reviewer,
      sourceRunId: stopped.id, decision: { runId: stopped.id, providerStopped: true, actionOutcome: "completed", outcomeEvidence: "Owner verified the submitted implementation and all external effects." }, reviewHandoverOnly: true })).resolves.toMatchObject({ id: stopped.id });
  });
});
