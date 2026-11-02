import { db, txRetry, type Tx } from "../db";
import { err } from "../errors";
import { audit, log } from "../audit";
import { now } from "../clock";
import { assertTransition, canTransition } from "../state/machines";
import { adapters } from "../adapters";
import { enqueue } from "../jobs";
import { raiseException } from "./exceptions";
import { onInvoiceFailed, onInvoicePaid } from "./subscriptions";
import { onPremiumSucceeded, onPremiumFailed } from "./checkout";
import { onPayoutSucceeded } from "./claims";
import { notify } from "./notify";
import type { PaymentStatus } from "@prisma/client";

export async function setPaymentStatus(tx: Tx, paymentId: string, to: PaymentStatus, source: string, extra: { failureReason?: string } = {}) {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.status === to) return { changed: false, payment: p };
  if (!canTransition("payment", p.status, to, "SYSTEM")) {
    log("warn", "payment.transition_ignored", { paymentId, from: p.status, to, source });
    return { changed: false, payment: p };
  }
  const upd = await tx.payment.updateMany({ where: { id: p.id, version: p.version }, data: { status: to, version: { increment: 1 }, confirmedAt: to === "SUCCEEDED" ? new Date() : undefined, failureReason: extra.failureReason } });
  if (upd.count !== 1) throw err("CONFLICT", "Параллельное изменение платежа");
  await tx.paymentStatusHistory.create({ data: { paymentId: p.id, from: p.status, to, source } });
  return { changed: true, payment: await tx.payment.findUniqueOrThrow({ where: { id: p.id } }) };
}

/**
 * Приём вебхука провайдера. Подпись, идентификатор, сумма, валюта и назначение проверяются.
 * Inbox с уникальным (provider, eventId) и обработка — в одной транзакции: повтор/поздний/внеочередной вебхук
 * даёт один бизнес-результат (AC13).
 */
export async function processWebhook(provider: string, rawBody: string, signature: string | null) {
  const valid = adapters.payment.verifyWebhook(rawBody, signature);
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { throw err("VALIDATION", "Некорректное тело вебхука"); }
  if (!valid) {
    log("warn", "webhook.bad_signature", { provider });
    throw err("FORBIDDEN", "Подпись вебхука не прошла проверку");
  }
  const eventId = String(payload.eventId ?? "");
  if (!eventId) throw err("VALIDATION", "Нет идентификатора события");
  return txRetry(async (tx) => {
    const inserted = await tx.$executeRaw`INSERT INTO "WebhookInbox" ("id", "provider", "externalEventId", "payload", "signatureValid", "createdAt") VALUES (gen_random_uuid(), ${provider}, ${eventId}, ${rawBody}::jsonb, true, now()) ON CONFLICT ("provider", "externalEventId") DO NOTHING`;
    if (inserted === 0) {
      await tx.webhookInbox.update({ where: { provider_externalEventId: { provider, externalEventId: eventId } }, data: { receivedCount: { increment: 1 } } });
      return { duplicate: true };
    }
    const result = await applyProviderEvent(tx, payload, `webhook:${eventId}`);
    await tx.webhookInbox.update({ where: { provider_externalEventId: { provider, externalEventId: eventId } }, data: { processedAt: new Date(), result } });
    return { duplicate: false, result };
  });
}

async function applyProviderEvent(tx: Tx, e: any, source: string): Promise<string> {
  const t = await now();
  if (e.type === "refund.succeeded") {
    const r = await tx.refund.findUnique({ where: { externalId: e.externalId } });
    if (!r) return "refund_unknown";
    if (r.amountKop !== e.amountKop) { await mismatch(tx, "Refund", r.id, "Сумма возврата у провайдера не совпадает"); return "mismatch"; }
    if (r.status === "SUCCEEDED") return "refund_already";
    await tx.refund.update({ where: { id: r.id }, data: { status: "SUCCEEDED" } });
    const p = await tx.payment.findUniqueOrThrow({ where: { id: r.paymentId } });
    if (p.payerUserId) await notify(tx, p.payerUserId, { type: "refund.done", title: "Возврат премии выполнен страховщиком", body: `${(r.amountKop / 100).toLocaleString("ru-RU")} ₽`, link: r.policyId ? `/c/policies/${r.policyId}` : "/c/payments" });
    return "refund_succeeded";
  }
  if (e.type === "payout.succeeded") return onPayoutSucceeded(tx, e.externalId, e.amountKop, t);

  const p = await tx.payment.findUnique({ where: { externalId: e.externalId } });
  if (!p) { await raiseException(tx, { type: "PAYMENT", entityType: "WebhookInbox", entityId: "00000000-0000-0000-0000-000000000000", reason: `Вебхук для неизвестного платежа ${String(e.externalId).slice(0, 40)}`, nextAction: "Сверить с провайдером", dueAt: new Date(t.getTime() + 4 * 3600_000), priority: "HIGH", dedupeKey: `unknown_payment:${e.externalId}` }); return "unknown_payment"; }
  if (p.amountKop !== e.amountKop || p.currency !== e.currency || p.purpose !== e.purpose) {
    await mismatch(tx, "Payment", p.id, `Расхождение суммы/валюты/назначения: ожидалось ${p.amountKop} ${p.currency} ${p.purpose}, получено ${e.amountKop} ${e.currency} ${e.purpose}`);
    return "mismatch";
  }
  if (e.type === "payment.succeeded") {
    const { changed } = await setPaymentStatus(tx, p.id, "SUCCEEDED", source);
    if (!changed) return "already_applied";
    if (p.purpose === "PREMIUM" && p.checkoutId) await onPremiumSucceeded(tx, p.checkoutId, p.id, t);
    if (p.purpose === "SUBSCRIPTION" && p.invoiceId) await onInvoicePaid(tx, p.invoiceId, t);
    return "succeeded";
  }
  if (e.type === "payment.failed" || e.type === "payment.canceled") {
    const { changed } = await setPaymentStatus(tx, p.id, e.type === "payment.failed" ? "FAILED" : "CANCELLED", source, { failureReason: e.reason ?? null });
    if (!changed) return "already_applied";
    if (p.purpose === "PREMIUM" && p.checkoutId) await onPremiumFailed(tx, p.checkoutId, t);
    if (p.purpose === "SUBSCRIPTION" && p.invoiceId) await onInvoiceFailed(tx, p.invoiceId, t);
    return "failed";
  }
  return "ignored";
}

