import { db, type Tx } from "../db";
import { err } from "../errors";
import { actor, machineRole, type Ctx } from "../access";
import { assertTransition } from "../state/machines";
import { notifyPlatformRole } from "./notify";
import { applyBp } from "../money";
import { DEMO_RULES } from "../config";
import { audit } from "../audit";

export const DIST_TERMS_VERSION = "dist-terms-demo-v1";

/**
 * Начисление дистрибуционного вознаграждения по условиям, действовавшим при сделке.
 * Плательщик — страховщик; доли платформы и агентства — отдельные записи (не дублирующие одну сумму).
 * Уникальный ключ (policyId, recipientType, kind) — одно начисление на полис (AC13).
 */
/**
 * Происхождение сделки для правила начисления (ТЗ 16.11, п. 7.1). Определяется по заявке, из которой выпущен полис:
 * * MARKETPLACE — клиент пришёл в Talisman сам (или уже был пользователем) и выбрал предложение на подборе;
 * * IMPORTED_OTHER_AGENCY — клиента пригласило агентство A, на новом подборе выбрано агентство B: обычная marketplace-доля;
 * * IMPORTED_SAME_AGENCY — клиента пригласило агентство A и он снова выбрал A: пониженная доля за организацию подбора (гипотеза U12).
 * Обслуживание полисов из CRM и полисы вне платформы начислений не создают вовсе (это другие таблицы).
 */
export function dealOrigin(req: { sourceOrgId: string | null }, agencyOrgId: string | null): "MARKETPLACE" | "IMPORTED_OTHER_AGENCY" | "IMPORTED_SAME_AGENCY" {
  if (!req.sourceOrgId) return "MARKETPLACE";
  return req.sourceOrgId === agencyOrgId ? "IMPORTED_SAME_AGENCY" : "IMPORTED_OTHER_AGENCY";
}

export async function accrueCommissions(tx: Tx, policyId: string) {
  const p = await tx.policy.findUniqueOrThrow({ where: { id: policyId } });
  const q = await tx.quote.findUniqueOrThrow({ where: { id: p.quoteId } });
  const req = await tx.insuranceRequest.findUniqueOrThrow({ where: { id: p.requestId }, select: { sourceOrgId: true } });
  const origin = dealOrigin(req, p.agencyOrgId);
  const shareBp = origin === "IMPORTED_SAME_AGENCY" ? DEMO_RULES.platformShareSameAgencyBp : DEMO_RULES.platformShareBp;
  const base = q.premiumKop;
  const total = applyBp(base, q.commissionPct);
  const platform = applyBp(total, shareBp);
  const agency = total - platform;
  const rows = [
    { recipientType: "PLATFORM", recipientOrgId: null as string | null, amountKop: platform, rateBp: shareBp },
    ...(p.agencyOrgId ? [{ recipientType: "AGENCY", recipientOrgId: p.agencyOrgId, amountKop: agency, rateBp: 10000 - shareBp }] : []),
  ];
  const why = origin === "IMPORTED_SAME_AGENCY" ? "; клиент приглашён этим же агентством — пониженная доля платформы" : origin === "IMPORTED_OTHER_AGENCY" ? "; клиент приглашён другим агентством, сделка с нового подбора" : "";
  await tx.commission.createMany({ data: rows.map((r) => ({ policyId, kind: "DISTRIBUTION", dealOrigin: origin, payerOrgId: p.carrierOrgId, recipientType: r.recipientType, recipientOrgId: r.recipientOrgId, baseKop: base, rateBp: r.rateBp, amountKop: r.amountKop, termsVersion: DIST_TERMS_VERSION, note: `Вознаграждение ${q.commissionPct / 100}% от премии, доля ${(r.rateBp / 100).toFixed(0)}%${why}` })), skipDuplicates: true });
  await audit(tx, { role: "SYSTEM" }, "commission.accrued", "Policy", policyId, { after: { total, platform, agency, origin } });
}

/** Агентство оспаривает начисление по своей сделке (например, неверное происхождение). Решает администратор. */
export async function disputeCommission(ctx: Ctx & { orgId: string }, id: string, reason: string) {
  return db.$transaction(async (tx) => {
    const c = await tx.commission.findUnique({ where: { id } });
    if (!c || c.kind !== "DISTRIBUTION") throw err("NOT_FOUND", "Начисление не найдено");
    const p = await tx.policy.findUniqueOrThrow({ where: { id: c.policyId } });
    if (p.agencyOrgId !== ctx.orgId) throw err("NOT_FOUND", "Начисление не найдено");
    assertTransition("commission", c.status, "DISPUTED", machineRole(ctx));
    const upd = await tx.commission.update({ where: { id: c.id }, data: { status: "DISPUTED", disputeReason: reason } });
    await audit(tx, actor(ctx), "commission.disputed", "Commission", c.id, { before: { status: c.status }, after: { status: "DISPUTED" }, reason });
    await notifyPlatformRole(tx, "ADMIN", { type: "commission.disputed", title: "Спор по начислению", body: `Полис ${p.number}: ${reason}`, link: "/admin/billing" });
    return upd;
  });
}

/** Статус начисления меняет администратор. REVERSED по спору — отдельная запись сторно, исходная история не меняется. */
export async function setCommissionStatus(ctx: Ctx, id: string, to: "CONFIRMED" | "RECEIVED" | "REVERSED", note?: string) {
  return db.$transaction(async (tx) => {
    const c = await tx.commission.findUnique({ where: { id } });
    if (!c) throw err("NOT_FOUND", "Начисление не найдено");
    assertTransition("commission", c.status, to, machineRole(ctx));
    const upd = await tx.commission.update({ where: { id: c.id }, data: { status: to } });
    if (to === "REVERSED") {
      await tx.commission.createMany({ data: [{ policyId: c.policyId, kind: "DISPUTE_REVERSAL", dealOrigin: c.dealOrigin, payerOrgId: c.payerOrgId, recipientType: c.recipientType, recipientOrgId: c.recipientOrgId, baseKop: c.baseKop, rateBp: c.rateBp, amountKop: -c.amountKop, status: "REVERSED", termsVersion: c.termsVersion, reversalOfId: c.id, note: `Сторно по спору: ${note ?? c.disputeReason ?? ""}`.slice(0, 500) }], skipDuplicates: true });
    }
    await audit(tx, actor(ctx), "commission.status", "Commission", c.id, { before: { status: c.status }, after: { status: to }, reason: note });
    return upd;
  });
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
