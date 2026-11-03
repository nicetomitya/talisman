import { describe, it, expect } from "vitest";
import { maskContacts } from "@/server/domain/contacts";
import { reviewData } from "@/server/domain/assistant";

describe("Маскировка контактов в чате", () => {
  it("скрывает телефоны, почту, ссылки и ники", () => {
    for (const t of ["позвоните +7 (921) 555-12-34", "пишите 8 921 5551234", "mail: ivan@agency.test", "мой tg @ivan_agent", "t.me/ivanagent", "https://wa.me/79215551234", "сайт agency-best.ru"]) {
      const r = maskContacts(t); expect(r.masked, t).toBe(true); expect(r.text).toContain("[контакт скрыт]");
    }
  });
  it("не трогает суммы, даты и номера полисов", () => {
    for (const t of ["премия 48 300 ₽, франшиза 15000", "начало 15.11.2026", "полис DEMO-KASKO-000123", "VIN XWEG4417BN0001234"]) expect(maskContacts(t)).toMatchObject({ masked: false, text: t });
  });
});

describe("Помощник: проверка заявки", () => {
  const today = new Date("2026-11-03T10:00:00Z");
  const ok = { car_make: "Kia", car_model: "K5", car_year: 2022, car_value_rub: 2400000, car_vin: "XWEG4417BN0001234", usage: "PERSONAL", owner_name: "Анна", drivers_count: 1, min_driver_age: 35, min_experience: 12, claims_3y: 0, risks: ["DAMAGE", "THEFT"], territory: "RU", deductible_rub: "15000", allow_alt_deductible: true, repair_method: "SERVICE", start_date: "2026-11-10", region: "RU-SPE" };
  const conf = Object.fromEntries(Object.keys(ok).map((k) => [k, { status: "CONFIRMED" }]));
  it("полная и правдоподобная заявка — без блокирующих замечаний", () => {
    expect(reviewData("KASKO", ok, conf, today).filter((h) => h.level === "BLOCK")).toHaveLength(0);
  });
  it("находит пробелы, дату в прошлом и несходящийся стаж", () => {
    const h = reviewData("KASKO", { ...ok, car_vin: "", start_date: "2026-10-01", min_driver_age: 20, min_experience: 10 }, conf, today);
    expect(h.find((x) => x.key === "car_vin")?.level).toBe("BLOCK");
    expect(h.find((x) => x.key === "start_date")?.level).toBe("BLOCK");
    expect(h.find((x) => x.key === "min_experience")?.level).toBe("CHECK");
    expect(h[0].level).toBe("BLOCK");
  });
  it("подсказывает про угон для дорогого автомобиля", () => {
    expect(reviewData("KASKO", { ...ok, risks: ["DAMAGE"] }, conf, today).some((x) => x.key === "risks" && x.level === "TIP")).toBe(true);
  });
});
