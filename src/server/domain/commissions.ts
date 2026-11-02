import { type Tx } from "../db";
import { applyBp } from "../money";
import { DEMO_RULES } from "../config";
import { audit } from "../audit";

export const DIST_TERMS_VERSION = "dist-terms-demo-v1";

/**
 * Начисление дистрибуционного вознаграждения по условиям, действовавшим при сделке.
 * Плательщик — страховщик; доли платформы и агентства — отдельные записи (не дублирующие одну сумму).
 * Уникальный ключ (policyId, recipientType, kind) — одно начисление на полис (AC13).
 */
export async function accrueCommissions(tx: Tx, policyId: string) {
  const p = await tx.policy.findUniqueOrThrow({ where: { id: policyId } });
  const q = await tx.quote.findUniqueOrThrow({ where: { id: p.quoteId } });
  const base = q.premiumKop;
  const total = applyBp(base, q.commissionPct);
  const platform = applyBp(total, DEMO_RULES.platformShareBp);
  const agency = total - platform;
  const rows = [
    { recipientType: "PLATFORM", recipientOrgId: null as string | null, amountKop: platform, rateBp: DEMO_RULES.platformShareBp },
    ...(p.agencyOrgId ? [{ recipientType: "AGENCY", recipientOrgId: p.agencyOrgId, amountKop: agency, rateBp: 10000 - DEMO_RULES.platformShareBp }] : []),
  ];
  await tx.commission.createMany({ data: rows.map((r) => ({ policyId, kind: "DISTRIBUTION", payerOrgId: p.carrierOrgId, recipientType: r.recipientType, recipientOrgId: r.recipientOrgId, baseKop: base, rateBp: r.rateBp, amountKop: r.amountKop, termsVersion: DIST_TERMS_VERSION, note: `Вознаграждение ${q.commissionPct / 100}% от премии, доля ${(r.rateBp / 100).toFixed(0)}%` })), skipDuplicates: true });
  await audit(tx, { role: "SYSTEM" }, "commission.accrued", "Policy", policyId, { after: { total, platform, agency } });
}

/** Сторно при прекращении: отдельные записи с отрицательной суммой, исходная история не меняется. */
export async function reverseCommissions(tx: Tx, policyId: string, refundKop: number, premiumKop: number) {
  const orig = await tx.commission.findMany({ where: { policyId, kind: "DISTRIBUTION" } });
  for (const c of orig) {
    const amount = refundKop >= premiumKop ? c.amountKop : Number((BigInt(c.amountKop) * BigInt(refundKop)) / BigInt(premiumKop));
    if (amount <= 0) continue;
    await tx.commission.createMany({ data: [{ policyId, kind: "REVERSAL", payerOrgId: c.payerOrgId, recipientType: c.recipientType, recipientOrgId: c.recipientOrgId, baseKop: refundKop, rateBp: c.rateBp, amountKop: -amount, status: "REVERSED", termsVersion: c.termsVersion, reversalOfId: c.id, note: refundKop >= premiumKop ? "Полное сторно (прекращение в период охлаждения)" : "Частичное сторно пропорционально возврату" }], skipDuplicates: true });
  }
}
