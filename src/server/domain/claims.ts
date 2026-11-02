import { randomUUID } from "node:crypto";
import { db, txRetry, type Tx } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, machineRole, type Ctx } from "../access";
import { now } from "../clock";
import { assertTransition } from "../state/machines";
import { enqueue } from "../jobs";
import { adapters } from "../adapters";
import { notify, notifyOrg } from "./notify";
import { raiseException } from "./exceptions";
import { lockRow } from "./requests";
import { ensureConversation } from "./messaging";

/** Явная таблица соответствия статусов страховщика и отображаемых статусов платформы. */
export const CARRIER_STATUS_MAP: Record<string, string> = {
  RECEIVED: "SUBMITTED", DOCS_REQUIRED: "NEEDS_INFO", IN_REVIEW: "REVIEWING", DECISION_DRAFT: "DECISION_PREPARED", DECIDED_PAY: "APPROVED",
  DECIDED_DECLINE: "REJECTED", PAYMENT_SENT: "PAYOUT_IN_PROGRESS", PAID: "PAID", APPEAL: "DISPUTED", CLOSED: "CLOSED",
};
const PLATFORM_TO_CARRIER = Object.fromEntries(Object.entries(CARRIER_STATUS_MAP).map(([k, v]) => [v, k]));

export const REQUIRED_DOCS: Record<string, string[]> = {
  KASKO: ["Фото повреждений", "Европротокол или справка ГИБДД", "Водительское удостоверение (демо-файл)"],
  PROPERTY: ["Фото повреждений", "Акт управляющей компании"],
  RAIN01: [], WIND01: [],
};

async function event(tx: Tx, claimId: string, type: string, actorId: string | null, note?: string, data: Record<string, unknown> = {}) {
  await tx.claimEvent.create({ data: { claimId, type, actorId, note, data: data as any } });
}

async function setStatus(tx: Tx, claimId: string, to: string, by: string, actorId: string | null, note?: string, extra: Record<string, unknown> = {}) {
  const c = await tx.claim.findUniqueOrThrow({ where: { id: claimId } });
  assertTransition("claim", c.status, to, by);
  const upd = await tx.claim.update({ where: { id: c.id, version: c.version }, data: { status: to as any, carrierStatus: PLATFORM_TO_CARRIER[to] ?? c.carrierStatus, version: { increment: 1 }, ...extra } });
  await event(tx, c.id, `status:${to}`, actorId, note);
  return upd;
}

const claimNumber = () => `CLM-DEMO-${randomUUID().slice(0, 8).toUpperCase()}`;

/**
 * Обращение по параметрическому полису. Одно на проверку события.
 * AUTO — условие выполнено по финальным данным: эмулятор страховщика одобряет в пределах полномочий, выплата инициируется.
 * REVIEWING — исключение (нет данных/конфликт): задача специалисту, решение вручную.
 */
