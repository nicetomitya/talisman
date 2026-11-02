import type { Product, ProductVersion } from "@prisma/client";
import { type Tx } from "../db";
import { buildWindow, distanceKm, type EventTerms } from "./eventcalc";
import type { FieldIssue } from "./forms";
import { DEMO_RULES } from "../config";
import { activeTariff } from "./catalog";
import { coverageFingerprint } from "./tariff";
import { err } from "../errors";

type P = Product & { versions: ProductVersion[] };

export function eventWindowFromData(terms: EventTerms, data: Record<string, any>) {
  return buildWindow(data.event_date, data.start_time, data.end_time, data.timezone ?? "Europe/Moscow", terms.intervalMinutes, data.dst_choice);
}

/**
 * Проверки права на событийное покрытие до продажи: срок покупки, покрытие координат источником,
 * повторное покрытие бронирования внутри платформы, совокупный лимит клиента, концентрация по ячейке и дате.
 */
export async function eventEligibility(tx: Tx, clientId: string, product: P, data: Record<string, any>, t: Date): Promise<FieldIssue[]> {
  const issues: FieldIssue[] = [];
  const terms = (product.versions[0].terms as any).event as EventTerms;
  let w;
  try { w = eventWindowFromData(terms, data); } catch (e: any) { return [{ key: "start_time", message: e.message }]; }
  if (data.purchase_date > t.toISOString().slice(0, 10)) issues.push({ key: "purchase_date", message: "Дата покупки не может быть в будущем" });
  const minStart = t.getTime() + DEMO_RULES.eventMinDaysBeforeStart * 86400_000;
  if (w.startUtc.getTime() < minStart) issues.push({ key: "event_date", message: `Оформление возможно не позднее чем за ${DEMO_RULES.eventMinDaysBeforeStart} суток до начала события` });
  if (w.intervals.length !== (terms.metric === "PRECIP_MM" ? 6 : 4)) issues.push({ key: "end_time", message: `Продукт рассчитан на окно из ${terms.metric === "PRECIP_MM" ? 6 : 4} часовых интервалов` });
  const d = distanceKm(Number(data.latitude), Number(data.longitude), terms.primary.lat, terms.primary.lon);
  if (d > terms.maxDistanceKm) issues.push({ key: "latitude", message: `Точка в ${d.toFixed(1)} км от станции ${terms.primary.source} (допустимо ${terms.maxDistanceKm} км): данные не позволяют надёжно покрыть координаты, автоматическая продажа невозможна` });
  const dup = await tx.policy.findFirst({ where: { productCode: product.code, bookingRef: String(data.booking_ref), contractStatus: { in: ["PREPARED", "CONCLUDED"] } } });
  if (dup) issues.push({ key: "booking_ref", message: "Это бронирование уже покрыто на платформе — повторное покрытие недоступно" });
  const active = await tx.policy.findMany({ where: { clientId, productCode: { in: ["RAIN01", "WIND01"] }, contractStatus: { in: ["PREPARED", "CONCLUDED"] }, endsAt: { gt: t } }, include: { coverages: true } });
  const exposure = active.reduce((s, p) => s + p.coverages.reduce((a, c) => a + c.limitKop - c.paidKop, 0), 0);
  if (exposure + terms.payoutKop > DEMO_RULES.clientMaxActiveEventPayoutKop) issues.push({ key: "booking_cost_rub", message: "Превышен совокупный лимит событийной защиты клиента" });
  const latE6 = Math.round(Number(data.latitude) * 10) * 100000, lonE6 = Math.round(Number(data.longitude) * 10) * 100000;
  const dayStart = new Date(w.startUtc.toISOString().slice(0, 10) + "T00:00:00Z"), dayEnd = new Date(dayStart.getTime() + 86400_000);
  const conc = await tx.policy.count({ where: { productCode: product.code, contractStatus: { in: ["PREPARED", "CONCLUDED"] }, startsAt: { gte: dayStart, lt: dayEnd }, latitudeE6: { gte: latE6 - 50000, lt: latE6 + 50000 }, longitudeE6: { gte: lonE6 - 50000, lt: lonE6 + 50000 } } });
  if (conc >= DEMO_RULES.concentrationMaxPerCellDay) issues.push({ key: "event_date", message: "Достигнут лимит концентрации риска по этой территории и дате" });
  if (Number(data.booking_cost_rub) * 100 < terms.payoutKop / 2) issues.push({ key: "booking_cost_rub", message: "Фиксированная выплата не может существенно превышать оплаченные расходы (демо-правило: стоимость ≥ 50 % выплаты)" });
  return issues;
}

/** Мгновенная котировка по заранее одобренному тарифу (без торгов). */
export async function createInstantQuote(tx: Tx, requestId: string, requestVersion: number, product: P, data: Record<string, any>, t: Date) {
  const v = product.versions[0];
  const terms = (v.terms as any).event as EventTerms;
  const { tariff, stale, reason } = await activeTariff(tx, product.id, product.carrierOrgId, t);
  if (!tariff || stale) throw err("SOURCE_UNAVAILABLE", `Котировка недоступна: ${reason}`);
  const rules = tariff.rules as any;
  if (!product.distributorOrgId) throw err("CONFLICT", "У продукта нет агентства-распространителя с полномочиями");
  const mandate = await tx.mandate.findFirst({ where: { agencyOrgId: product.distributorOrgId, productId: product.id, status: "ACTIVE", validFrom: { lte: t }, validTo: { gte: t } } });
  if (!mandate) throw err("FORBIDDEN", "Нет действующих полномочий агентства-распространителя");
  const w = eventWindowFromData(terms, data);
  const coverage = {
    product: product.code, risks: [terms.metric], territory: "RU-SPE", deductibleRub: 0, termMonths: 0, sumInsuredRub: terms.payoutKop / 100,
    exclusions: (v.terms as any).exclusions ?? [], settlement: "Автоматический расчёт по данным источника после финализации",
    event: { metric: terms.metric, thresholdX100: terms.thresholdX100, aggregation: terms.aggregation, minIntervals: terms.minIntervals ?? null, primary: terms.primary.source, backup: terms.backup?.source ?? null, startUtc: w.startUtc.toISOString(), endUtc: w.endUtc.toISOString(), timezone: w.timezone, payoutKop: terms.payoutKop, ruleVersion: terms.ruleVersion },
  };
  const expiresAt = new Date(Math.min(t.getTime() + DEMO_RULES.quoteValidityHours * 3600_000, w.startUtc.getTime() - DEMO_RULES.eventMinDaysBeforeStart * 86400_000));
  return tx.quote.create({
    data: { requestId, requestVersion, agencyOrgId: product.distributorOrgId, carrierOrgId: product.carrierOrgId, productId: product.id, status: "PUBLISHED", coverageFingerprint: coverageFingerprint(coverage as any), terms: coverage as any,
      premiumKop: rules.premiumKop, totalKop: rules.premiumKop, sourceType: "EVENT_TARIFF", tariffVersionId: tariff.id, commissionPct: rules.commissionBp ?? 1500, expiresAt, createdVia: "INSTANT", publishedAt: t },
  });
}
