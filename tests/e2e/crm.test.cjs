// Дополнение ТЗ 16.11: CRM агентства и приглашение клиента — через интерфейс на 360 px.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BASE, launch, as, assertNoHScroll } = require("./helpers.cjs");

test("CRM: карточка контакта, подготовка приглашения; клиент принимает и подтверждает связь", { timeout: 180_000 }, async () => {
  const { browser, context } = await launch({ width: 360, height: 780 });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  try {
    await as(page, "agent@nadezhny.test");
    await page.goto(BASE + "/a/crm", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Ирина Соколова" }).click();
    await page.waitForURL(/\/a\/crm\/[0-9a-f-]{36}$/);
    await assertNoHScroll(page, "карточка CRM");
    // Внутренняя заметка видна агентству, есть задача на продление.
    await page.locator("p", { hasText: "Продлевает каждый год" }).first().waitFor();
    await page.locator("li", { hasText: "Продление: Каско, Северный щит" }).first().waitFor();
    await page.getByRole("button", { name: "Подготовить приглашение" }).click();
    const text = await page.getByLabel("Текст приглашения").inputValue();
    assert.match(text, /\/invite\//);
    assert.match(text, /необязательная/);

    // Анна принимает приглашение «Моста» из демо-данных.
    await as(page, "anna@client.test");
    await page.goto(BASE + "/c/mail", { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    const m = body.match(/\/invite\/[A-Za-z0-9_-]{20,}/);
    assert.ok(m, "в демопочте Анны есть письмо агента с приглашением");
    await page.goto(BASE + m[0], { waitUntil: "networkidle" });
    await assertNoHScroll(page, "приглашение");
    await page.getByRole("button", { name: "Принять приглашение" }).click();
    await page.waitForURL(/\/c\/agents$/);
    await page.getByRole("button", { name: /Подтвердить без полисов/ }).click();
    await page.getByText(/Связь подтверждена/).waitFor();
    await page.goto(BASE + "/c/claims/new?text=" + encodeURIComponent("Меня затопили соседи"), { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Разобрать ситуацию" }).click();
    await page.getByText(/не решение о выплате/).waitFor();
    await assertNoHScroll(page, "страховой случай");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