export async function createParametricClaim(tx: Tx, policyId: string, eventCheckId: string, mode: "AUTO" | "REVIEWING", explanation: string) {
  const existing = await tx.claim.findFirst({ where: { eventCheckId } });
  const policy = await tx.policy.findUniqueOrThrow({ where: { id: policyId } });
  const t = await now();
  const c = existing ?? (await tx.claim.create({ data: { number: claimNumber(), policyId, clientId: policy.clientId, agencyOrgId: policy.agencyOrgId, carrierOrgId: policy.carrierOrgId, type: "PARAMETRIC", status: "SUBMITTED", carrierStatus: "RECEIVED", eventCheckId, eventDate: policy.startsAt, description: explanation, slaDueAt: new Date(t.getTime() + 5 * 86400_000) } }));
  if (!existing) {
    await event(tx, c.id, "created", null, explanation);
    await ensureConversation(tx, { contextType: "CLAIM", contextId: c.id, clientId: policy.clientId, agencyOrgId: policy.agencyOrgId, title: `Обращение ${c.number}` });
  }
  if (mode === "REVIEWING") {
    if (c.status === "SUBMITTED") await setStatus(tx, c.id, "REVIEWING", "SYSTEM", null, "Передано специалисту: требуется ручная проверка данных");
    return tx.claim.findUniqueOrThrow({ where: { id: c.id } });
  }
  if (c.status !== "SUBMITTED") return c;
  await setStatus(tx, c.id, "REVIEWING", "SYSTEM", null, "Автоматическая проверка по финальным данным");
  const decision = await adapters.carrier.parametricDecision({ claimNumber: c.number, outcome: "MET", finalData: true, payoutKop: 0 });
  await setStatus(tx, c.id, "DECISION_PREPARED", "SYSTEM", null, decision.reason);
  if (decision.decision !== "APPROVE") return tx.claim.findUniqueOrThrow({ where: { id: c.id } });
  await setStatus(tx, c.id, "APPROVED", "SYSTEM", null, decision.reason, { decision: "APPROVED", decisionReason: decision.reason });
  await initiatePayout(tx, c.id, eventCheckId);
  const ec = await tx.eventCheck.findUniqueOrThrow({ where: { id: eventCheckId } });
  if (ec.status === "CALCULATED") { assertTransition("eventCheck", "CALCULATED", "COMPLETED", "SYSTEM"); await tx.eventCheck.update({ where: { id: ec.id }, data: { status: "COMPLETED" } }); }
  return tx.claim.findUniqueOrThrow({ where: { id: c.id } });
}

/**
 * Инициирование выплаты: позиция с уникальным основанием (policy, coverage, basisKey) и резерв лимита покрытия
 * под блокировкой строки + CHECK (paid ≤ limit). Повтор не увеличивает выплаченную сумму (AC19).
 */
export async function initiatePayout(tx: Tx, claimId: string, basisKey: string, amountOverrideKop?: number) {
  const c = await tx.claim.findUniqueOrThrow({ where: { id: claimId } });
  const cov = await tx.coverage.findFirstOrThrow({ where: { policyId: c.policyId } });
  await lockRow(tx, "Coverage", cov.id);
  const fresh = await tx.coverage.findUniqueOrThrow({ where: { id: cov.id } });
  const existing = await tx.payoutItem.findUnique({ where: { policyId_coverageCode_basisKey: { policyId: c.policyId, coverageCode: cov.code, basisKey } } });
  if (existing) return existing;
  const amount = amountOverrideKop ?? fresh.limitKop;
  if (fresh.paidKop + amount > fresh.limitKop) {
    await raiseException(tx, { type: "PAYOUT", priority: "HIGH", entityType: "Claim", entityId: c.id, reason: "Выплата превысила бы лимит покрытия", nextAction: "Проверить основания выплат", dueAt: new Date((await now()).getTime() + 86400_000), dedupeKey: `limit:${c.id}` });
    throw err("LIMIT_EXCEEDED", "Лимит покрытия исчерпан");
  }
  await tx.coverage.update({ where: { id: cov.id }, data: { paidKop: { increment: amount }, version: { increment: 1 } } });
  const client = await tx.user.findUniqueOrThrow({ where: { id: c.clientId } });
  const item = await tx.payoutItem.create({ data: { claimId: c.id, policyId: c.policyId, coverageCode: cov.code, basisKey, amountKop: amount, beneficiary: `${client.name} (демо-реквизиты: токен выплаты эмулятора)` } });
  await setStatus(tx, c.id, "PAYOUT_IN_PROGRESS", "SYSTEM", null, `Выплата ${amount / 100} ₽ инициирована страховщиком (эмулятор)`);
  await enqueue(tx, "payout.send", { payoutItemId: item.id }, { uniqueKey: `payout.send:${item.id}` });
  await notify(tx, c.clientId, { type: "claim.payout", title: "Выплата инициирована", body: `Обращение ${c.number}: ${(amount / 100).toLocaleString("ru-RU")} ₽. Выплату выполняет страховщик.`, link: `/c/claims/${c.id}` });
  return item;
}

