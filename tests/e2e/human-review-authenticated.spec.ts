import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import { eq } from "../../server/node_modules/drizzle-orm/index.js";
import { closeRegisteredClients, createDb, issues } from "../../packages/db/src/index.ts";

const BASE = process.env.PAPERCLIP_E2E_BASE_URL ?? "http://127.0.0.1:3211";
const DATA_DIR = process.env.PAPERCLIP_E2E_DATA_DIR ?? process.env.PAPERCLIP_HOME;
const CONFIG_PATH = process.env.PAPERCLIP_E2E_SERVER_CONFIG!;
const BOOTSTRAP_SCRIPT = path.resolve("packages/db/scripts/create-auth-bootstrap-invite.ts");
const runId = Date.now();
const owner = {
  name: "Review Owner",
  email: `review-owner-${runId}@paperclip.local`,
  password: "paperclip-review-owner-password",
};
const otherUser = {
  name: "Other Operator",
  email: `review-other-${runId}@paperclip.local`,
  password: "paperclip-review-other-password",
};

type JsonResult<T> = { ok: boolean; status: number; json: T | null; text: string };

async function sessionJson<T>(page: Page, url: string, method = "GET", data?: unknown) {
  return page.evaluate(async ({ target, method, data }) => {
    const response = await fetch(target, {
      method,
      credentials: "include",
      headers: data === undefined ? undefined : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await response.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: response.ok, status: response.status, json, text };
  }, { target: url, method, data }) as Promise<JsonResult<T>>;
}

async function signUp(page: Page, user: typeof owner) {
  await page.goto(`${BASE}/auth`);
  await expect(page.getByRole("heading", { name: "Sign in to Paperclip" })).toBeVisible();
  await page.getByRole("button", { name: "Create one" }).click();
  await page.getByLabel("Name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 20_000 });
}

function createBootstrapToken() {
  if (!DATA_DIR || !existsSync(CONFIG_PATH)) throw new Error("Authenticated bootstrap fixture is not ready");
  const tsx = path.resolve("packages/db/node_modules/tsx/dist/cli.mjs");
  const inviteUrl = execFileSync(
    process.execPath,
    [tsx, BOOTSTRAP_SCRIPT, "--config", CONFIG_PATH, "--base-url", BASE],
    {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", PAPERCLIP_HOME: DATA_DIR },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
  return new URL(inviteUrl).pathname.split("/").at(-1)!;
}

async function bootstrapOwner(page: Page) {
  const token = createBootstrapToken();
  const accepted = await sessionJson<{ bootstrapAccepted: boolean }>(
    page,
    `${BASE}/api/invites/${token}/accept`,
    "POST",
    { requestType: "human" },
  );
  expect(accepted.ok).toBe(true);
  expect(accepted.json?.bootstrapAccepted).toBe(true);
}

async function databaseUrl() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  if (config.database.mode === "postgres") return config.database.connectionString as string;
  const pidFile = await readFile(path.join(config.database.embeddedPostgresDataDir, "postmaster.pid"), "utf8");
  return `postgres://paperclip:paperclip@127.0.0.1:${pidFile.split("\n")[3]}/paperclip`;
}

async function newUserPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test("human review decisions work in task detail and both Decisions surfaces", async ({ browser, page }, testInfo: TestInfo) => {
  test.setTimeout(240_000);
  await signUp(page, owner);
  await bootstrapOwner(page);

  const session = await sessionJson<{ user: { id: string } }>(page, `${BASE}/api/auth/get-session`);
  expect(session.ok).toBe(true);
  const ownerId = session.json!.user.id;
  const company = await sessionJson<{ id: string; issuePrefix: string }>(page, `${BASE}/api/companies`, "POST", {
    name: `Human review QA ${runId}`,
  });
  expect(company.ok).toBe(true);
  const companyId = company.json!.id;
  const prefix = company.json!.issuePrefix;

  const invite = await sessionJson<{ inviteUrl: string }>(page, `${BASE}/api/companies/${companyId}/invites`, "POST", {
    allowedJoinTypes: "human",
    humanRole: "operator",
  });
  expect(invite.ok).toBe(true);
  const other = await newUserPage(browser);
  const dbUrl = await databaseUrl();
  const db = createDb(dbUrl);
  try {
    await signUp(other.page, otherUser);
    const inviteToken = new URL(invite.json!.inviteUrl, BASE).pathname.split("/").at(-1)!;
    const joined = await sessionJson(other.page, `${BASE}/api/invites/${inviteToken}/accept`, "POST", {
      requestType: "human",
    });
    expect(joined.ok).toBe(true);

    const engineer = await sessionJson<{ id: string }>(page, `${BASE}/api/companies/${companyId}/agents`, "POST", {
      name: "Review QA Engineer",
      role: "engineer",
      adapterType: "process",
      adapterConfig: { command: process.execPath, args: ["-e", "process.exit(0)"] },
      runtimeConfig: { heartbeat: { enabled: false } },
    });
    expect(engineer.ok).toBe(true);

    async function seedReviewTask(title: string, escalation = false) {
      const created = await sessionJson<{ id: string; identifier: string }>(page, `${BASE}/api/companies/${companyId}/issues`, "POST", {
        title,
        status: "backlog",
        assigneeAgentId: engineer.json!.id,
      });
      expect(created.ok).toBe(true);
      const stageId = randomUUID();
      const policy = {
        stages: [{ id: stageId, type: "review", participants: [{ type: "user", userId: ownerId }] }],
      };
      const state = {
        status: "pending",
        currentStageId: stageId,
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "user", agentId: null, userId: ownerId },
        returnAssignee: { type: "agent", agentId: engineer.json!.id, userId: null },
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
        changesRequestedCount: escalation ? 3 : 0,
        reviewEscalation: escalation ? {
          version: 1,
          reviewerAgentId: engineer.json!.id,
          responsibleUserId: ownerId,
          reason: "Maximum review rounds reached. The owner must decide how this work continues.",
        } : null,
      };
      await db.update(issues).set({
        status: "in_review",
        assigneeAgentId: null,
        assigneeUserId: ownerId,
        executionPolicy: policy,
        executionState: state,
        updatedAt: new Date(),
      }).where(eq(issues.id, created.json!.id));
      return { ...created.json!, title, stageId, state };
    }

    const detailTask = await seedReviewTask(`Detail review ${runId}`);
    const classicTask = await seedReviewTask(`Classic decisions review ${runId}`);
    const coordinatorTask = await seedReviewTask(`Coordinator decisions review ${runId}`);
    const escalationTask = await seedReviewTask(`Owner escalation review ${runId}`, true);

    await page.goto(`${BASE}/${prefix}/issues/${detailTask.identifier}`);
    const detailComment = page.getByLabel("Decision comment");
    await expect(detailComment).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Request changes", exact: true })).toBeDisabled();

    await other.page.goto(`${BASE}/${prefix}/issues/${detailTask.identifier}`);
    await expect(other.page.getByLabel("Decision comment")).toHaveCount(0);
    for (const status of ["done", "in_progress"]) {
      const denied = await sessionJson(other.page, `${BASE}/api/issues/${detailTask.id}`, "PATCH", {
        status,
        comment: "Unauthorised decision attempt",
        reviewDecision: { currentStageId: detailTask.stageId, lastDecisionId: null },
      });
      expect(denied.status).toBe(403);
    }

    await detailComment.fill("Return this to Engineering with the requested correction.");
    await page.screenshot({ path: testInfo.outputPath("task-detail-review.png"), fullPage: true });
    await page.getByRole("button", { name: "Request changes", exact: true }).click();
    await expect.poll(async () => (await sessionJson<any>(page, `${BASE}/api/issues/${detailTask.id}`)).json)
      .toMatchObject({
        status: "in_progress",
        assigneeAgentId: engineer.json!.id,
        executionState: { status: "changes_requested" },
      });

    await page.goto(`${BASE}/${prefix}/decisions`);
    const classicRow = page.locator("[data-attention-row]").filter({ hasText: classicTask.title });
    await expect(classicRow).toBeVisible();
    await classicRow.locator('button[aria-label="Expand decision"]').click();
    await expect(classicRow.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    await classicRow.getByLabel("Decision comment").fill("Approved from the classic Decisions queue.");
    await page.screenshot({ path: testInfo.outputPath("classic-decisions-review.png"), fullPage: true });
    await classicRow.getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(async () => (await sessionJson<any>(page, `${BASE}/api/issues/${classicTask.id}`)).json?.status)
      .toBe("done");

    const enabled = await sessionJson(page, `${BASE}/api/companies/${companyId}/workspace-preferences/me`, "PUT", {
      coordinatorWorkspaceEnabled: true,
    });
    expect(enabled.ok).toBe(true);
    await page.goto(`${BASE}/${prefix}/decisions`);
    const coordinatorCard = page.locator("article").filter({ hasText: coordinatorTask.title });
    await expect(coordinatorCard).toBeVisible();
    await coordinatorCard.getByLabel("Decision comment").fill("Coordinator requests one more Engineering revision.");
    await page.screenshot({ path: testInfo.outputPath("coordinator-decisions-review.png"), fullPage: true });
    await coordinatorCard.getByRole("button", { name: "Request changes", exact: true }).click();
    await expect.poll(async () => (await sessionJson<any>(page, `${BASE}/api/issues/${coordinatorTask.id}`)).json)
      .toMatchObject({ status: "in_progress", assigneeAgentId: engineer.json!.id });

    const escalationCard = page.locator("article").filter({ hasText: escalationTask.title });
    await expect(escalationCard.getByText("Review rounds exhausted")).toBeVisible();
    await expect(escalationCard.getByText("Maximum review rounds reached", { exact: false })).toBeVisible();
    await escalationCard.getByLabel("Decision comment").fill("Owner requests the final Engineering correction.");
    await page.screenshot({ path: testInfo.outputPath("owner-escalation-review.png"), fullPage: true });
    await escalationCard.getByRole("button", { name: "Request changes", exact: true }).click();
    await expect.poll(async () => (await sessionJson<any>(page, `${BASE}/api/issues/${escalationTask.id}`)).json)
      .toMatchObject({
        status: "in_progress",
        assigneeAgentId: engineer.json!.id,
        executionState: { status: "changes_requested" },
      });
  } finally {
    await closeRegisteredClients(dbUrl, { scope: "database" });
    await other.context.close();
  }
});
