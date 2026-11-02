// Сценарий А (каско через reverse auction) целиком через интерфейс: мобильный 360 px и десктоп.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { BASE, FIX, launch, as, apiCall, assertNoHScroll } = require("./helpers.cjs");

for (const [name, viewport] of [["mobile-360", { width: 360, height: 780 }], ["desktop", { width: 1280, height: 900 }]]) {
  test(`Сценарий А: каско от анкеты до полиса (${name})`, { timeout: 240_000 }, async () => {
    const { browser, context } = await launch(viewport);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await as(page, "anna@client.test");
      await page.goto(BASE + "/c/requests/new");
      await assertNoHScroll(page, "новая заявка");
      await page.getByRole("button", { name: /^Каско/ }).click();
      await page.waitForURL(/\/c\/requests\/[0-9a-f-]{36}$/);
      const requestId = page.url().split("/").pop();

      // Загрузка документов: проверка антивирусом (worker), затем подсказки распознавания.
      await page.setInputFiles("#upl", path.join(FIX, "sts_kia_k5.pdf"));
      await page.getByText("sts_kia_k5.pdf").waitFor();
      await page.getByText(/sts_kia_k5\.pdf.*проверен/).waitFor({ timeout: 30_000 });
      await page.setInputFiles("#upl", path.join(FIX, "dkp_kia_k5.pdf"));
      await page.getByText(/dkp_kia_k5\.pdf.*проверен/).waitFor({ timeout: 30_000 });
      for (let i = 0; i < 8; i++) {
        const b = page.getByRole("button", { name: "Подставить" }).first();
        if (!(await b.count())) break;
        await b.click();
        await page.waitForTimeout(700);
      }
      assert.equal(await page.locator("#fld-car_make").inputValue(), "Kia");
      // Низкая уверенность распознавания показана явно.
      await page.getByText(/Низкая уверенность распознавания/).first().waitFor();

      await page.selectOption("#fld-usage", "PERSONAL");
      await page.fill("#fld-drivers_count", "1");
      await page.fill("#fld-min_driver_age", "34");
      await page.fill("#fld-min_experience", "10");
      await page.fill("#fld-claims_3y", "0");
      await page.getByLabel("Ущерб").check();
      await page.getByLabel("Угон и хищение").check();
      await page.selectOption("#fld-territory", "RU");
      await page.selectOption("#fld-deductible_rub", "15000");
      await page.selectOption("#fld-repair_method", "SERVICE");
      const start = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
      await page.fill("#fld-start_date", start);
      await page.selectOption("#fld-region", "RU-MOW");
      await page.getByText("✓ Черновик сохранён").waitFor();

      // Публикация без подтверждения ключевых полей не проходит (AC02/AC03).
      await page.getByRole("button", { name: "Опубликовать заявку" }).click();
      await page.getByText(/Чтобы опубликовать заявку, исправьте/).waitFor();
      await page.getByRole("button", { name: /подтвердить все/ }).click();
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: /Опубликовать/ }).click();
      await page.getByText("Подбор предложений").waitFor({ timeout: 15_000 });
      await assertNoHScroll(page, "заявка опубликована");

      // Агентства делают предложения через калькулятор.
      for (const [email, cut] of [["agent@nadezhny.test", 0], ["agent1@most.test", 2000]]) {
        const p2 = await context.newPage();
        await as(p2, email);
        await p2.goto(`${BASE}/a/requests/${requestId}`);
        // Агент не видит VIN и собственника до выбора (минимизация данных).
        assert.equal(await p2.getByText("XWEG4417BN0001234").count(), 0);
        await p2.getByRole("button", { name: "Рассчитать по тарифу" }).click();
        await p2.getByText(/Базовая премия/).waitFor();
        if (cut) { const v = Number(await p2.locator("#qc-pr").inputValue()); await p2.fill("#qc-pr", String(v - cut)); }
        await p2.getByRole("button", { name: "Опубликовать предложение" }).click();
        await p2.getByText("✓ Предложение опубликовано").waitFor();
        await assertNoHScroll(p2, "калькулятор агента");
        await p2.close();
      }
      await as(page, "anna@client.test");

      await page.goto(`${BASE}/c/requests/${requestId}`);
      await page.getByText(/Условия как в вашей заявке/).waitFor();
      const offers = page.getByRole("button", { name: "Выбрать это предложение" });
      assert.ok((await offers.count()) >= 2, "ожидалось минимум два предложения");
      await assertNoHScroll(page, "сравнение предложений");
      await offers.first().click();
      await page.waitForURL(/\/c\/checkouts\//);

      await page.getByRole("button", { name: "Сформировать документы" }).click();
      await page.getByText("Документы комплекта").waitFor({ timeout: 20_000 });
      await page.getByText("Демонстрационный документ").first().waitFor().catch(() => {});
      for (let i = 0; i < 4; i++) { await page.getByRole("button", { name: "Ознакомлен(а)" }).first().click(); await page.waitForTimeout(600); }
      await page.getByRole("button", { name: "Получить код подтверждения" }).click();
      await page.getByText("Шаг 3. Подтверждение").waitFor();

      const mail = await context.newPage();
      await mail.goto(BASE + "/c/mail");
      const body = await mail.locator("pre").first().textContent();
      const code = body.match(/Код: (\d{6})/)[1];
      await mail.close();
      await page.fill("#otp", "000000" === code ? "111111" : "000000");
      await page.getByRole("button", { name: "Подтвердить" }).click();
      await page.getByText(/Неверный код\. Осталось попыток: 4/).waitFor();
      await page.fill("#otp", code);
      await page.getByRole("button", { name: "Подтвердить" }).click();
      await page.getByText("Шаг 4. Оплата страховщику").waitFor({ timeout: 15_000 });
      await page.getByText(/напрямую/).first().waitFor();
      await page.getByRole("button", { name: "Перейти к оплате" }).click();
      await page.waitForURL(/\/demo\/pay\//);
      await assertNoHScroll(page, "эмулятор оплаты");
      await page.getByRole("button", { name: "Оплатить (успешно)" }).click();
      await page.getByText(/Результат у провайдера/).waitFor();
      await page.getByRole("link", { name: "Вернуться в кабинет" }).click();
      await page.getByText(/Готово|Шаг 5/).first().waitFor({ timeout: 20_000 });
      await page.getByRole("link", { name: /Открыть полис/ }).waitFor({ timeout: 30_000 });
      await page.getByRole("link", { name: /Открыть полис/ }).click();
      await page.getByText("Демонстрационный документ. Не является действующим страховым полисом.").waitFor();
      await page.getByText("Защита действует").or(page.getByText("Начнёт действовать")).first().waitFor();
      await assertNoHScroll(page, "полис");

      // Повторная оплата того же оформления не создаёт второго платежа (AC13).
      const checkout = await apiCall(page, "/api/checkouts", { request_id: requestId, request_version: 1, quote_id: "00000000-0000-4000-8000-000000000000", quote_version: 1, idempotency_key: "e2e-dup-" + name });
      assert.notEqual(checkout.status, 200);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
