import { db, txRetry } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, type Ctx } from "../access";
import { now } from "../clock";
import { assertTransition } from "../state/machines";
import { adapters } from "../adapters";
import { DEMO_RULES } from "../config";
import { notify, notifyOrg } from "./notify";
import { reverseCommissions } from "./commissions";
import { lockRow } from "./requests";
import { createRequest } from "./requests";

export type CoverageState = "PENDING_START" | "ACTIVE" | "ENDED" | "NONE";

/** «Оплачен», «заключён» и «защита действует» различаются; до даты начала — «Начнёт действовать» (AC15). */
export function coverageState(p: { contractStatus: string; startsAt: Date; endsAt: Date; terminatedAt: Date | null }, t: Date): CoverageState {
  if (p.contractStatus !== "CONCLUDED") return p.contractStatus === "TERMINATED" || p.contractStatus === "EXPIRED" ? "ENDED" : "NONE";
  if (t < p.startsAt) return "PENDING_START";
  if (t >= p.endsAt) return "ENDED";
  return "ACTIVE";
}

export async function getOwnPolicy(ctx: Ctx, id: string) {
  const p = await db.policy.findFirst({ where: { id, clientId: ctx.user.id }, include: { coverages: true } });
  if (!p) throw err("NOT_FOUND", "Полис не найден");
  return p;
}

/** Предварительный расчёт возврата до подтверждения прекращения (расчёт делает страховщик). */
export async function terminationPreview(ctx: Ctx, id: string, dateIso?: string) {
  const p = await getOwnPolicy(ctx, id);
  if (p.contractStatus !== "CONCLUDED") throw err("INVALID_TRANSITION", "Договор не действует");
  const t = await now();
  const date = dateIso ? new Date(dateIso + "T00:00:00+03:00") : t;
  if (date < new Date(t.toISOString().slice(0, 10) + "T00:00:00+03:00")) throw err("VALIDATION", "Дата прекращения не может быть в прошлом");
  const paid = await db.payment.findFirst({ where: { checkoutId: p.checkoutId ?? undefined, status: "SUCCEEDED", purpose: "PREMIUM" } });
  const claims = await db.claim.count({ where: { policyId: p.id, status: { notIn: ["DRAFT", "REJECTED", "CLOSED"] } } });
  const coolingOff = !!p.concludedAt && date.getTime() - p.concludedAt.getTime() <= DEMO_RULES.coolingOffDays * 86400_000 && claims === 0;
  const r = await adapters.carrier.terminate({ policyNumber: p.number, premiumKop: paid?.amountKop ?? p.premiumKop, startsAt: p.startsAt, endsAt: p.endsAt, terminationDate: date, coolingOff });
  return { refundKop: Math.min(r.refundKop, paid?.amountKop ?? 0), effectiveAt: r.effectiveAt, coolingOff, consequences: "С даты прекращения покрытие перестаёт действовать; обращения по событиям после этой даты не принимаются. Решение о прекращении подтверждает страховщик.", recipient: "Возврат выполняет страховщик на исходный способ оплаты" };
}

/**
 * Прекращение: подтверждение страховщика (эмулятор), отдельная операция возврата со связью с исходной оплатой,
 * сторно комиссии отдельными записями (AC26). Сумма возвратов ≤ оплаченной.
 */
export async function terminatePolicy(ctx: Ctx, id: string, i: { date?: string; reason: string; confirm: boolean }) {
  if (!i.confirm) throw err("VALIDATION", "Подтвердите прекращение после ознакомления с расчётом");
  const preview = await terminationPreview(ctx, id, i.date);
  const p = await getOwnPolicy(ctx, id);
  const payment = await db.payment.findFirst({ where: { checkoutId: p.checkoutId ?? undefined, status: "SUCCEEDED", purpose: "PREMIUM" } });
  const refund = await txRetry(async (tx) => {
    await lockRow(tx, "Policy", p.id);
    const cur = await tx.policy.findUniqueOrThrow({ where: { id: p.id } });
    assertTransition("contract", cur.contractStatus, "TERMINATED", "SYSTEM");
    await tx.policy.update({ where: { id: p.id }, data: { contractStatus: "TERMINATED", terminatedAt: preview.effectiveAt, terminationReason: i.reason.slice(0, 500), version: { increment: 1 } } });
    await tx.eventCheck.updateMany({ where: { policyId: p.id, status: "SCHEDULED" }, data: { status: "COMPLETED", result: "UNKNOWN", details: { note: "Договор прекращён до события" } } });
    let refund = null;
    if (payment && preview.refundKop > 0) {
      const already = await tx.refund.aggregate({ where: { paymentId: payment.id, status: { not: "FAILED" } }, _sum: { amountKop: true } });
      if ((already._sum.amountKop ?? 0) + preview.refundKop > payment.amountKop) throw err("LIMIT_EXCEEDED", "Сумма возвратов превысила бы оплаченную сумму");
      refund = await tx.refund.create({ data: { paymentId: payment.id, policyId: p.id, externalId: `pending:refund:${p.id}`, amountKop: preview.refundKop, reason: i.reason.slice(0, 300) } });
      await reverseCommissions(tx, p.id, preview.refundKop, payment.amountKop);
    }
    await audit(tx, actor(ctx), "policy.terminated", "Policy", p.id, { after: { refundKop: preview.refundKop, effectiveAt: preview.effectiveAt }, reason: i.reason });
    if (p.agencyOrgId) await notifyOrg(tx, p.agencyOrgId, { type: "policy.terminated", title: "Клиент прекратил договор", body: p.number, link: `/a/deals` });
    return refund;
  });
  if (refund && payment) {
    const r = await adapters.payment.refund({ paymentExternalId: payment.externalId, amountKop: refund.amountKop, reference: `refund:${refund.id}`, idempotencyKey: `refund:${refund.id}` });
    await db.refund.update({ where: { id: refund.id }, data: { externalId: r.externalId } });
  }
  return { refundKop: preview.refundKop };
}

