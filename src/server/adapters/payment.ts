import { db } from "../db";
import { hmac, sha256, safeEqual } from "../auth/crypto";
import { emu, requireEmulatorAllowed } from "./emu";
import { enqueue } from "../jobs";
import { err } from "../errors";
import { now } from "../clock";

export type PaymentPurpose = "PREMIUM" | "SUBSCRIPTION" | "PAYOUT" | "REFUND";
export interface PaymentAdapter {
  createPayment(i: { purpose: PaymentPurpose; amountKop: number; currency: string; reference: string; idempotencyKey: string }): Promise<{ externalId: string; confirmationUrl: string }>;
  getStatus(externalId: string): Promise<{ status: string; amountKop: number; currency: string; reference: string } | null>;
  refund(i: { paymentExternalId: string; amountKop: number; reference: string; idempotencyKey: string }): Promise<{ externalId: string }>;
  payout(i: { amountKop: number; beneficiary: string; reference: string; idempotencyKey: string }): Promise<{ externalId: string }>;
  verifyWebhook(rawBody: string, signature: string | null): boolean;
}

export const webhookSecret = () => process.env.DEMO_PAYMENT_WEBHOOK_SECRET || "demo-webhook-secret";
export const signWebhook = (body: string) => hmac(body, webhookSecret());

/** Раздельные конфигурации: поток страховщика (премии/выплаты/возвраты) и SaaS-подписка платформы. */
export const PROVIDERS = { carrier: "DEMO_CARRIER_PAY", saas: "DEMO_SAAS_PAY" } as const;

async function emitWebhook(type: string, externalId: string, extra: Record<string, unknown> = {}) {
  const s = await emu();
  const op = await db.emulatorPayment.findUniqueOrThrow({ where: { externalId } });
  const eventId = `evt_${sha256(`${externalId}:${type}`).slice(0, 16)}`;
  const payload = { eventId, type, externalId, amountKop: op.amountKop, currency: op.currency, purpose: op.purpose, reference: op.reference, ...extra };
  const delayMs = s.payment.webhookDelaySec * 1000;
  const runAt = new Date((await now()).getTime() + delayMs);
  await enqueue(db, "emu.webhook", { payload }, { runAt, uniqueKey: `wh:${eventId}:1` });
  if (s.payment.duplicateWebhook) await enqueue(db, "emu.webhook", { payload }, { runAt: new Date(runAt.getTime() + 2000), uniqueKey: `wh:${eventId}:2` });
}

export const paymentEmulator: PaymentAdapter = {
  async createPayment(i) {
    requireEmulatorAllowed("Payment");
    const externalId = `demo_pay_${sha256(i.idempotencyKey).slice(0, 20)}`;
    await db.emulatorPayment.upsert({ where: { externalId }, update: {}, create: { externalId, kind: "PAYMENT", purpose: i.purpose, amountKop: i.amountKop, currency: i.currency, status: "PENDING", reference: i.reference } });
    return { externalId, confirmationUrl: `/demo/pay/${externalId}` };
  },
  async getStatus(externalId) {
    requireEmulatorAllowed("Payment");
    const op = await db.emulatorPayment.findUnique({ where: { externalId } });
    return op ? { status: op.status, amountKop: op.amountKop, currency: op.currency, reference: op.reference } : null;
  },
  async refund(i) {
    requireEmulatorAllowed("Payment");
    const externalId = `demo_ref_${sha256(i.idempotencyKey).slice(0, 20)}`;
    const existing = await db.emulatorPayment.findUnique({ where: { externalId } });
    if (!existing) {
      await db.emulatorPayment.create({ data: { externalId, kind: "REFUND", purpose: "REFUND", amountKop: i.amountKop, status: "SUCCEEDED", reference: i.reference, meta: { paymentExternalId: i.paymentExternalId } } });
      await emitWebhook("refund.succeeded", externalId, { paymentExternalId: i.paymentExternalId });
    }
    return { externalId };
  },
  async payout(i) {
    requireEmulatorAllowed("Payment");
    const externalId = `demo_out_${sha256(i.idempotencyKey).slice(0, 20)}`;
    const existing = await db.emulatorPayment.findUnique({ where: { externalId } });
    if (!existing) {
      await db.emulatorPayment.create({ data: { externalId, kind: "PAYOUT", purpose: "PAYOUT", amountKop: i.amountKop, status: "SUCCEEDED", reference: i.reference, meta: { beneficiary: i.beneficiary } } });
      await emitWebhook("payout.succeeded", externalId);
    }
    return { externalId };
  },
  verifyWebhook(rawBody, signature) {
    if (!signature) return false;
    return safeEqual(signWebhook(rawBody), signature);
  },
};

/** Действие плательщика на демо-странице провайдера. Подтверждение приходит только вебхуком/сверкой, не редиректом. */
export async function emulatorPayerAction(externalId: string, outcome: "success" | "fail" | "lost_webhook" | "cancel") {
  requireEmulatorAllowed("Payment");
  const op = await db.emulatorPayment.findUnique({ where: { externalId } });
  if (!op) throw err("NOT_FOUND", "Платёж не найден у провайдера");
  if (op.status !== "PENDING") return op.status; // повторное нажатие не создаёт второе списание
  const status = outcome === "success" || outcome === "lost_webhook" ? "SUCCEEDED" : outcome === "fail" ? "FAILED" : "CANCELLED";
  await db.emulatorPayment.update({ where: { externalId }, data: { status, scenario: outcome } });
  if (outcome === "success") await emitWebhook("payment.succeeded", externalId);
  if (outcome === "fail") await emitWebhook("payment.failed", externalId, { reason: "Отказ банка-эмитента (эмуляция)" });
  if (outcome === "cancel") await emitWebhook("payment.canceled", externalId);
  return status;
}

/** Повторная доставка последнего события (демопанель «повтор webhook»). */
export async function replayWebhook(externalId: string) {
  const op = await db.emulatorPayment.findUnique({ where: { externalId } });
  if (!op) throw err("NOT_FOUND", "Операция не найдена");
  const type = op.kind === "PAYOUT" ? "payout.succeeded" : op.kind === "REFUND" ? "refund.succeeded" : op.status === "SUCCEEDED" ? "payment.succeeded" : op.status === "FAILED" ? "payment.failed" : null;
  if (!type) throw err("CONFLICT", "Нет события для повтора");
  const eventId = `evt_${sha256(`${externalId}:${type}`).slice(0, 16)}`;
  const payload = { eventId, type, externalId, amountKop: op.amountKop, currency: op.currency, purpose: op.purpose, reference: op.reference, ...(op.meta as object) };
  await enqueue(db, "emu.webhook", { payload }, { uniqueKey: `wh:${eventId}:replay:${Date.now()}` });
}
