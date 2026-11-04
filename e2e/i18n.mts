/** Production-built admin host + headless browser, mocked HTTP boundary (not a real backend login). */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";

const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`;
const server = spawn("pnpm", ["--filter", "@neton/application-front-shell", "exec", "next", "start", "-p", String(port), "-H", "127.0.0.1"], {
  stdio: "ignore",
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try { ready = (await fetch(`${origin}/login`)).ok; } catch { /* starting */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "the production admin host started");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "zh-CN" });
  let id: number | null = null;
  let locale = "en-US";
  let fail = false;
  let writes = 0;
  let releaseSite!: () => void;
  const siteReady = new Promise<void>((resolve) => { releaseSite = resolve; });
  await page.route("**/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const respond = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path.endsWith("/site/public")) {
      await siteReady;
      return respond({ code: 0, data: { locale: "zh-CN" } });
    }
    if (path.endsWith("/profile/get")) return id === null
      ? respond({ code: 401 }, 401) : respond({ code: 0, data: { id, locale } });
    if (path.endsWith("/profile/update")) {
      writes++;
      if (fail) return respond({ code: 3 }, 500);
      assert.equal(route.request().headers()["x-neton-preference-subject"], String(id));
      locale = route.request().postDataJSON().locale;
      return respond({ code: 0 });
    }
    return respond({ code: 0, data: { enabled: false } });
  });
  await page.goto(`${origin}/login`);
  const language = page.getByRole("combobox");
  await language.selectOption("en-US");
  await page.waitForFunction(() => document.documentElement.lang === "en-US");
  assert.equal(writes, 0, "anonymous choice is local only");
  releaseSite();
  await page.waitForResponse((response) => response.url().endsWith("/site/public"));
  assert.equal(await language.inputValue(), "en-US", "late site default does not undo a manual choice");
  id = 42;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.documentElement.lang === "en-US");
  await language.selectOption("zh-CN");
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  await page.waitForFunction(() => !(document.querySelector("select") as HTMLSelectElement)?.disabled);
  assert.equal(locale, "zh-CN", "authenticated choice persisted");
  fail = true;
  await language.selectOption("en-US");
  await page.getByRole("status").waitFor();
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  assert.equal(locale, "zh-CN", "failed save did not change stored preference");
  fail = false;
  id = 43; locale = "en-US";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.documentElement.lang === "en-US");
  id = 44; locale = "";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  console.log("[i18n] admin browser: anonymous choice, persistence, failure rollback, same-path identity change and no-preference isolation passed");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => server.exitCode !== null ? resolve() : server.once("exit", () => resolve()));
}
