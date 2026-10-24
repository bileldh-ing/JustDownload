import { readFileSync, statSync } from "node:fs";
import { expect, test } from "@playwright/test";

const FIX = "http://127.0.0.1:4599";

/** Real worker + Redis behind the app. Skipped (reported as skipped) when no worker is configured. */
test.describe("full pipeline with a worker", () => {
  test.skip(!process.env.E2E_WORKER_URL, "set E2E_WORKER_URL to run against a real worker");

  test("inspect → MP3 → real progress → verified download, survives refresh", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("worker-chip")).toHaveText("Worker online");
    await page.getByTestId("url-input").fill(`${FIX}/clip.mp4`);
    await page.getByTestId("inspect-button").click();
    await expect(page.getByTestId("media-title")).toHaveText("JustDownload E2E clip");
    await expect(page.getByTestId("option-video:mp4-h264-360")).toBeVisible();
    await expect(page.getByTestId("option-video:mp4-h264-720")).toHaveCount(0); // never above the 360p source
    await page.getByTestId("tab-audio").click();
    await page.getByTestId("option-audio:mp3-v2").click();
    await page.getByTestId("filename-input").fill("E2E Song");
    await page.getByTestId("start-button").click();
    await expect(page).toHaveURL(/\/jobs\//);
    await page.reload(); // state comes from the backend, not the client
    await expect(page.getByTestId("ready-panel")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("job-state")).toHaveText("Ready");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-link").click()]);
    expect(download.suggestedFilename()).toBe("E2E Song.mp3");
    const p = await download.path();
    expect(statSync(p).size).toBeGreaterThan(1000);
    const head = readFileSync(p).subarray(0, 3).toString("latin1");
    expect(head === "ID3" || readFileSync(p)[0] === 0xff).toBe(true);
  });

  test("cancelling a running job", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("url-input").fill(`${FIX}/slow/big.mp4`);
    await page.getByTestId("inspect-button").click();
    await expect(page.getByTestId("inspection-result")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tab-audio").click();
    await page.getByTestId("option-audio:wav").click();
    await page.getByTestId("start-button").click();
    await expect(page.getByTestId("job-state")).toHaveText("Downloading source", { timeout: 30_000 });
    await page.getByTestId("cancel-button").click();
    await expect(page.getByTestId("job-state")).toHaveText("Cancelled");
  });
});
