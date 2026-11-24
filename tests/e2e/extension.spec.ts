import {
  test as base,
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const test = base.extend<{
  siteAccess: boolean;
  extension: { context: BrowserContext; panel: Page; url: string };
}>({
  siteAccess: [true, { option: true }],
  extension: async ({ siteAccess }, use) => {
    const dir = await mkdtemp(join(tmpdir(), "routeback-e2e-"));
    const extension = join(dir, "extension");
    await cp(resolve("dist-demo"), extension, { recursive: true });
    // Test-only grant: avoid an interactive browser permission dialog; never change the distributed manifest.
    const path = join(extension, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    if (siteAccess) manifest.host_permissions = ["https://chatgpt.com/*"];
    await writeFile(path, JSON.stringify(manifest));
    const context = await chromium.launchPersistentContext(
      join(dir, "profile"),
      {
        channel: "chromium",
        headless: true,
        viewport: { width: 420, height: 900 },
        args: [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      },
    );
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    await expect
      .poll(async () =>
        worker.evaluate(
          async () =>
            (await chrome.scripting.getRegisteredContentScripts()).length,
        ),
      )
      .toBe(siteAccess ? 2 : 0);
    const panel = await context.newPage();
    const url = `chrome-extension://${id}/sidepanel.html`;
    await panel.goto(url);
    await panel.getByRole("button", { name: "Got it, let’s begin" }).click();
    await use({ context, panel, url });
    await context.close();
    await rm(dir, { recursive: true, force: true });
  },
});
async function ask(panel: Page, query: string) {
  await panel
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(query);
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel.locator(".message.assistant").last()).toContainText(
    "Demo response",
  );
  await expect(
    panel.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
}
async function fixture(context: BrowserContext, status = 503) {
  const html = await readFile(resolve("tests/fixtures/chatgpt.html"), "utf8");
  await context.route("https://chatgpt.com/", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await context.route("https://chatgpt.com/backend-api/conversation", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ error: "fixture-only" }),
    }),
  );
  const page = await context.newPage();
  await page.goto("https://chatgpt.com/");
  return page;
}
test("standalone local chat persists across panel reopening without mixing conversations", async ({
  extension: { panel, context, url },
}) => {
  await panel.screenshot({ path: "test-results/chat-preview.png" });
  await ask(panel, "Why is the sky blue?");
  await expect(panel.locator(".message.assistant")).toContainText(
    "Gemini Nano · on-device",
  );
  await ask(panel, "Explain it more simply.");
  await expect(panel.locator(".message.assistant")).toHaveCount(2);
  await panel.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.locator(".message.assistant")).toHaveCount(2);
  await reopened.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(reopened.locator(".message")).toHaveCount(0);
});
test("routes coding and 26-word queries to cloud, blocks them in Local only", async ({
  extension: { panel },
}) => {
  await ask(panel, "Write a Python function.");
  await expect(panel.locator(".message.assistant").last()).toContainText(
    "Gemini · Firebase cloud",
  );
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await ask(panel, Array(26).fill("word").join(" "));
  await expect(panel.locator(".message.assistant").last()).toContainText(
    "Query exceeds 25 words",
  );
  await panel.getByRole("button", { name: "New chat", exact: true }).click();
  await panel.getByLabel("Inference mode").selectOption("local");
  await panel
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Write code");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Switch to Auto");
  await expect(panel.locator(".message.assistant")).toHaveCount(0);
});
test("captures visible context and recovers matching HTTP 503 without saving a chat", async ({
  extension: { context, panel },
}) => {
  await panel.evaluate(() =>
    chrome.storage.local.set({ adapterVerified: true }),
  );
  const page = await fixture(context);
  await page
    .getByRole("textbox", { name: "ChatGPT query" })
    .fill("Why is the sky blue?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("503");
  await expect(panel.locator(".result")).toContainText("Why is the sky blue?", {
    timeout: 15000,
  });
  await expect(panel.locator(".result")).toContainText(
    "Gemini Nano · on-device",
  );
  await panel.screenshot({ path: "test-results/recovery-preview.png" });
  await expect
    .poll(() =>
      panel.evaluate(
        async () =>
          (
            (await chrome.storage.session.get("routeback.pending.v1"))[
              "routeback.pending.v1"
            ] as unknown[]
          ).length,
      ),
    )
    .toBe(0);
  await panel.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(panel.locator(".message")).toHaveCount(0);
});
test("requires confirmation until the adapter is validated and excludes hidden text", async ({
  extension: { context, panel },
}) => {
  const page = await fixture(context);
  await page
    .getByRole("textbox", { name: "ChatGPT query" })
    .fill("Explain sunlight");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await panel.getByRole("button", { name: /^Recovery/ }).click();
  await expect(
    panel.getByRole("button", { name: "Confirm prompt & recover" }),
  ).toBeVisible();
  await panel
    .getByText("Visible conversation · 2 messages", { exact: true })
    .click();
  await expect(panel.locator(".context-turn")).toHaveCount(2);
  await expect(panel.locator(".context-turn").first()).not.toContainText(
    "secret hidden text",
  );
  await expect(panel.locator(".context-turn").first()).not.toContainText(
    "Copy",
  );
  await expect(panel.locator(".result")).toHaveCount(0);
  await panel.getByRole("button", { name: "Confirm prompt & recover" }).click();
  await expect(panel.locator(".result")).toContainText("Demo response");
});
test("clears a successful ChatGPT request without generating recovery", async ({
  extension: { context, panel },
}) => {
  await panel.evaluate(() =>
    chrome.storage.local.set({ adapterVerified: true }),
  );
  const page = await fixture(context, 200);
  await page
    .getByRole("textbox", { name: "ChatGPT query" })
    .fill("Why is the sky blue?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("200");
  await expect
    .poll(() =>
      panel.evaluate(
        async () =>
          (
            ((await chrome.storage.session.get("routeback.pending.v1"))[
              "routeback.pending.v1"
            ] as unknown[]) || []
          ).length,
      ),
    )
    .toBe(0);
  await panel.getByRole("button", { name: /^Recovery/ }).click();
  await expect(panel.locator(".result")).toHaveCount(0);
});
test("production manifest bundles scripts and never ships the demo simulator", async () => {
  const manifest = JSON.parse(
    await readFile(resolve("dist/manifest.json"), "utf8"),
  );
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.optional_host_permissions).toEqual(["https://chatgpt.com/*"]);
  const bridge = await readFile(resolve("dist/assets/bridge.js"), "utf8");
  expect(() => new Function(bridge)).not.toThrow();
  const files = await import("node:fs/promises").then((fs) =>
    fs.readdir(resolve("dist/assets")),
  );
  const background = await readFile(
    resolve(
      "dist/assets",
      files.find((f) => f.startsWith("index.ts-") && f.endsWith(".js"))!,
    ),
    "utf8",
  );
  expect(background).not.toContain("demo-failure");
});

test('classifies a captured coding query after the panel reopens, then recovers in cloud', async ({ extension: { context, panel, url } }) => {
  await panel.evaluate(() => chrome.storage.local.set({ adapterVerified: true }));
  await panel.close();
  const page = await fixture(context);
  await page.getByRole('textbox', { name: 'ChatGPT query' }).fill('Write a Python function to sort names.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('503');
  const reopened = await context.newPage(); await reopened.goto(url);
  await expect(reopened.locator('.result')).toContainText('Coding request');
  await expect(reopened.locator('.result')).toContainText('Gemini · Firebase cloud');
  await page.close();
  await expect(reopened.locator('.result')).toHaveCount(0);
});

test.describe('optional site access', () => {
  test.use({ siteAccess: false });
  test('standalone chat works without ChatGPT host permission', async ({ extension: { panel } }) => {
    expect(await panel.evaluate(() => chrome.permissions.contains({ origins: ['https://chatgpt.com/*'] }))).toBe(false);
    await panel.getByLabel('Inference mode').selectOption('local');
    await ask(panel, 'Explain rainbows');
    await expect(panel.locator('.message.assistant')).toContainText('Gemini Nano · on-device');
  });
});