export async function requestChange(ctx: Ctx, id: string, description: string) {
  const p = await getOwnPolicy(ctx, id);
  const t = await now();
  return db.$transaction(async (tx) => {
    if (p.agencyOrgId) {
      await tx.task.create({ data: { organizationId: p.agencyOrgId, assigneeId: p.servicingAgentId, title: `Запрос на изменение полиса ${p.number}`, note: description.slice(0, 1000), relatedType: "Policy", relatedId: p.id, dueAt: new Date(t.getTime() + 3 * 86400_000) } });
      await notifyOrg(tx, p.agencyOrgId, { type: "policy.change_request", title: "Запрос на изменение полиса", body: description.slice(0, 140), link: `/a/deals` });
    }
    await audit(tx, actor(ctx), "policy.change_requested", "Policy", p.id, { after: { description } });
    return { ok: true, note: "Изменение юридически значимых данных потребует новой версии документов и вашего подтверждения." };
  });
}

/** Изменение бронирования запускает проверку применимости покрытия (демо-правило: до события — прекращение с полным возвратом). */
export async function reportBookingChange(ctx: Ctx, id: string, kind: "CANCELLED" | "DATE_CHANGED" | "VENUE_CHANGED") {
  const p = await getOwnPolicy(ctx, id);
  if (!["RAIN01", "WIND01"].includes(p.productCode)) throw err("VALIDATION", "Только для событийных полисов");
  const t = await now();
  if (t >= p.startsAt) throw err("INVALID_TRANSITION", "Событие уже началось — обратитесь в поддержку");
  await db.policy.update({ where: { id: p.id }, data: { bookingCanceledAt: t } });
  const reason = kind === "CANCELLED" ? "Отмена бронирования" : kind === "DATE_CHANGED" ? "Перенос даты: покрытие не переносится автоматически" : "Изменение места: координаты покрытия не совпадают";
  return terminatePolicy(ctx, id, { reason: `${reason} (проверка применимости покрытия)`, confirm: true, date: t.toISOString().slice(0, 10) });
}

/** Продление — новая котировка с актуальными данными; старая цена не переносится, история сохраняется. */
export async function startRenewal(ctx: Ctx, id: string) {
  const p = await getOwnPolicy(ctx, id);
  const r = await db.insuranceRequest.findUniqueOrThrow({ where: { id: p.requestId } });
  const nr = await createRequest(ctx, { productCode: r.productCode, freeText: `Продление полиса ${p.number}` });
  const data = { ...(r.data as any) };
  const startsNext = new Date(p.endsAt); data.start_date = startsNext.toISOString().slice(0, 10);
  const confirmed = Object.fromEntries(Object.keys(data).map((k) => [k, { status: "NEEDS_RECHECK", source: `policy:${p.number}` }]));
  await db.insuranceRequest.update({ where: { id: nr.id }, data: { data, confirmed, renewalOfPolicyId: p.id, title: `${r.title} — продление` } });
  await audit(db, actor(ctx), "policy.renewal_started", "Policy", p.id, { after: { requestId: nr.id } });
  return nr;
}

/** Напоминания об окончании (сервисные) и истечение договоров по времени. */
export async function tickPolicies() {
  const t = await now();
  const soon = await db.policy.findMany({ where: { contractStatus: "CONCLUDED", productCode: { in: ["KASKO", "PROPERTY"] }, endsAt: { gt: t, lte: new Date(t.getTime() + 30 * 86400_000) }, renewalReminderSentAt: null } });
  for (const p of soon) {
    await db.$transaction(async (tx) => {
      await notify(tx, p.clientId, { type: "policy.ending", title: "Полис скоро закончится", body: `Полис ${p.number} действует до ${p.endsAt.toLocaleDateString("ru-RU")}. Продление начинается с новой котировки по актуальным данным.`, link: `/c/policies/${p.id}`, email: true, dedupeKey: `ending:${p.id}` });
      await tx.policy.update({ where: { id: p.id }, data: { renewalReminderSentAt: t } });
    });
  }
  const expired = await db.policy.findMany({ where: { contractStatus: "CONCLUDED", endsAt: { lte: t }, productCode: { in: ["KASKO", "PROPERTY"] } } });
  for (const p of expired) await db.policy.update({ where: { id: p.id }, data: { contractStatus: "EXPIRED" } });
  return { reminded: soon.length, expired: expired.length };
}