/** Отправка выплаты провайдеру (вне транзакции, идемпотентный ключ). */
export async function sendPayout(payoutItemId: string) {
  const item = await db.payoutItem.findUniqueOrThrow({ where: { id: payoutItemId } });
  if (item.status !== "INITIATED") return { skipped: item.status };
  const res = await adapters.payment.payout({ amountKop: item.amountKop, beneficiary: item.beneficiary, reference: `payout:${item.id}`, idempotencyKey: `payout:${item.id}` });
  await db.payoutItem.updateMany({ where: { id: item.id, status: "INITIATED" }, data: { status: "IN_PROGRESS", externalId: res.externalId } });
  return { externalId: res.externalId };
}

export async function onPayoutSucceeded(tx: Tx, externalId: string, amountKop: number, t: Date): Promise<string> {
  const item = await tx.payoutItem.findUnique({ where: { externalId } });
  if (!item) return "payout_unknown";
  if (item.amountKop !== amountKop) { await raiseException(tx, { type: "PAYOUT", priority: "CRITICAL", entityType: "PayoutItem", entityId: item.id, reason: "Сумма выплаты у провайдера не совпадает", nextAction: "Сверка", dueAt: new Date(t.getTime() + 3600_000), dedupeKey: `payout_mismatch:${item.id}` }); return "mismatch"; }
  const upd = await tx.payoutItem.updateMany({ where: { id: item.id, status: { not: "PAID" } }, data: { status: "PAID" } });
  if (upd.count === 0) return "payout_already";
  const c = await tx.claim.findUniqueOrThrow({ where: { id: item.claimId } });
  if (c.status === "PAYOUT_IN_PROGRESS") await setStatus(tx, c.id, "PAID", "SYSTEM", null, "Выплата подтверждена провайдером");
  await notify(tx, c.clientId, { type: "claim.paid", title: "Выплата выполнена", body: `Обращение ${c.number}: ${(item.amountKop / 100).toLocaleString("ru-RU")} ₽ (демовыплата, деньги не переводились).`, link: `/c/claims/${c.id}`, email: true });
  return "payout_paid";
}

// ───────── Классические обращения ─────────

export async function createClassicClaim(ctx: Ctx, policyId: string, i: { eventDate: string; description: string; answers: Record<string, string> }) {
  const t = await now();
  return txRetry(async (tx) => {
    const p = await tx.policy.findFirst({ where: { id: policyId, clientId: ctx.user.id } });
    if (!p) throw err("NOT_FOUND", "Полис не найден");
    if (p.productCode === "RAIN01" || p.productCode === "WIND01") throw err("VALIDATION", "По событийному полису обращение создаётся автоматически; можно задать вопрос или открыть спор");
    if (p.contractStatus !== "CONCLUDED") throw err("INVALID_TRANSITION", "Договор не заключён или прекращён");
    const ed = new Date(i.eventDate + "T12:00:00+03:00");
    if (ed < p.startsAt || ed > p.endsAt) throw err("VALIDATION", "Дата события вне срока действия защиты", { fields: [{ path: "eventDate", message: "Вне периода покрытия" }] });
    const c = await tx.claim.create({ data: { number: claimNumber(), policyId: p.id, clientId: p.clientId, agencyOrgId: p.agencyOrgId, carrierOrgId: p.carrierOrgId, type: "CLASSIC", status: "DRAFT", eventDate: ed, description: i.description.slice(0, 4000), answers: i.answers, requiredDocs: REQUIRED_DOCS[p.productCode] ?? [], assigneeId: p.servicingAgentId } });
    await event(tx, c.id, "created", ctx.user.id);
    await ensureConversation(tx, { contextType: "CLAIM", contextId: c.id, clientId: p.clientId, agencyOrgId: p.agencyOrgId, title: `Обращение ${c.number}` });
    await audit(tx, actor(ctx), "claim.create", "Claim", c.id);
    return c;
  });
}

