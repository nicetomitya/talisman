/**
 * Лимиты симуляции — продуктовые гипотезы, не правовые safe harbors (ТЗ v2, п. 9.3; D21).
 * Лимит — максимальная виртуальная выплата на связанное событие (eventRootKey), агрегируется по всем лотам.
 */
export const TIERS = {
  T0: { label: "Guest", maxPayoutCents: 1_000_00 },
  T1: { label: "Registered user", maxPayoutCents: 5_000_00 },
  T2: { label: "Approved expert", maxPayoutCents: 25_000_00 },
  T3: { label: "Professional (admin-assigned)", maxPayoutCents: 100_000_00 },
} as const;
export type Tier = keyof typeof TIERS;

export function tierFor(u: { riskTierOverride: string | null } | null, expertApproved: boolean): Tier {
  if (!u) return "T0";
  if (u.riskTierOverride && u.riskTierOverride in TIERS) return u.riskTierOverride as Tier;
  return expertApproved ? "T2" : "T1";
}

export function checkLimit(tier: Tier, existingPayoutCents: number, newPayoutCents: number) {
  const max = TIERS[tier].maxPayoutCents;
  return { ok: existingPayoutCents + newPayoutCents <= max, maxCents: max, usedCents: existingPayoutCents, remainingCents: Math.max(0, max - existingPayoutCents) };
}

/** Конфликт интересов по объекту (стройка, дом): связанные лица — запрет, неясные связи — ручная проверка. */
export const RELATIONSHIPS = ["NONE", "EMPLOYEE", "CONTRACTOR", "INSPECTOR", "AFFILIATE", "OTHER"] as const;
export function restrictionFor(rel: string): "ALLOWED" | "MANUAL_REVIEW" | "BLOCKED" {
  if (rel === "NONE") return "ALLOWED";
  if (rel === "EMPLOYEE" || rel === "CONTRACTOR" || rel === "INSPECTOR") return "BLOCKED";
  return "MANUAL_REVIEW";
}
