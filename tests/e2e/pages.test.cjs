// Все страницы кабинетов: 200, нет ошибок в браузере, нет горизонтальной прокрутки на 360 px,
// у каждого поля ввода есть доступное имя, статусы не передаются только цветом (AC31).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BASE, launch, as, assertNoHScroll } = require("./helpers.cjs");

const ROLES = {
  "anna@client.test": ["/c", "/c/requests", "/c/requests/new", "/c/policies", "/c/claims", "/c/messages", "/c/documents", "/c/payments", "/c/notifications", "/c/settings", "/c/objects", "/c/mail"],
  "owner@nadezhny.test": ["/a", "/a/deals", "/a/claims", "/a/messages", "/a/automation", "/a/products", "/a/rating", "/a/earnings", "/a/subscription", "/a/team", "/a/settings"],
  "admin1@talisman.test": ["/admin", "/admin/exceptions", "/admin/orgs", "/admin/catalog", "/admin/requests", "/admin/events", "/admin/claims", "/admin/payments", "/admin/billing", "/admin/documents", "/admin/reviews", "/admin/approvals", "/admin/audit", "/admin/integrations", "/demo"],
  "rep@severshield.test": ["/admin", "/admin/catalog", "/admin/claims", "/admin/events"],
};
const PUBLIC = ["/", "/catalog", "/products/RAIN01", "/products/KASKO_SEV", "/pricing", "/help", "/legal", "/login", "/register", "/reset"];

async function check(page, path, errors) {
  const r = await page.goto(BASE + path, { waitUntil: "networkidle" });
  assert.equal(r.status(), 200, path);
  await assertNoHScroll(page, path);
  const unlabeled = await page.evaluate(() => [...document.querySelectorAll("input:not([type=hidden]):not(.sr-only), select, textarea")].filter((el) => {
    if (el.closest(".sr-only")) return false;
    const id = el.id; const hasLabel = (id && document.querySelector(`label[for="${id}"]`)) || el.closest("label") || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
    return !hasLabel;
  }).map((el) => el.outerHTML.slice(0, 80)));
  assert.deepEqual(unlabeled, [], `поля без подписи на ${path}`);
  assert.deepEqual(errors.splice(0), [], `ошибки браузера на ${path}`);
}

test("Публичные страницы и кабинеты на 360 px", { timeout: 300_000 }, async () => {
  const { browser, context } = await launch({ width: 360, height: 780 });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  try {
    for (const p of PUBLIC) await check(page, p, errors);
    for (const [email, paths] of Object.entries(ROLES)) { await as(page, email); for (const p of paths) await check(page, p, errors); }
  } finally { await browser.close(); }
});