export async function submitClaim(ctx: Ctx, claimId: string) {
  const t = await now();
  return txRetry(async (tx) => {
    await lockRow(tx, "Claim", claimId);
    const c = await tx.claim.findFirst({ where: { id: claimId, clientId: ctx.user.id } });
    if (!c) throw err("NOT_FOUND", "Обращение не найдено");
    const upd = await setStatus(tx, c.id, "SUBMITTED", "CLIENT", ctx.user.id, c.status === "NEEDS_INFO" ? "Клиент дополнил сведения" : undefined, { slaDueAt: c.slaDueAt ?? new Date(t.getTime() + 15 * 86400_000) });
    if (c.agencyOrgId) await notifyOrg(tx, c.agencyOrgId, { type: "claim.submitted", title: "Клиент подал обращение", body: c.number, link: `/a/claims/${c.id}` });
    return upd;
  });
}

type StaffAction = "START_REVIEW" | "REQUEST_INFO" | "PREPARE_APPROVE" | "PREPARE_REJECT" | "APPROVE" | "REJECT" | "CLOSE" | "REOPEN";

/** Действия сотрудников по обращению. Отказ — только представителем страховщика с объяснением. */
export async function staffClaimAction(ctx: Ctx, claimId: string, action: StaffAction, i: { note?: string; amountKop?: number }) {
  const role = machineRole(ctx);
  return txRetry(async (tx) => {
    await lockRow(tx, "Claim", claimId);
    const c = await tx.claim.findUnique({ where: { id: claimId } });
    if (!c) throw err("NOT_FOUND", "Обращение не найдено");
    if ((role === "AGENT" || role === "OWNER") && c.agencyOrgId !== ctx.org?.orgId) throw err("NOT_FOUND", "Обращение не найдено");
    if (role === "CARRIER" && c.carrierOrgId !== ctx.org?.orgId) throw err("NOT_FOUND", "Обращение не найдено");
    const by = role === "OWNER" ? "AGENT" : role;
    const note = i.note?.trim();
    switch (action) {
      case "START_REVIEW": return setStatus(tx, c.id, "REVIEWING", by, ctx.user.id, note);
      case "REQUEST_INFO": {
        if (!note) throw err("VALIDATION", "Укажите, какие сведения нужны");
        const u = await setStatus(tx, c.id, "NEEDS_INFO", by, ctx.user.id, note);
        await notify(tx, c.clientId, { type: "claim.needs_info", title: "Нужны дополнительные сведения", body: note, link: `/c/claims/${c.id}`, email: true });
        return u;
      }
      case "PREPARE_APPROVE": return setStatus(tx, c.id, "DECISION_PREPARED", by, ctx.user.id, note ?? "Подготовлено решение об одобрении", { decision: "APPROVE_DRAFT", decisionReason: note });
      case "PREPARE_REJECT": {
        if (!note || note.length < 20) throw err("VALIDATION", "Отказ требует развёрнутого объяснения (не короче 20 символов)");
        return setStatus(tx, c.id, "DECISION_PREPARED", by, ctx.user.id, note, { decision: "REJECT_DRAFT", decisionReason: note });
      }
      case "APPROVE": {
        if (role !== "CARRIER") throw err("FORBIDDEN", "Решение принимает представитель страховщика");
        if (c.type === "CLASSIC" && (!i.amountKop || i.amountKop <= 0)) throw err("VALIDATION", "Укажите сумму выплаты");
        const u = await setStatus(tx, c.id, "APPROVED", "CARRIER", ctx.user.id, note ?? c.decisionReason ?? undefined, { decision: "APPROVED", decisionBy: ctx.user.id, decisionReason: note ?? c.decisionReason });
        await notify(tx, c.clientId, { type: "claim.decision", title: "Решение: одобрено", body: note ?? "Обращение одобрено страховщиком", link: `/c/claims/${c.id}`, email: true });
        await initiatePayout(tx, c.id, c.eventCheckId ?? `claim:${c.id}`, c.type === "CLASSIC" ? i.amountKop : undefined);
        if (c.eventCheckId) await tx.eventCheck.updateMany({ where: { id: c.eventCheckId, status: { in: ["SPECIALIST_REVIEW", "NEEDS_DATA"] } }, data: { status: "COMPLETED", result: "MET" } });
        return u;
      }
      case "REJECT": {
        if (role !== "CARRIER") throw err("FORBIDDEN", "Отказ выносит только уполномоченный представитель страховщика");
        const reason = note ?? c.decisionReason;
        if (!reason || reason.length < 20) throw err("VALIDATION", "Отказ требует объяснения");
        const u = await setStatus(tx, c.id, "REJECTED", "CARRIER", ctx.user.id, reason, { decision: "REJECTED", decisionBy: ctx.user.id, decisionReason: reason });
        if (c.eventCheckId) await tx.eventCheck.updateMany({ where: { id: c.eventCheckId }, data: { status: "COMPLETED", result: "NOT_MET" } });
        await notify(tx, c.clientId, { type: "claim.decision", title: "Решение по обращению", body: `Отказ: ${reason}. Вы можете оспорить решение.`, link: `/c/claims/${c.id}`, email: true });
        return u;
      }
      case "CLOSE": return setStatus(tx, c.id, "CLOSED", by, ctx.user.id, note);
      case "REOPEN": return setStatus(tx, c.id, "REVIEWING", by, ctx.user.id, note);
    }
  });
}

