import { applyIssueExecutionPolicyTransition, normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";
import { createHash, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agentApiKeys, agentWakeupRequests, agents, authUsers, companies, companyMemberships, createDb, heartbeatRuns, issueRelations, issues, issueRecoveryActions } from "@paperclipai/db";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { issueRoutes } from "../routes/issues.js";
import { heartbeatService } from "../services/heartbeat.js";
import type { StorageService } from "../storage/types.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// Real child processes and authenticated HTTP mutations; model output is deterministic.
const providerScript = String.raw`
const headers = { authorization: 'Bearer ' + (process.env.REVIEW_TEST_KEY || process.env.PAPERCLIP_API_KEY), 'content-type': 'application/json', 'x-paperclip-run-id': process.env.PAPERCLIP_RUN_ID };
async function main() {
  const base = process.env.REVIEW_TEST_API;
  if (process.env.PAPERCLIP_TASK_ID && process.env.PAPERCLIP_TASK_ID !== process.env.REVIEW_TEST_ISSUE) {
    console.log('Parent task is unblocked.'); return;
  }
  const url = base + '/api/issues/' + process.env.REVIEW_TEST_ISSUE;
  const read = await fetch(url, { headers }); const issue = await read.json();
  if (!read.ok) throw new Error(JSON.stringify(issue));
  const reviewer = process.env.REVIEW_TEST_ROLE === 'reviewer';
  const firstReview = reviewer && !issue.executionState.lastDecisionId;
  const body = { status: firstReview ? 'in_progress' : 'done', comment: firstReview ? 'Changes requested: add regression evidence.' : reviewer ? 'Accepted: correction verified.' : 'Implementation and regression evidence delivered.' };
  const response = await fetch(url, { method:'PATCH', headers, body:JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error('submission '+response.status+' '+JSON.stringify(result));
  await fetch(base + '/fixture/submitted', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ runId:process.env.PAPERCLIP_RUN_ID, agentId:process.env.PAPERCLIP_AGENT_ID, status:result.status }) });
  await fetch(base + '/fixture/release/' + process.env.PAPERCLIP_RUN_ID);
  console.log('Review stage submitted successfully.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
`;

describe.each(["agent_jwt", "agent_key"] as const)("legacy review handover assembled journey (%s)", source => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let heartbeat: ReturnType<typeof heartbeatService>, server: Server, dir: string;
  const releases = new Map<string, () => void>();
  let closing = false;
  const submitted: Array<{ runId: string; agentId: string; status: string }> = [];
  const oldJwt = process.env.PAPERCLIP_AGENT_JWT_SECRET, oldApi = process.env.PAPERCLIP_API_URL;
  beforeAll(async () => {
    process.env.PAPERCLIP_AGENT_JWT_SECRET = "isolated-review-handover-test-secret";
    temporary = await startEmbeddedPostgresTestDatabase("legacy-review-journey-"); db = createDb(temporary.connectionString);
    dir = await mkdtemp(path.join(tmpdir(), "review-handover-"));
    heartbeat = heartbeatService(db, { runtimeEnv: {} });
  }, 90_000);
  afterAll(async () => {
    closing = true;
    await db?.update(agents).set({ status: "paused" });
    for (const release of releases.values()) release();
    await heartbeat?.drainActiveRunExecutions();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await db?.$client.end(); await temporary?.cleanup();
    if (dir) await rm(dir, { recursive: true, force: true });
    if (oldJwt === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET; else process.env.PAPERCLIP_AGENT_JWT_SECRET = oldJwt;
    if (oldApi === undefined) delete process.env.PAPERCLIP_API_URL; else process.env.PAPERCLIP_API_URL = oldApi;
  });
  it("Hermes delivers, Lead requests changes, Hermes corrects, Lead accepts, owner approves, parent unblocks", async () => {
    const companyId = randomUUID(), engineer = randomUUID(), reviewer = randomUUID(), owner = randomUUID(), taskId = randomUUID(), parentId = randomUUID();
    await db.insert(authUsers).values({ id: owner, name: "Owner", email: `${owner}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companies).values({ id: companyId, name: "Review journey", issuePrefix: `J${companyId.slice(0, 6)}`, defaultResponsibleUserId: owner });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: owner, membershipRole: "operator", status: "active" });
    await db.insert(agents).values([{ id: engineer, companyId, name: "Hermes Engineer", role: "ceo", adapterType: "hermes", status: "idle" },
      { id: reviewer, companyId, name: "Codex Technical Lead", role: "engineer", reportsTo: engineer, adapterType: "process", status: "idle" }]);
    const engineerKey = `fixture-${randomUUID()}`, reviewerKey = `fixture-${randomUUID()}`;
    for (const [agentId, key] of [[engineer, engineerKey], [reviewer, reviewerKey]]) {
      await db.insert(agentApiKeys).values({ companyId, agentId, name: "Fixture key", responsibleUserId: owner,
        keyHash: createHash("sha256").update(key).digest("hex") });
    }
    await db.insert(issues).values([{ id: parentId, companyId, title: "Parent delivery", status: "blocked", assigneeAgentId: engineer },
      { id: taskId, companyId, parentId, title: "Implementation", status: "todo", assigneeAgentId: engineer,
        executionPolicy: { mode: "normal", commentRequired: true, stages: [{ id: "11111111-1111-4111-8111-111111111111", type: "review", participants: [{ type: "agent", agentId: reviewer }] },
          { id: "22222222-2222-4222-8222-222222222222", type: "approval", participants: [{ type: "user", userId: owner }] }] } }]);
    await db.insert(issueRelations).values({ companyId, issueId: taskId, relatedIssueId: parentId, type: "blocks" });
    const app = express(); app.use(express.json());
    app.post("/fixture/submitted", (req, res) => { submitted.push(req.body); res.json({ ok: true }); });
    app.get("/fixture/release/:runId", (req, res) => { if (closing) { res.json({ ok: true }); return; } releases.set(req.params.runId, () => { if (!res.headersSent) res.json({ ok: true }); }); });
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.use((req, _res, next) => { if (req.headers["x-fixture-owner"] === owner) req.actor = { type: "board", source: "local_implicit", userId: owner, companyIds: [companyId], isInstanceAdmin: false }; next(); });
    const storage = { provider: "local_disk", putFile: async () => { throw new Error("unused"); }, getObject: async () => { throw new Error("unused"); }, headObject: async () => ({ exists: false }), deleteObject: async () => {} } satisfies StorageService;
    app.use("/api", issueRoutes(db, storage)); app.use(errorHandler);
    server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.PAPERCLIP_API_URL = api;
    const hermesCommand = path.join(dir, "hermes-fixture"); await writeFile(hermesCommand, `#!${process.execPath}\n${providerScript}`); await chmod(hermesCommand, 0o755);
    for (const [agentId, role] of [[engineer, "engineer"], [reviewer, "reviewer"]] as const) {
      await db.update(agents).set({ adapterConfig: { command: role === "engineer" ? hermesCommand : process.execPath,
        ...(role === "engineer" ? { hermesCommand } : { args: ["-e", providerScript] }), cwd: dir, timeoutSec: 60,
        env: { REVIEW_TEST_API: api, REVIEW_TEST_ISSUE: taskId, REVIEW_TEST_ROLE: role,
          ...(source === "agent_key" ? { REVIEW_TEST_KEY: role === "engineer" ? engineerKey : reviewerKey } : {}) } } }).where(eq(agents.id, agentId));
    }
    const authorizationFixtureRunIds: string[] = [];
    if (source === "agent_key") {
      const [otherRun] = await db.insert(heartbeatRuns).values({ companyId, agentId: reviewer,
        status: "succeeded", finishedAt: new Date(), contextSnapshot: { issueId: taskId } }).returning();
      authorizationFixtureRunIds.push(otherRun.id);
      for (const headers of [
        { authorization: `Bearer ${engineerKey}` },
        { authorization: `Bearer ${engineerKey}`, "x-paperclip-run-id": randomUUID() },
        { authorization: `Bearer ${engineerKey}`, "x-paperclip-run-id": otherRun.id },
        { authorization: "Bearer invalid-fixture-key", "x-paperclip-run-id": otherRun.id },
      ]) {
        const response = await fetch(`${api}/api/issues/${taskId}`, { method: "PATCH",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ status: "done", comment: "Unauthorized handover attempt." }) });
        expect(response.status, JSON.stringify(await response.json())).toBeGreaterThanOrEqual(400);
        expect((await db.select().from(issues).where(eq(issues.id, taskId)))[0]).toMatchObject({ status: "todo", executionState: null });
        expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId))).toHaveLength(0);
      }
    }
    await heartbeat.wakeup(engineer, { source: "assignment", reason: "issue_assigned", contextSnapshot: { issueId: taskId } });
    const waitFor = async (condition: () => boolean | Promise<boolean>) => { const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
      const runs = await db.select({ status: heartbeatRuns.status, error: heartbeatRuns.error, stderr: heartbeatRuns.stderrExcerpt, stdout: heartbeatRuns.stdoutExcerpt }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
      throw new Error(`Journey stalled: ${JSON.stringify(runs)}`); };
    for (let stage = 0; stage < 4; stage++) {
      await waitFor(() => submitted.length === stage + 1 && releases.has(submitted[stage].runId));
      const outgoing = submitted[stage];
      expect(outgoing.agentId).toBe(stage % 2 ? reviewer : engineer);
      // The source is still alive after its HTTP request completed; successor may not start.
      await Promise.race([heartbeatService(db).resumeExecutionWaitComments({ companyId }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Stage ${stage}: live-source scan did not return`)), 5_000))]);
      expect(submitted).toHaveLength(stage + 1);
      const source = (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, outgoing.runId)))[0];
      expect(source.status, `Stage ${stage}: source changed before release`).toBe("running");
      releases.get(outgoing.runId)!(); releases.delete(outgoing.runId);
      await waitFor(async () => (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, outgoing.runId)))[0]?.controllerLeaseExpiresAt === null);
      expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, outgoing.runId)))[0].status).toBe("succeeded");
      if (stage < 3) await Promise.all([heartbeatService(db).resumeExecutionWaitComments({ companyId }), heartbeatService(db).resumeExecutionWaitComments({ companyId })]);
    }
    const pending = (await db.select().from(issues).where(eq(issues.id, taskId)))[0];
    expect(pending).toMatchObject({ status: "in_review", assigneeAgentId: null, assigneeUserId: owner, executionState: { currentStageType: "approval" } });
    expect((await db.select().from(issues).where(eq(issues.id, parentId)))[0].status).toBe("blocked");
    const approval = await fetch(`${api}/api/issues/${taskId}`, { method: "PATCH", headers: { "content-type": "application/json", "x-fixture-owner": owner }, body: JSON.stringify({ status: "done", comment: "Owner approves the verified delivery." }) });
    expect(await approval.json()).toMatchObject({ status: "done" }); expect(approval.status).toBe(200);
    const readiness = await (await import("../services/issues.js")).issueService(db).getDependencyReadiness(parentId);
    expect(readiness.unresolvedBlockerCount).toBe(0);
    expect(await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.companyId, companyId))).toHaveLength(0);
    // The scope trigger fills issueId from contextSnapshot for the key-auth
    // rejection fixture too. Account for that row separately from the four executions.
    const taskRuns = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.issueId, taskId)));
    expect(submitted).toHaveLength(4);
    expect(taskRuns).toHaveLength(4 + authorizationFixtureRunIds.length);
    expect(taskRuns.map(run => run.id).sort()).toEqual([
      ...submitted.map(run => run.runId), ...authorizationFixtureRunIds,
    ].sort());
    // Historical resolved no-replay holds use the board API and keep the review intact.
    const heldId = randomUUID();
    const policy = normalizeIssueExecutionPolicy(pending.executionPolicy);
    const [base] = await db.insert(issues).values({ companyId, id: heldId, title: "Historical handover", status: "in_progress",
      assigneeAgentId: engineer, executionPolicy: pending.executionPolicy }).returning();
    const transition = applyIssueExecutionPolicyTransition({ issue: base, policy, requestedStatus: "done",
      requestedAssigneePatch: {}, actor: { agentId: engineer }, commentBody: "Historical delivery was accepted." });
    const [held] = await db.update(issues).set(transition.patch).where(eq(issues.id, heldId)).returning();
    const [stopped] = await db.insert(heartbeatRuns).values({ companyId, agentId: engineer, issueId: heldId,
      status: "cancelled", runtimeMode: "legacy", errorCode: "issue_reassigned", finishedAt: new Date(), contextSnapshot: { issueId: heldId },
      resultJson: { reassignmentStopConfirmed: true, executionCancellation: { state: "acknowledged" },
        executionRecovery: { providerStopped: true, actionOutcomes: "unknown" }, externalEffect: "retained evidence" } }).returning();
    await db.insert(activityLog).values({ companyId, actorType: "system", actorId: "fixture", action: "issue.updated",
      entityType: "issue", entityId: heldId, details: { interruptedRunId: stopped.id, executionState: held.executionState } });
    const automaticRecovery = { policy: "preserve_without_replay_v1", replay: "blocked", actionOutcome: "unknown" };
    const [hold] = await db.insert(issueRecoveryActions).values({ companyId, sourceIssueId: heldId, kind: "active_run_watchdog",
      fingerprint: `legacy-execution:${stopped.id}`, cause: "legacy_execution_requires_reconciliation", status: "resolved", outcome: "blocked", ownerType: "board",
      nextAction: "Verify the stopped provider and external actions.", evidence: { runId: stopped.id, automaticRecovery } }).returning();
    const reconciliation = { actionId: hold.id, outcome: "restored", sourceIssueStatus: "in_review", executionReconciliation: {
      runId: stopped.id, providerStopped: true, actionOutcome: "completed", outcomeEvidence: "Owner verified the stopped provider, delivery and all external effects." } };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${api}/api/issues/${heldId}/recovery-actions/resolve`, { method: "POST",
        headers: { "content-type": "application/json", "x-fixture-owner": owner }, body: JSON.stringify(reconciliation) });
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result).toMatchObject({ issue: { status: "in_review", assigneeAgentId: reviewer }, recoveryAction: {
        status: "resolved", outcome: "restored", evidence: { priorAutomaticRecovery: automaticRecovery, reviewHandoverOnly: true, continuationDelivery: "not_requested" } } });
    }
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, stopped.id)))[0]).toEqual(stopped);
    expect(await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, companyId), eq(agentWakeupRequests.agentId, reviewer),
      eq(agentWakeupRequests.idempotencyKey, `execution-stage:${heldId}:${(held.executionState as { currentStageId: string }).currentStageId}:null:pending:${reviewer}`)))).toHaveLength(1);

  }, 90_000);
});
