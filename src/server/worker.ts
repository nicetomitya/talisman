import { db } from "./db";
import { now } from "./clock";
import { log } from "./audit";
import { enqueue } from "./jobs";
import { scanDocument } from "./domain/documents";
import { closeAuctionJob } from "./domain/auction";
import { expireReservation, confirmWithCarrier } from "./domain/checkout";
import { checkPaymentStatus, processWebhook } from "./domain/payments";
import { signWebhook, PROVIDERS } from "./adapters/payment";
import { runEventCheck } from "./domain/events";
import { sendPayout } from "./domain/claims";
import { evaluateAutomation } from "./domain/automation";
import { autoCharge, tickSubscriptions } from "./domain/subscriptions";
import { tickPolicies } from "./domain/policies";
import { raiseException } from "./domain/exceptions";

type Handler = (payload: any, attempt: number) => Promise<unknown>;
export const HANDLERS: Record<string, Handler> = {
  "document.scan": (p) => scanDocument(p.documentId),
  "auction.close": (p) => closeAuctionJob(p.auctionId),
  "checkout.expire": (p) => expireReservation(p.checkoutId),
  "carrier.confirm": (p, attempt) => confirmWithCarrier(p.checkoutId, attempt),
  "payment.check": (p) => checkPaymentStatus(p.paymentId),
  "emu.webhook": async (p) => {
    const body = JSON.stringify(p.payload);
    const provider = p.payload.purpose === "SUBSCRIPTION" ? PROVIDERS.saas : PROVIDERS.carrier;
    return processWebhook(provider, body, signWebhook(body));
  },
  "event.check": (p) => runEventCheck(p.policyId),
  "payout.send": (p) => sendPayout(p.payoutItemId),
  "automation.evaluate": (p) => evaluateAutomation(p.orgId, p.requestId, p.version),
  "subscription.autocharge": (p) => autoCharge(p.invoiceId),
};

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

/** Захват заданий: FOR UPDATE SKIP LOCKED; срок — по серверному демо-времени. */
export async function claimJobs(limit = 10) {
  const t = await now();
  return db.$queryRaw<{ id: string; type: string; payload: any; attempts: number; maxAttempts: number }[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedBy" = ${WORKER_ID}, "lockedAt" = now(), "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" IN (SELECT "id" FROM "Job" WHERE "status" = 'PENDING' AND "runAt" <= ${t} ORDER BY "runAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING "id", "type", "payload", "attempts", "maxAttempts"`;
}

export async function runJob(job: { id: string; type: string; payload: any; attempts: number; maxAttempts: number }) {
  const h = HANDLERS[job.type];
  try {
    if (!h) throw new Error(`Нет обработчика ${job.type}`);
    const result = await h(job.payload, job.attempts);
    await db.job.update({ where: { id: job.id }, data: { status: "DONE", result: (result ?? null) as any, lockedBy: null } });
    return { ok: true, result };
  } catch (e: any) {
    const t = await now();
    const dead = job.attempts >= job.maxAttempts;
    const backoffMs = Math.min(5 * 60_000, 5000 * 2 ** (job.attempts - 1));
    await db.job.update({ where: { id: job.id }, data: { status: dead ? "DEAD" : "PENDING", lastError: String(e?.message ?? e).slice(0, 500), runAt: new Date(t.getTime() + backoffMs), lockedBy: null } });
    if (dead) await raiseException(db, { type: "DATA", priority: "HIGH", entityType: "Job", entityId: job.id, reason: `Фоновая задача ${job.type} не выполнена после ${job.attempts} попыток: ${String(e?.message ?? e).slice(0, 200)}`, nextAction: "Проверить причину и перезапустить задачу", dueAt: new Date(t.getTime() + 4 * 3600_000), dedupeKey: `dead:${job.id}` });
    log(dead ? "error" : "warn", "job.failed", { type: job.type, attempt: job.attempts, error: String(e?.message ?? e).slice(0, 200) });
    return { ok: false, error: e?.message };
  }
}

/** Outbox → задания (например, автоответ по каждому подходящему агентству). */
export async function dispatchOutbox() {
  const rows = await db.outbox.findMany({ where: { processedAt: null }, take: 50, orderBy: { createdAt: "asc" } });
  for (const o of rows) {
    const p = o.payload as any;
    if (o.topic === "request.published") {
      const rules = await db.automationRule.findMany({ where: { organizationId: { in: p.eligible as string[] }, mode: { not: "MANUAL" } } });
      for (const r of rules) await enqueue(db, "automation.evaluate", { orgId: r.organizationId, requestId: p.requestId, version: p.version }, { uniqueKey: `auto:${r.organizationId}:${p.requestId}:${p.version}` });
    }
    await db.outbox.update({ where: { id: o.id }, data: { processedAt: new Date() } });
  }
  return rows.length;
}

/** Возврат «зависших» заданий после падения worker (идемпотентные обработчики допускают повтор). */
export async function recoverStale() {
  return db.job.updateMany({ where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - 2 * 60_000) } }, data: { status: "PENDING", lockedBy: null } });
}

let lastTick = 0;
export async function workerTick() {
  await recoverStale();
  await dispatchOutbox();
  let n = 0;
  for (;;) {
    const jobs = await claimJobs(10);
    if (!jobs.length) break;
    for (const j of jobs) { await runJob(j); n++; }
    if (n > 200) break;
  }
  if (Date.now() - lastTick > 5000) {
    lastTick = Date.now();
    await tickSubscriptions().catch((e) => log("error", "tick.subscriptions", { e: e.message }));
    await tickPolicies().catch((e) => log("error", "tick.policies", { e: e.message }));
  }
  await db.setting.upsert({ where: { key: "worker_heartbeat" }, update: { value: { at: new Date().toISOString(), id: WORKER_ID } }, create: { key: "worker_heartbeat", value: { at: new Date().toISOString(), id: WORKER_ID } } });
  return n;
}

/** Синхронный прогон всех готовых заданий (демопанель и тесты). */
export async function drainJobs(maxRounds = 20) {
  let total = 0;
  for (let i = 0; i < maxRounds; i++) {
    lastTick = 0;
    const n = await workerTick();
    total += n;
    if (n === 0) break;
  }
  return total;
}