/** Спор клиента: по решению обращения или по результату параметрической проверки. */
export async function openDispute(ctx: Ctx, i: { claimId?: string; policyId?: string; reason: string }) {
  if (i.reason.trim().length < 10) throw err("VALIDATION", "Опишите причину возражения");
  const t = await now();
  return txRetry(async (tx) => {
    let c = i.claimId ? await tx.claim.findFirst({ where: { id: i.claimId, clientId: ctx.user.id } }) : null;
    if (!c && i.policyId) {
      const p = await tx.policy.findFirst({ where: { id: i.policyId, clientId: ctx.user.id } });
      const ec = p ? await tx.eventCheck.findUnique({ where: { policyId: p.id } }) : null;
      if (!p || !ec || !ec.result) throw err("NOT_FOUND", "Нет результата проверки для возражения");
      c = await tx.claim.findFirst({ where: { eventCheckId: ec.id } });
      if (!c) {
        c = await tx.claim.create({ data: { number: claimNumber(), policyId: p.id, clientId: p.clientId, agencyOrgId: p.agencyOrgId, carrierOrgId: p.carrierOrgId, type: "PARAMETRIC", status: "SUBMITTED", carrierStatus: "RECEIVED", eventCheckId: ec.id, description: "Возражение по результату проверки события" } });
        await ensureConversation(tx, { contextType: "CLAIM", contextId: c.id, clientId: p.clientId, agencyOrgId: p.agencyOrgId, title: `Обращение ${c.number}` });
        await setStatus(tx, c.id, "REVIEWING", "SYSTEM", null, "Возражение клиента");
        await tx.claim.update({ where: { id: c.id }, data: { disputeReason: i.reason } });
        await raiseException(tx, { type: "DISPUTE", entityType: "Claim", entityId: c.id, reason: `Возражение по результату проверки: ${i.reason.slice(0, 200)}`, nextAction: "Рассмотреть основания и доказательства", dueAt: new Date(t.getTime() + 10 * 86400_000), dedupeKey: `dispute:${c.id}` });
        return tx.claim.findUniqueOrThrow({ where: { id: c.id } });
      }
    }
    if (!c) throw err("NOT_FOUND", "Обращение не найдено");
    const u = await setStatus(tx, c.id, "DISPUTED", "CLIENT", ctx.user.id, i.reason, { disputeReason: i.reason });
    await raiseException(tx, { type: "DISPUTE", entityType: "Claim", entityId: c.id, reason: `Спор по обращению ${c.number}: ${i.reason.slice(0, 200)}`, nextAction: "Рассмотреть спор, ответить клиенту с обоснованием", dueAt: new Date(t.getTime() + 10 * 86400_000), dedupeKey: `dispute:${c.id}:${Date.now()}` });
    return u;
  });
}
