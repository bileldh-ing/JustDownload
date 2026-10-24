import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Prefer a system Chromium when present (arm64 sandboxes); CI uses Playwright's own build.
const systemChromium = process.env.PW_CHROMIUM_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const PORT = Number(process.env.E2E_PORT ?? 3100);
const launchOptions = systemChromium ? { executablePath: systemChromium, args: ["--no-sandbox", "--disable-dev-shm-usage"] } : { args: ["--disable-dev-shm-usage"] };

/**
 * E2E suites:
 *  - web-only (always): the app without a worker, i.e. how the Vercel deployment behaves.
 *  - full (E2E_WORKER_URL set): a real worker + Redis behind the web app; downloads a real MP3.
 * The fixture server (globalSetup) serves FFmpeg-generated media on 127.0.0.1:4599.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`, trace: "off", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `./node_modules/.bin/next start -p ${PORT}`,
    port: PORT, reuseExistingServer: true, timeout: 120_000,
    env: { JD_ALLOW_PRIVATE_NETWORK: "1", COOKIE_SECURE: "0", ...(process.env.E2E_WORKER_URL ? { WORKER_URL: process.env.E2E_WORKER_URL, WORKER_API_TOKEN: process.env.E2E_WORKER_TOKEN ?? "" } : {}) },
  },
});