async function mismatch(tx: Tx, entityType: string, entityId: string, reason: string) {
  const t = await now();
  await raiseException(tx, { type: "PAYMENT", priority: "HIGH", entityType, entityId, reason, nextAction: "Провести сверку с провайдером и страховщиком", dueAt: new Date(t.getTime() + 4 * 3600_000), dedupeKey: `mismatch:${entityType}:${entityId}` });
}

/**
 * Сверка: операции провайдера × внутренний журнал. Неизвестные и зависшие статусы уточняются у провайдера,
 * повторное списание не выполняется. Расхождения — в очередь; исправления — отдельными записями.
 */
export async function reconcile() {
  const t = await now();
  const report = { checked: 0, resolved: 0, discrepancies: 0 };
  const candidates = await db.payment.findMany({ where: { status: { in: ["PENDING", "UNKNOWN", "AUTHORIZED"] }, NOT: { externalId: { startsWith: "pending:" } } } });
  for (const p of candidates) {
    report.checked++;
    const st = await adapters.payment.getStatus(p.externalId).catch(() => null);
    if (!st) continue;
    if (st.status === "SUCCEEDED" || st.status === "FAILED") {
      await txRetry(async (tx) => {
        const r = await applyProviderEvent(tx, { type: st.status === "SUCCEEDED" ? "payment.succeeded" : "payment.failed", externalId: p.externalId, amountKop: st.amountKop, currency: st.currency, purpose: p.purpose, reason: "Уточнено сверкой" }, "reconciliation");
        if (r === "succeeded" || r === "failed") report.resolved++;
        if (r === "mismatch") report.discrepancies++;
      });
    } else if (st.status === "UNKNOWN" && p.status === "PENDING") {
      await txRetry((tx) => setPaymentStatus(tx, p.id, "UNKNOWN", "reconciliation"));
    }
  }
  // Внутренний успех без подтверждения провайдера — расхождение.
  const succeeded = await db.payment.findMany({ where: { status: "SUCCEEDED", updatedAt: { gt: new Date(t.getTime() - 30 * 86400_000) } } });
  for (const p of succeeded) {
    const st = await adapters.payment.getStatus(p.externalId).catch(() => null);
    if (!st || st.status !== "SUCCEEDED" || st.amountKop !== p.amountKop) {
      report.discrepancies++;
      await mismatch(db as any, "Payment", p.id, "Внутренний статус «успешно» не подтверждён провайдером");
    }
  }
  // Оплата прошла, но нет подтверждения страховщика — восстановление и задача поддержке.
  const stuck = await db.checkout.findMany({ where: { status: "AWAITING_CARRIER" } });
  for (const c of stuck) await enqueue(db, "carrier.confirm", { checkoutId: c.id }, { uniqueKey: `carrier.confirm:recon:${c.id}:${Math.floor(t.getTime() / 60000)}` });
  await db.setting.upsert({ where: { key: "last_reconciliation" }, update: { value: { at: t.toISOString(), ...report } }, create: { key: "last_reconciliation", value: { at: t.toISOString(), ...report } } });
  await audit(db, { role: "SYSTEM" }, "payments.reconcile", "Payment", null, { after: report });
  return report;
}

/** Проверка статуса конкретного платежа после создания (без повторного списания). */
export async function checkPaymentStatus(paymentId: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p || !["PENDING", "UNKNOWN"].includes(p.status)) return { skipped: true };
  const st = await adapters.payment.getStatus(p.externalId);
  if (st?.status === "UNKNOWN" && p.status === "PENDING") await txRetry((tx) => setPaymentStatus(tx, p.id, "UNKNOWN", "status_check"));
  return { provider: st?.status ?? null };
}

export { assertTransition };
