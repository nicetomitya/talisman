// Общие помощники e2e: Playwright (предустановленный chromium), демо-вход, ожидания.
const path = require("node:path");
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const FIX = path.resolve(__dirname, "../../fixtures/docs");

async function launch(viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, locale: "ru-RU" });
  await context.addCookies([{ name: "tcookie", value: "necessary", url: BASE }]);
  return { browser, context };
}
async function as(page, email) {
  await page.goto(BASE + "/login");
  const r = await page.evaluate(async (email) => {
    const t = decodeURIComponent((document.cookie.match(/tcsrf=([^;]+)/) || [])[1] || "");
    const res = await fetch("/api/auth/demo-switch", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": t }, body: JSON.stringify({ email }) });
    return res.status;
  }, email);
  if (r !== 200) throw new Error("demo-switch failed " + r);
}
async function apiCall(page, url, body, method = "POST") {
  return page.evaluate(async ({ url, body, method }) => {
    const t = decodeURIComponent((document.cookie.match(/tcsrf=([^;]+)/) || [])[1] || "");
    const res = await fetch(url, { method, headers: { "content-type": "application/json", "x-csrf-token": t }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  }, { url, body, method });
}
/** Нет горизонтальной прокрутки (AC31/мобильная проверка 360 px). */
async function assertNoHScroll(page, label) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (w.sw > w.cw + 1) throw new Error(`Горизонтальная прокрутка на ${label}: ${w.sw} > ${w.cw}`);
}
module.exports = { BASE, FIX, launch, as, apiCall, assertNoHScroll };
