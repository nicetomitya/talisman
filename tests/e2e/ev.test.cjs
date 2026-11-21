// ТЗ v2: US Event Risk — гость описывает риск, уточняет, подтверждает; клиент открывает бумажную позицию на 360 px.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BASE, launch, as, apiCall, assertNoHScroll } = require("./helpers.cjs");

test("Гость: регата в Ньюпорте → вопросы без выдуманной станции → уточнение → подтверждение → EXACT (SIMULATED)", { timeout: 180_000 }, async () => {
  const { browser, context } = await launch({ width: 360, height: 780 });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    assert.equal(await page.locator("html").getAttribute("lang"), "en-US");
    await page.getByRole("heading", { name: /Protect what matters/ }).waitFor();
    await page.getByText(/SIMULATION/).first().waitFor();
    await assertNoHScroll(page, "landing");
    await page.getByLabel(/What could go wrong/).fill("I'm sailing in Newport next August. If the wind is too weak during the regatta, I want to offset $1,500 of my trip expenses.");
    await page.getByRole("button", { name: "Build my event" }).click();
    await page.waitForURL(/\/risk\/[0-9a-f-]{36}$/);
    await page.getByText("Needs details").first().waitFor();
    await page.getByText(/We will not pick one for you/).waitFor();
    assert.match(await page.locator("main").innerText(), /Station\s+not chosen/);
    await assertNoHScroll(page, "risk draft");
    await page.getByLabel(/Newport State Airport/).check();
    await page.getByLabel(/First day/).fill("2027-08-10");
    await page.getByLabel("Last day").fill("2027-08-12");
    await page.getByLabel(/Threshold/).fill("8");
    await page.getByRole("button", { name: "Save details" }).click();
    await page.getByText("Ready for your review").first().waitFor();
    await page.getByText("2027-08-10T04:00:00.000Z", { exact: false }).waitFor();
    await page.getByLabel(/The summary above is what I mean/).check();
    await page.getByRole("button", { name: "Confirm event terms" }).click();
    await page.getByText("Confirmed by you").first().waitFor();
    await page.getByText("Exact match").first().waitFor();
    const main = await page.locator("main").innerText();
    assert.match(main, /SIMULATED/);
    assert.match(main, /No verified real market is connected/);
    assert.doesNotMatch(main, /buy now/i);
    await page.getByRole("link", { name: "See cost and payout" }).first().click();
    await page.waitForURL(/\/markets\//);
    await page.getByText("Maximum loss").waitFor();
    // Мобильный: максимальная потеря и источник выше CTA (крит. 27).
    const yLoss = (await page.getByText("Maximum loss").boundingBox()).y;
    const ySrc = (await page.getByTestId("quote-source").boundingBox()).y;
    const yCta = (await page.getByRole("link", { name: /Sign in to open a paper position/ }).boundingBox()).y;
    assert.ok(yLoss < yCta && ySrc < yCta, "max loss and sources come before the CTA");
    await page.getByText(/not an insurance policy/).first().waitFor();
    await assertNoHScroll(page, "market");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("Клиент: бумажная позиция с подтверждением; частичное исполнение; портфель SIMULATED", { timeout: 180_000 }, async () => {
  const { browser, context } = await launch({ width: 360, height: 780 });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  try {
    await as(page, "olivia@consumer.test");
    const list = await apiCall(page, "/api/v2/markets", undefined, "GET");
    const rain = list.json.items.find((m) => m.venueMarketId === "SIM-RAIN-AUS-20270508-050IN");
    await page.goto(`${BASE}/markets/${rain.id}?payout=5000`, { waitUntil: "networkidle" });
    await page.getByText(/Only 60% of the size/).waitFor();
    const btn = page.getByRole("button", { name: "Open paper position" });
    await page.getByLabel(/I understand this is a/).check();
    assert.equal(await btn.isDisabled(), true, "partial fill needs explicit consent");
    await page.getByLabel(/Accept a partial fill/).check();
    await btn.click();
    await page.getByText(/Paper position opened/).waitFor();
    await page.goto(BASE + "/app/portfolio", { waitUntil: "networkidle" });
    await page.getByText(/SIMULATED · virtual USD/).waitFor();
    assert.match(await page.locator("main").innerText(), /3,000 units/);
    await assertNoHScroll(page, "portfolio");
    // Прямой запрос к несуществующему маршруту реального ордера (крит. 9, 10).
    const live = await apiCall(page, "/api/v2/orders", { marketId: rain.id, side: "YES", units: 10 });
    assert.equal(live.status, 404);
    const sneaky = await apiCall(page, "/api/v2/sim/orders", { marketId: rain.id, side: "YES", targetPayoutUsd: 10, quoteSnapshotId: rain.id, termsHash: rain.termsHash, confirm: true, idempotencyKey: "abcdefgh-1", mode: "LIVE" });
    assert.equal(sneaky.status, 422);
    for (const p of ["/app", "/app/expert", "/app/account", "/how-it-works"]) { await page.goto(BASE + p, { waitUntil: "networkidle" }); await assertNoHScroll(page, p); }
    await page.getByText("Not available").first().waitFor({ state: "attached" }).catch(() => {});
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("Комплаенс-консоль и конфликт интересов", { timeout: 180_000 }, async () => {
  const { browser, context } = await launch({ width: 1280, height: 900 });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  try {
    await as(page, "jordan@builder.test");
    const list = await apiCall(page, "/api/v2/markets", undefined, "GET");
    const c = list.json.items.find((m) => m.templateCode === "CONSTRUCTION_DELAY");
    await page.goto(`${BASE}/markets/${c.id}`, { waitUntil: "networkidle" });
    await page.getByText(/not available to you/).waitFor();
    await as(page, "admin1@talisman.test");
    await page.goto(BASE + "/ops", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Cluster risk" }).waitFor();
    assert.match(await page.locator("main").innerText(), /Shared object: austin-oak-ridge-lot-14/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
