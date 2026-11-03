/**
 * ИИ-помощник подбора (P0 — детерминированный эмулятор, см. U09/D11).
 * Только подсказывает: не меняет данные заявки, тариф и цену, не подаёт предложения.
 * Клиенту — проверка полноты и правдоподобия перед публикацией; агентству — разбор заявки и коридор цены по тарифу.
 */
import { db } from "../db";
import { now } from "../clock";
import { type Ctx } from "../access";
import { schemaFor } from "./catalog";
import { allFields, validateForm } from "./forms";
import { getOwnRequest, requestForAgency } from "./requests";
import { calculator } from "./auction";

export type Hint = { level: "BLOCK" | "CHECK" | "TIP"; key?: string; label?: string; text: string };

const DAY = 86400000;

/** Чистая функция: подсказки по данным заявки. */
export function reviewData(productCode: string, data: Record<string, any>, confirmed: Record<string, any>, today: Date): Hint[] {
  const schema = schemaFor(productCode);
  const fields = allFields(schema);
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  const hints: Hint[] = validateForm(schema, data, confirmed).map((i) => ({ level: "BLOCK" as const, key: i.key, label: label(i.key), text: i.message }));
  const has = (k: string) => data[k] !== undefined && data[k] !== null && data[k] !== "";
  const n = (k: string) => Number(data[k]);
  const add = (level: Hint["level"], key: string, text: string) => { if (!hints.some((h) => h.key === key && h.level === "BLOCK")) hints.push({ level, key, label: label(key), text }); };

  if (has("start_date")) {
    const d = new Date(String(data.start_date) + "T00:00:00Z").getTime();
    const t0 = new Date(today.toISOString().slice(0, 10) + "T00:00:00Z").getTime();
    if (d < t0) add("BLOCK", "start_date", "Дата начала в прошлом: агентства не смогут оформить договор задним числом");
    else if (d > t0 + 60 * DAY) add("CHECK", "start_date", "Дата начала больше чем через 2 месяца: предложения действуют ограниченное время и могут устареть");
  }
  if (productCode === "KASKO") {
    if (has("min_driver_age") && has("min_experience") && n("min_driver_age") - n("min_experience") < 16) add("CHECK", "min_experience", "Стаж не сходится с возрастом: водительские права выдаются с 16–18 лет");
    if (has("car_year") && has("car_value_rub")) {
      const age = today.getUTCFullYear() - n("car_year");
      if (age >= 15 && n("car_value_rub") > 3_000_000) add("CHECK", "car_value_rub", "Стоимость высокая для автомобиля такого возраста: проверьте, страховщик сверит её с рынком");
      if (age >= 12) add("TIP", "car_year", "Для автомобилей старше 12 лет часть тарифов недоступна: предложений может быть меньше");
    }
    const risks: string[] = Array.isArray(data.risks) ? data.risks : [];
    if (risks.length && !risks.includes("THEFT") && n("car_value_rub") >= 2_000_000) add("TIP", "risks", "Угон и хищение не выбраны: для дорогого автомобиля это обычно основной риск");
    if (has("deductible_rub") && !data.allow_alt_deductible) add("TIP", "allow_alt_deductible", "Если готовы рассмотреть другую франшизу, агентства смогут предложить альтернативу; она покажется отдельно от сопоставимых предложений");
    if (data.usage === "TAXI" || data.usage === "RENTAL") add("CHECK", "usage", "Коммерческое использование: часть страховщиков такие автомобили не принимает, проверьте, что указано верно");
  }
  if (productCode === "PROPERTY") {
    if (data.usage === "RENT_OUT") add("CHECK", "usage", "Сдача в аренду указана: это влияет на условия, оставьте как есть, если это так");
    if (has("year_built") && n("year_built") < 1960) add("TIP", "year_built", "Для старых домов страховщик может запросить осмотр");
  }
  for (const [k, c] of Object.entries(confirmed ?? {})) if ((c as any)?.status === "NEEDS_RECHECK") add("CHECK", k, "Значение перенесено из прошлой заявки: проверьте, что оно актуально");
  const order = { BLOCK: 0, CHECK: 1, TIP: 2 } as const;
  return hints.sort((a, b) => order[a.level] - order[b.level]);
}

