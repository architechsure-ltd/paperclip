import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PAPERCLIP_E2E_PORT ?? 3211);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PAPERCLIP_HOME = process.env.PAPERCLIP_E2E_DATA_DIR
  ?? fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-human-review-"));
const PAPERCLIP_INSTANCE_ID = "human-review-e2e";
const PAPERCLIP_CONFIG = path.join(PAPERCLIP_HOME, "instances", PAPERCLIP_INSTANCE_ID, "config.json");

process.env.PAPERCLIP_HOME = PAPERCLIP_HOME;
process.env.PAPERCLIP_CONFIG = PAPERCLIP_CONFIG;
process.env.PAPERCLIP_E2E_DATA_DIR = PAPERCLIP_HOME;
process.env.PAPERCLIP_E2E_CONFIG_PATH = PAPERCLIP_CONFIG;
process.env.PAPERCLIP_E2E_SERVER_CONFIG = PAPERCLIP_CONFIG;

export default defineConfig({
  testDir: ".",
  testMatch: "human-review-authenticated.spec.ts",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    cwd: path.resolve(import.meta.dirname, "../.."),
    command: "node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts onboard --yes --bind lan --run",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(PORT),
      PAPERCLIP_OPEN_ON_LISTEN: "false",
      PAPERCLIP_UI_DEV_MIDDLEWARE: "false",
      PAPERCLIP_API_URL: BASE_URL,
      PAPERCLIP_HOME,
      PAPERCLIP_INSTANCE_ID,
      PAPERCLIP_CONFIG,
      PAPERCLIP_BIND: "loopback",
      PAPERCLIP_DEPLOYMENT_MODE: "authenticated",
      PAPERCLIP_DEPLOYMENT_EXPOSURE: "private",
    },
  },
  outputDir: "./test-results/human-review-authenticated",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report/human-review-authenticated" }]],
});
