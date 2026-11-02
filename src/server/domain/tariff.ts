import { createHash } from "node:crypto";
import { stableStringify } from "../idempotency";

/**
 * Демонстрационная тарифная сетка (версионируется в TariffVersion.rules). НЕ реальный тариф.
 * Все расчёты — целые копейки и базисные пункты (1 bp = 0.01%).
 */
export type ClassicRules = {
  product: "KASKO" | "PROPERTY";
  baseRateBp: Record<string, number>; // по франшизе (₽)
  riskWeightsBp: Record<string, number>;
  coverWeightsBp?: Record<string, number>;
  surchargesBp: Record<string, number>;
  usageBp: Record<string, number | "DECLINE">;
  repairBp?: Record<string, number>;
  constructionBp?: Record<string, number>;
  agentDiscountMaxBp: number;
  agentMarkupMaxBp: number;
  minPremiumKop: number;
  inspectionAboveRub?: number;
  maxVehicleAge?: number;
  exclusions: { code: string; title: string }[];
  settlement: string;
  emergencyPhone: string;
};
export type EventRules = { product: "RAIN01" | "WIND01"; premiumKop: number; payoutKop: number };

export type TariffResult =
  | { ok: true; basePremiumKop: number; minPremiumKop: number; maxPremiumKop: number; inspectionRequired: boolean; breakdown: { label: string; value: string }[] }
  | { ok: false; reason: string };

const roundRub = (kop: bigint) => Number(((kop + 50n) / 100n) * 100n);
const mulBp = (kop: bigint, bp: number) => (kop * BigInt(bp) + 5000n) / 10000n;

export function computeClassic(rules: ClassicRules, data: Record<string, any>, nowYear: number): TariffResult {
  const ded = String(data.deductible_rub ?? "0");
  const rate = rules.baseRateBp[ded];
  if (rate === undefined) return { ok: false, reason: `Франшиза ${ded} ₽ не предусмотрена тарифом` };
  const usage = rules.usageBp[data.usage];
  if (usage === "DECLINE") return { ok: false, reason: "Использование объекта не принимается на страхование по этому тарифу" };
  const valueRub = BigInt(Math.trunc(Number(rules.product === "KASKO" ? data.car_value_rub : data.value_rub)));
  const breakdown: { label: string; value: string }[] = [];
  let p = mulBp(valueRub * 100n, rate);
  breakdown.push({ label: "Базовая ставка", value: `${(rate / 100).toFixed(2)} % от страховой суммы` });

  const risks: string[] = data.risks ?? [];
  const riskBp = risks.reduce((s, r) => s + (rules.riskWeightsBp[r] ?? 0), 0);
  if (riskBp === 0) return { ok: false, reason: "Не выбраны риски, поддерживаемые тарифом" };
  p = mulBp(p, riskBp);
  breakdown.push({ label: "Состав рисков", value: `${(riskBp / 100).toFixed(0)} % базового покрытия` });

  if (rules.coverWeightsBp) {
    const cov: string[] = data.cover_objects ?? [];
    const covBp = cov.reduce((s, c) => s + (rules.coverWeightsBp![c] ?? 0), 0);
    if (covBp === 0) return { ok: false, reason: "Не выбраны объекты покрытия" };
    p = mulBp(p, Math.max(covBp, 2500) * 2);
  }

  let sur = Number(usage ?? 0);
  if (rules.product === "KASKO") {
    const age = Math.max(0, nowYear - Number(data.car_year));
    if (rules.maxVehicleAge !== undefined && age > rules.maxVehicleAge) return { ok: false, reason: `Возраст автомобиля больше ${rules.maxVehicleAge} лет` };
    sur += age * (rules.surchargesBp.perVehicleYear ?? 0);
    if (Number(data.min_driver_age) < 25) sur += rules.surchargesBp.youngDriver ?? 0;
    if (Number(data.min_experience) < 3) sur += rules.surchargesBp.lowExperience ?? 0;
    sur += Number(data.claims_3y ?? 0) * (rules.surchargesBp.perClaim ?? 0);
    sur += rules.repairBp?.[data.repair_method] ?? 0;
  } else {
    sur += rules.constructionBp?.[data.construction] ?? 0;
    if (Number(data.year_built) < 1960) sur += rules.surchargesBp.oldBuilding ?? 0;
  }
  p = mulBp(p, 10000 + sur);
  breakdown.push({ label: "Надбавки и скидки по характеристикам", value: `${sur >= 0 ? "+" : ""}${(sur / 100).toFixed(1)} %` });

  let base = roundRub(p);
  if (base < rules.minPremiumKop) { base = rules.minPremiumKop; breakdown.push({ label: "Минимальная премия", value: "применена" }); }
  const minP = roundRub(mulBp(BigInt(base), 10000 - rules.agentDiscountMaxBp));
  const maxP = roundRub(mulBp(BigInt(base), 10000 + rules.agentMarkupMaxBp));
  const inspectionRequired = rules.inspectionAboveRub !== undefined && Number(valueRub) > rules.inspectionAboveRub;
  return { ok: true, basePremiumKop: base, minPremiumKop: Math.max(minP, rules.minPremiumKop), maxPremiumKop: maxP, inspectionRequired, breakdown };
}

/** Нормализованные существенные условия предложения → coverage_fingerprint. Юридически значимые различия входят в отпечаток. */
export type CoverageTerms = {
  product: string;
  risks: string[];
  coverObjects?: string[];
  territory: string;
  deductibleRub: number;
  repairMethod?: string;
  termMonths: number;
  sumInsuredRub: number;
  exclusions: { code: string; title: string }[];
  settlement: string;
  emergencyPhone?: string;
  event?: Record<string, unknown>;
};

export function coverageFingerprint(t: CoverageTerms): string {
  const norm = {
    p: t.product, r: [...t.risks].sort(), c: t.coverObjects ? [...t.coverObjects].sort() : null, t: t.territory, d: t.deductibleRub,
    m: t.repairMethod ?? null, n: t.termMonths, s: t.sumInsuredRub, x: t.exclusions.map((e) => e.code).sort(), e: t.event ?? null,
  };
  return createHash("sha256").update(stableStringify(norm)).digest("hex").slice(0, 32);
}

export function termsFromRequest(productCode: string, data: Record<string, any>, rules: ClassicRules, override: { deductibleRub?: number } = {}): CoverageTerms {
  if (productCode === "KASKO") {
    return {
      product: "KASKO", risks: data.risks ?? [], territory: data.territory, deductibleRub: override.deductibleRub ?? Number(data.deductible_rub),
      repairMethod: data.repair_method, termMonths: 12, sumInsuredRub: Number(data.car_value_rub), exclusions: rules.exclusions, settlement: rules.settlement, emergencyPhone: rules.emergencyPhone,
    };
  }
  return {
    product: "PROPERTY", risks: data.risks ?? [], coverObjects: data.cover_objects ?? [], territory: data.city, deductibleRub: override.deductibleRub ?? Number(data.deductible_rub),
    termMonths: 12, sumInsuredRub: Number(data.value_rub), exclusions: rules.exclusions, settlement: rules.settlement, emergencyPhone: rules.emergencyPhone,
  };
}
