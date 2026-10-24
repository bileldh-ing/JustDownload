import { expect, test } from "@playwright/test";

const FIX = "http://127.0.0.1:4599";
const workerMode = !!process.env.E2E_WORKER_URL;

test.describe("downloader (any deployment)", () => {
  test("home page is usable and branded @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/JustDownload/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Paste a link");
    await expect(page.getByTestId("url-input")).toBeVisible();
    await expect(page.getByTestId("inspect-button")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("invalid and unsafe URLs show an accessible error without a request @mobile", async ({ page }) => {
    let posted = 0;
    page.on("request", (r) => { if (r.url().includes("/api/v1/inspections")) posted++; });
    await page.goto("/");
    const input = page.getByTestId("url-input");
    await input.fill("ftp://example.com/a.mp4");
    await page.getByTestId("inspect-button").click();
    await expect(page.getByTestId("url-error")).toContainText("Only http");
    await input.fill("http://169.254.169.254/latest/meta-data/");
    await input.press("Enter");
    await expect(page.getByTestId("url-error")).toContainText("private");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    expect(posted).toBe(0);
  });

  test("restricted platform returns a policy result, not fake formats", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("url-input").fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    await expect(page.getByText("Official export only").first()).toBeVisible();
    await page.getByTestId("inspect-button").click();
    await expect(page.getByTestId("policy-card")).toBeVisible();
    await expect(page.getByTestId("option-list")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /YouTube Studio/ })).toHaveAttribute("rel", /noopener/);
  });

  test("web pages are rejected with a categorized message", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("url-input").fill(`${FIX}/page.html`);
    await page.getByTestId("inspect-button").click();
    await expect(page.getByTestId("inspect-error")).toContainText("web page");
  });

  test("inspection result fits a narrow screen @mobile", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("url-input").fill(`${FIX}/clip.mp4`);
    await page.getByTestId("inspect-button").click();
    await expect(page.getByTestId("inspection-result")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("keyboard-only inspection works and focus moves to the result", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("url-input").focus();
    await page.keyboard.type(`${FIX}/clip.mp4`);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspection-result")).toBeVisible();
    await expect(page.locator("#result-title")).toBeFocused();
  });

  test("theme toggle switches to light and persists", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("theme-toggle").click();
    await page.getByTestId("theme-option-light").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("supported sources page is generated from the policy registry", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.getByTestId("provider-direct_media")).toContainText("Download & convert");
    await expect(page.getByTestId("provider-youtube")).toContainText("Official export only");
    await expect(page.getByTestId("provider-x")).toContainText("Not supported");
  });
});

test.describe("without a worker (Vercel mode)", () => {
  test.skip(workerMode, "worker connected");
  test("basic inspection reports server facts and offers no options", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("worker-chip")).toHaveText("Inspection only");
    await page.getByTestId("url-input").fill(`${FIX}/clip.mp4`);
    await page.getByTestId("inspect-button").click();
    const card = page.getByTestId("basic-card");
    await expect(card).toContainText("MPEG-4 (MP4)");
    await expect(card).toContainText("video/mp4");
    await expect(page.getByTestId("option-list")).toHaveCount(0);
    await expect(page.getByTestId("inspection-result")).toHaveAttribute("data-mode", "basic");
  });
});