export async function reviewRequest(ctx: Ctx, requestId: string) {
  const r = await getOwnRequest(db, ctx, requestId);
  const hints = reviewData(r.productCode, r.data as any, r.confirmed as any, await now());
  return { ready: !hints.some((h) => h.level === "BLOCK"), hints, note: "Проверка помощника (демо). Решение о данных заявки принимаете вы." };
}

/** Разбор заявки для агентства: только по данным, доступным этому агентству (requestForAgency), коридор — из тарифа по полномочиям. */
export async function analyzeForAgency(ctx: Ctx & { orgId: string }, requestId: string) {
  const v = await requestForAgency(ctx, requestId);
  const d = v.data as Record<string, any>;
  const t = await now();
  const covered: string[] = []; const attention: string[] = [];
  if (v.request.productCode === "KASKO") {
    covered.push(`${d.car_make ?? ""} ${d.car_model ?? ""} ${d.car_year ?? ""}`.trim(), `страховая сумма ${Number(d.car_value_rub ?? 0).toLocaleString("ru-RU")} ₽`);
    if (Number(d.min_driver_age) < 25) attention.push("Молодой водитель: надбавка по тарифу");
    if (Number(d.min_experience) < 3) attention.push("Стаж меньше 3 лет: надбавка по тарифу");
    if (Number(d.claims_3y) > 0) attention.push(`Страховых случаев за 3 года: ${d.claims_3y}`);
    if (d.usage && d.usage !== "PERSONAL") attention.push("Коммерческое использование: проверьте, принимает ли тариф");
    if (t.getUTCFullYear() - Number(d.car_year) >= 12) attention.push("Возраст автомобиля 12 лет и больше");
    if (d.allow_alt_deductible) covered.push("клиент готов рассмотреть другую франшизу");
  } else if (v.request.productCode === "PROPERTY") {
    covered.push(`${d.city ?? ""}, ${d.area_m2 ?? "?"} м²`);
    if (d.usage && d.usage !== "OWN") attention.push("Объект сдаётся или используется коммерчески");
    if (Number(d.year_built) < 1960) attention.push("Дом старше 1960 года");
  }
  const products: { productId: string; title: string; ok: boolean; minKop?: number; baseKop?: number; maxKop?: number; inspection?: boolean; reason?: string }[] = [];
  if (v.request.kind === "CLASSIC" && v.eligible && ["OPEN", "SELECTION"].includes(v.request.status)) {
    const mandates = await db.mandate.findMany({ where: { agencyOrgId: ctx.orgId, status: "ACTIVE", validFrom: { lte: t }, validTo: { gte: t } } });
    const prods = await db.product.findMany({ where: { id: { in: mandates.map((m) => m.productId) } } });
    for (const m of mandates) {
      const product = prods.find((p) => p.id === m.productId); if (!product) continue;
      try {
        const c = await calculator(ctx, requestId, m.productId);
        if (c.ok) products.push({ productId: m.productId, title: product.title, ok: true, minKop: c.minPremiumKop, baseKop: c.basePremiumKop, maxKop: c.maxPremiumKop, inspection: c.inspectionRequired });
        else products.push({ productId: m.productId, title: product.title, ok: false, reason: c.reason });
      } catch { /* продукт не той линии — пропускаем */ }
    }
    if (products.some((p) => p.inspection)) attention.push("Потребуется осмотр автомобиля");
  }
  return { covered: covered.filter(Boolean), attention, products, note: "Разбор помощника (демо). Подавать ли предложение и по какой цене, решает агентство; условия после подачи не меняются." };
}
