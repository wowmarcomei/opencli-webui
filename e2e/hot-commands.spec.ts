/**
 * E2E tests for opencli hot-post commands: zhihu/hot and weibo/hot.
 *
 * These tests exercise the full stack:
 *   Browser (CDP) → opencli-webui → /api/execute → opencli CLI → browser session
 *
 * Prerequisites:
 *   - opencli v1.7.4+ installed globally (`npm install -g @jackwener/opencli`)
 *   - For weibo/hot (Strategy.COOKIE): logged-in browser session via opencli daemon
 *
 * If opencli is not installed the tests skip automatically.
 * If the browser session is missing, weibo/hot will report an error (expected).
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Stream-parse the SSE response from /api/execute and return the final result. */
async function executeCommand(
  request: APIRequestContext,
  site: string,
  name: string,
  args: Record<string, string> = {}
): Promise<{ data: unknown; error?: string; exitCode: number }> {
  const res = await request.post("/api/execute", {
    data: { site, name, args, format: "json" },
    headers: { "Content-Type": "application/json" },
    timeout: 45_000,
  });

  expect(res.status()).toBe(200);
  const body = await res.text();

  let data: unknown = null;
  let error: string | undefined;
  let exitCode = -1;

  for (const block of body.split("\n\n")) {
    let eventName = "message";
    let dataLine = "";
    for (const line of block.trim().split("\n")) {
      if (line.startsWith("event: ")) eventName = line.slice(7).trim();
      if (line.startsWith("data: ")) dataLine = line.slice(6);
    }
    if (!dataLine) continue;
    const payload = JSON.parse(dataLine);

    if (eventName === "result") data = payload.data;
    if (eventName === "error") error = payload.message;
    if (eventName === "done") exitCode = payload.code ?? -1;
  }

  return { data, error, exitCode };
}

// ── Setup guard ───────────────────────────────────────────────────────────────

test.beforeAll(async ({ request }) => {
  const res = await request.get("/api/setup");
  const { installed } = await res.json();
  if (!installed) {
    test.skip(true, "opencli not installed — skipping command tests");
  }
});

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe("opencli hot commands via webui", () => {

  test("GET /api/commands includes zhihu/hot and weibo/hot", async ({ request }) => {
    const res = await request.get("/api/commands");
    expect(res.status()).toBe(200);
    const commands = await res.json() as Array<{ site: string; name: string }>;
    expect(Array.isArray(commands)).toBe(true);

    const zhihuHot = commands.find((c) => c.site === "zhihu" && c.name === "hot");
    const weiboHot = commands.find((c) => c.site === "weibo" && c.name === "hot");
    expect(zhihuHot).toBeDefined();
    expect(weiboHot).toBeDefined();
  });

  test("zhihu/hot: returns ranked hot-list items via CDP", async ({ request }) => {
    const { data, error, exitCode } = await executeCommand(request, "zhihu", "hot", { limit: "5" });

    // Zhihu hot uses public API with cookie — requires browser session
    if (error?.includes("connect") || error?.includes("daemon") || error?.includes("browser")) {
      test.skip(true, `Browser session unavailable: ${error}`);
    }

    expect(exitCode).toBe(0);
    expect(error).toBeUndefined();
    expect(Array.isArray(data)).toBe(true);

    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);

    const first = rows[0];
    expect(first).toHaveProperty("rank");
    expect(first).toHaveProperty("title");
    expect(first).toHaveProperty("heat");
    expect(first).toHaveProperty("answers");

    expect(typeof first.rank).toBe("number");
    expect(typeof first.title).toBe("string");
    expect((first.title as string).length).toBeGreaterThan(0);
  });

  test("weibo/hot: returns ranked hot-search items via CDP", async ({ request }) => {
    const { data, error, exitCode } = await executeCommand(request, "weibo", "hot", { limit: "10" });

    // Weibo hot requires authenticated browser session (Strategy.COOKIE)
    if (error?.includes("connect") || error?.includes("daemon") || error?.includes("browser")) {
      test.skip(true, `Browser session unavailable: ${error}`);
    }

    expect(exitCode).toBe(0);
    expect(error).toBeUndefined();
    expect(Array.isArray(data)).toBe(true);

    const rows = data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(10);

    const first = rows[0];
    expect(first).toHaveProperty("rank");
    expect(first).toHaveProperty("word");
    expect(first).toHaveProperty("hot_value");
    expect(first).toHaveProperty("url");

    expect(typeof first.word).toBe("string");
    expect((first.word as string).length).toBeGreaterThan(0);
    expect(first.url as string).toMatch(/weibo\.com/);
  });

  test("UI: zhihu/hot command is visible and executable in command list", async ({ page }) => {
    await page.goto("/");

    // Wait for command list to load (past setup guard)
    await page.waitForSelector("text=OpenCLI WebUI", { timeout: 10_000 });

    // Find zhihu in the site sidebar
    const zhihuBtn = page.getByRole("button", { name: /zhihu|知乎/i });
    await expect(zhihuBtn.first()).toBeVisible({ timeout: 15_000 });
    await zhihuBtn.first().click();

    // Find and expand the "hot" command
    const hotRow = page.locator("text=hot").first();
    await expect(hotRow).toBeVisible({ timeout: 5_000 });
    await hotRow.click();

    // The InlineRunner form should appear
    const runBtn = page.getByRole("button", { name: /执行/i }).first();
    await expect(runBtn).toBeVisible({ timeout: 5_000 });
  });

});
