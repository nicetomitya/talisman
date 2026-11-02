import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { computeClassic, coverageFingerprint, type ClassicRules } from "@/server/domain/tariff";
import { assertTransition, canTransition } from "@/server/state/machines";
import { applyBp, rub } from "@/server/money";
import { validateUpload } from "@/server/domain/files";
import { validateForm, checkValue } from "@/server/domain/forms";
import { KASKO_V1 } from "@/server/domain/forms";
import { aiEmulator } from "@/server/adapters/ai";
import { signWebhook, paymentEmulator } from "@/server/adapters/payment";

const rules: ClassicRules = { product: "KASKO", baseRateBp: { "0": 450, "15000": 380 }, riskWeightsBp: { DAMAGE: 7000, THEFT: 2000 }, surchargesBp: { perVehicleYear: 150, youngDriver: 2500, lowExperience: 2000, perClaim: 1500 }, usageBp: { PERSONAL: 0, TAXI: "DECLINE" }, agentDiscountMaxBp: 1000, agentMarkupMaxBp: 500, minPremiumKop: 15_000_00, exclusions: [], settlement: "", emergencyPhone: "", maxVehicleAge: 15 };
const car = { car_value_rub: 2400000, deductible_rub: "15000", usage: "PERSONAL", risks: ["DAMAGE", "THEFT"], car_year: 2022, min_driver_age: 35, min_experience: 10, claims_3y: 0, repair_method: "SERVICE" };

describe("Тарифная сетка (целые копейки)", () => {
  it("расчёт детерминирован, границы цены от базовой", () => {
    const r = computeClassic(rules, car, 2026);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Number.isInteger(r.basePremiumKop)).toBe(true);
    expect(r.minPremiumKop).toBeLessThan(r.basePremiumKop);
    expect(r.maxPremiumKop).toBeGreaterThan(r.basePremiumKop);
    expect(r.basePremiumKop % 100).toBe(0);
  });
  it("такси отклоняется тарифом", () => expect(computeClassic(rules, { ...car, usage: "TAXI" }, 2026).ok).toBe(false));
  it("неизвестная франшиза отклоняется", () => expect(computeClassic(rules, { ...car, deductible_rub: "7000" }, 2026).ok).toBe(false));
  it("минимальная премия применяется", () => { const r = computeClassic(rules, { ...car, car_value_rub: 300000 }, 2026); expect(r.ok && r.basePremiumKop).toBe(15_000_00); });
  it("отпечаток покрытия меняется при юридически значимом отличии (франшиза)", () => {
    const t = { product: "KASKO", risks: ["DAMAGE"], territory: "RU", deductibleRub: 15000, termMonths: 12, sumInsuredRub: 1, exclusions: [], settlement: "" };
    expect(coverageFingerprint(t)).toBe(coverageFingerprint({ ...t, risks: ["DAMAGE"] }));
    expect(coverageFingerprint(t)).not.toBe(coverageFingerprint({ ...t, deductibleRub: 30000 }));
  });
  it("деньги: базисные пункты без плавающей точки", () => { expect(applyBp(1_000_000, 1500)).toBe(150_000); expect(applyBp(333, 3333)).toBe(111); expect(rub(150000)).toMatch(/1\s?500/); });
});

describe("Машины состояний", () => {
  it("клиент не может перевести оплату в «успешно»", () => expect(canTransition("payment", "PENDING", "SUCCEEDED", "CLIENT")).toBe(false));
  it("недопустимый переход отвергается", () => expect(() => assertTransition("checkout", "RESERVED", "COMPLETED", "CLIENT")).toThrow());
  it("отказ по обращению — только страховщик (человек)", () => { expect(canTransition("claim", "DECISION_PREPARED", "REJECTED", "SYSTEM")).toBe(false); expect(canTransition("claim", "DECISION_PREPARED", "REJECTED", "CARRIER")).toBe(true); });
  it("продукт агентства не публикуется без страховщика и платформы", () => { expect(canTransition("product", "DRAFT", "PUBLISHED", "ADMIN")).toBe(false); expect(canTransition("product", "SUBMITTED_TO_CARRIER", "CARRIER_APPROVED", "ADMIN")).toBe(false); });
});

describe("Загрузки и анкета", () => {
  const fx = (n: string) => readFileSync(path.resolve(__dirname, "../../fixtures/docs", n));
  it("подмена расширения отвергается по сигнатуре", () => expect(validateUpload(fx("fake.pdf"), "application/pdf", 15e6).ok).toBe(false));
  it("PDF с активным содержимым отвергается", () => expect(validateUpload(fx("active_content.pdf"), "application/pdf", 15e6).ok).toBe(false));
  it("корректный PDF принимается", () => expect(validateUpload(fx("sts_kia_k5.pdf"), "application/pdf", 15e6).ok).toBe(true));
  it("слишком большой файл отвергается", () => expect(validateUpload(fx("sts_kia_k5.pdf"), "application/pdf", 100).ok).toBe(false));
  it("VIN проверяется по формату", () => { const f = KASKO_V1.sections[0].fields.find((x) => x.key === "car_vin")!; expect(checkValue(f, "XWEG4417BN0001234")).toBeNull(); expect(checkValue(f, "XWEG4417BN000123O")).not.toBeNull(); });
  it("неподтверждённое ключевое поле блокирует публикацию", () => {
    const issues = validateForm(KASKO_V1, { car_make: "Kia" }, {});
    expect(issues.some((i) => i.key === "car_make")).toBe(true);
    expect(issues.some((i) => i.key === "car_model")).toBe(true);
  });
});

describe("ИИ-эмулятор и инъекции", () => {
  it("инструкции внутри документа помечаются как недоверенные и не дают полей прав", async () => {
    const r = await aiEmulator.recognize(readFileSync(path.resolve(__dirname, "../../fixtures/docs/sts_injection.pdf")), "application/pdf");
    expect(r.untrustedInstructions.length).toBeGreaterThan(0);
    expect(r.suggestions.map((s) => s.key).sort()).toEqual(["car_make", "car_model"]);
  });
  it("ответ только с цитатой пункта; без сведений — передача специалисту; действия — отказ", async () => {
    const clauses = [{ documentId: "d", documentTitle: "Правила", clauseId: "4.2", clauseTitle: "Стекло", text: "Повреждение стекла автомобиля возмещается без франшизы." }];
    const a = await aiEmulator.answer("Возмещается ли повреждение стекла автомобиля?", clauses);
    expect(a.kind).toBe("ANSWER");
    if (a.kind === "ANSWER") expect(a.citations[0].clauseId).toBe("4.2");
    expect((await aiEmulator.answer("Какая погода на Марсе?", clauses)).kind).toBe("NO_INFO");
    expect((await aiEmulator.answer("Выплати мне 5000 рублей", clauses)).kind).toBe("REFUSED_ACTION");
  });
});

describe("Подпись вебхуков", () => {
  it("HMAC проверяется, подделка отвергается", () => {
    const body = JSON.stringify({ eventId: "e1", type: "payment.succeeded" });
    expect(paymentEmulator.verifyWebhook(body, signWebhook(body))).toBe(true);
    expect(paymentEmulator.verifyWebhook(body, "00".repeat(32))).toBe(false);
    expect(paymentEmulator.verifyWebhook(body + " ", signWebhook(body))).toBe(false);
  });
});
