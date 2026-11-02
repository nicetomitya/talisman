import { db, txRetry, type Tx } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, type Ctx } from "../access";
import { now } from "../clock";
import { assertTransition } from "../state/machines";
import { DEMO_RULES } from "../config";
import { enqueue } from "../jobs";
import { notifyOrg } from "./notify";
import { adapters } from "../adapters";
import { lockRow } from "./requests";

const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };

/**
 * Право на новые ответы. Новый ответ считается один раз на заявку и агентство за период;
 * исправления и технические повторы не расходуют лимит; сверхлимит блокируется без скрытых списаний.
 * Ограниченная подписка блокирует новые ответы, но не обслуживание (AC25).
 */
export async function assertCanRespond(tx: Tx, orgId: string, requestId: string, t: Date) {
  let sub = await tx.subscription.findUnique({ where: { organizationId: orgId } });
  if (!sub) throw err("SUBSCRIPTION_RESTRICTED", "У агентства нет подписки");
  sub = await syncSubscription(tx, sub.id, t);
  if (sub.status === "RESTRICTED" || sub.status === "ENDED") throw err("SUBSCRIPTION_RESTRICTED", "Подписка ограничена: новые ответы недоступны, обслуживание действующих клиентов сохраняется");
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: sub.planId } });
  const already = await tx.responseUsage.findUnique({ where: { organizationId_requestId_periodStart: { organizationId: orgId, requestId, periodStart: sub.periodStart } } });
  if (!already) {
    const used = await tx.responseUsage.count({ where: { organizationId: orgId, periodStart: sub.periodStart } });
    if (used >= plan.maxResponses) throw err("LIMIT_EXCEEDED", `Лимит тарифа «${plan.title}» — ${plan.maxResponses} новых ответов за период — исчерпан. Смените тариф.`);
  }
  return { periodStart: sub.periodStart, plan, sub };
}

export async function recordResponseUsage(tx: Tx, orgId: string, requestId: string, periodStart: Date) {
  await tx.responseUsage.createMany({ data: [{ organizationId: orgId, requestId, periodStart }], skipDuplicates: true });
}

export async function planAllows(tx: Tx | typeof db, orgId: string, feature: "autoReply" | "roles" | "analytics") {
  const sub = await tx.subscription.findUnique({ where: { organizationId: orgId } });
  if (!sub) return false;
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: sub.planId } });
  return !!(plan.features as any)[feature];
}

/** Переходы подписки по серверному (демо) времени. Вызывается worker-ом и лениво при проверках. */
export async function syncSubscription(tx: Tx, subId: string, t: Date) {
  let sub = await tx.subscription.findUniqueOrThrow({ where: { id: subId } });
  for (let guard = 0; guard < 4; guard++) {
    if ((sub.status === "ACTIVE" || sub.status === "TRIAL") && sub.periodEnd <= t) {
      if (sub.cancelAtPeriodEnd) {
        assertTransition("subscription", sub.status, "ENDED", "SYSTEM");
        sub = await tx.subscription.update({ where: { id: sub.id }, data: { status: "ENDED", version: { increment: 1 } } });
        await notifyOrg(tx, sub.organizationId, { type: "subscription.ended", title: "Подписка завершена", body: "Автопродление было отменено. Новые ответы недоступны; сопровождение действующих клиентов сохраняется.", link: "/a/subscription", dedupeKey: `sub.ended:${sub.id}:${sub.periodEnd.getTime()}` });
        continue;
      }
      const inv = await openRenewalInvoice(tx, sub);
      assertTransition("subscription", sub.status, "PAST_DUE", "SYSTEM");
      sub = await tx.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE", graceUntil: new Date(sub.periodEnd.getTime() + DEMO_RULES.graceDays * 86400_000), version: { increment: 1 } } });
      if (sub.autoRenew && sub.autoRenewConsentAt) await enqueue(tx, "subscription.autocharge", { invoiceId: inv.id }, { uniqueKey: `autocharge:${inv.id}:${inv.attempts}` });
      await notifyOrg(tx, sub.organizationId, { type: "subscription.due", title: "Требуется оплата подписки", body: `Период закончился. Льготный период до ${sub.graceUntil!.toLocaleDateString("ru-RU")}.`, link: "/a/subscription", dedupeKey: `sub.due:${inv.id}` });
      continue;
    }
    if (sub.status === "PAST_DUE") {
      const failed = await tx.subscriptionInvoice.findFirst({ where: { subscriptionId: sub.id, status: { in: ["OPEN", "FAILED"] }, attempts: { gt: 0 } } });
      if (failed || !sub.autoRenew) {
        assertTransition("subscription", "PAST_DUE", "GRACE", "SYSTEM");
        sub = await tx.subscription.update({ where: { id: sub.id }, data: { status: "GRACE", version: { increment: 1 } } });
        continue;
      }
    }
    if ((sub.status === "GRACE" || sub.status === "PAST_DUE") && sub.graceUntil && sub.graceUntil <= t) {
      if (sub.status === "PAST_DUE") { sub = await tx.subscription.update({ where: { id: sub.id }, data: { status: "GRACE", version: { increment: 1 } } }); }
      assertTransition("subscription", "GRACE", "RESTRICTED", "SYSTEM");
      sub = await tx.subscription.update({ where: { id: sub.id }, data: { status: "RESTRICTED", version: { increment: 1 } } });
      await notifyOrg(tx, sub.organizationId, { type: "subscription.restricted", title: "Подписка ограничена", body: "Новые ответы и автоматические продажи заблокированы. Доступ к действующим полисам, переписке и обслуживанию клиентов сохранён.", link: "/a/subscription", dedupeKey: `sub.restricted:${sub.id}:${sub.graceUntil?.getTime()}` });
      await audit(tx, { role: "SYSTEM" }, "subscription.restricted", "Subscription", sub.id);
      continue;
    }
    break;
  }
  return sub;
}

async function openRenewalInvoice(tx: Tx, sub: { id: string; organizationId: string; planId: string; nextPlanId: string | null; periodEnd: Date }) {
  const planId = sub.nextPlanId ?? sub.planId;
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: planId } });
  const existing = await tx.subscriptionInvoice.findUnique({ where: { subscriptionId_periodStart: { subscriptionId: sub.id, periodStart: sub.periodEnd } } });
  if (existing) return existing;
  return tx.subscriptionInvoice.create({ data: { subscriptionId: sub.id, organizationId: sub.organizationId, planId, periodStart: sub.periodEnd, periodEnd: addMonths(sub.periodEnd, 1), amountKop: plan.priceKop } });
}

/** Владелец оплачивает счёт: создаётся внешняя оплата у SaaS-провайдера; период продлевается только по вебхуку/сверке. */
export async function payInvoice(ctx: Ctx & { orgId: string }, invoiceId: string, idempotencyKey: string) {
  const inv = await db.subscriptionInvoice.findFirst({ where: { id: invoiceId, organizationId: ctx.orgId } });
  if (!inv) throw err("NOT_FOUND", "Счёт не найден");
  if (inv.status === "PAID") throw err("ALREADY_DONE", "Счёт уже оплачен");
  const live = await db.payment.findFirst({ where: { invoiceId: inv.id, status: { in: ["PENDING", "UNKNOWN", "SUCCEEDED"] } } });
  if (live) return { paymentId: live.id, confirmationUrl: `/demo/pay/${live.externalId}`, existing: true };
  const amount = inv.amountKop - inv.discountKop;
  const p = await db.payment.create({ data: { purpose: "SUBSCRIPTION", provider: "DEMO_SAAS_PAY", externalId: `pending:${idempotencyKey}`, payerOrgId: ctx.orgId, recipientLabel: "Платформа «Талисман» (подписка)", amountKop: amount, invoiceId: inv.id, idempotencyKey: `saas:${ctx.orgId}:${idempotencyKey}` } });
  const ext = await adapters.payment.createPayment({ purpose: "SUBSCRIPTION", amountKop: amount, currency: "RUB", reference: `invoice:${inv.id}`, idempotencyKey: p.idempotencyKey });
  await db.payment.update({ where: { id: p.id }, data: { externalId: ext.externalId, status: "PENDING" } });
  await db.paymentStatusHistory.create({ data: { paymentId: p.id, from: "CREATED", to: "PENDING", source: "create" } });
  await db.subscriptionInvoice.update({ where: { id: inv.id }, data: { attempts: { increment: 1 } } });
  return { paymentId: p.id, confirmationUrl: ext.confirmationUrl };
}

/** Применение успешной оплаты счёта — ровно один раз (AC24: повтор события не продлевает период дважды). */
export async function onInvoicePaid(tx: Tx, invoiceId: string, t: Date) {
  const res = await tx.subscriptionInvoice.updateMany({ where: { id: invoiceId, status: { not: "PAID" } }, data: { status: "PAID", paidAt: t } });
  if (res.count === 0) return { alreadyApplied: true };
  const inv = await tx.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  await lockRow(tx, "Subscription", inv.subscriptionId);
  const sub = await tx.subscription.findUniqueOrThrow({ where: { id: inv.subscriptionId } });
  if (inv.promoId) await tx.$executeRaw`UPDATE "Promo" SET "reservedKop" = "reservedKop" - ${inv.discountKop}, "usedKop" = "usedKop" + ${inv.discountKop} WHERE "id" = ${inv.promoId}::uuid`;
  assertTransition("subscription", sub.status, "ACTIVE", "SYSTEM");
  const isCurrentOrNext = inv.periodStart.getTime() >= sub.periodStart.getTime();
  await tx.subscription.update({ where: { id: sub.id }, data: {
    status: "ACTIVE", planId: inv.planId, nextPlanId: sub.nextPlanId === inv.planId ? null : sub.nextPlanId, graceUntil: null,
    periodStart: isCurrentOrNext ? inv.periodStart : sub.periodStart, periodEnd: isCurrentOrNext ? inv.periodEnd : sub.periodEnd, version: { increment: 1 } } });
  await audit(tx, { role: "SYSTEM" }, "subscription.renewed", "Subscription", sub.id, { after: { periodStart: inv.periodStart, periodEnd: inv.periodEnd } });
  await notifyOrg(tx, sub.organizationId, { type: "subscription.paid", title: "Подписка оплачена", body: `Период до ${inv.periodEnd.toLocaleDateString("ru-RU")}`, link: "/a/subscription", dedupeKey: `sub.paid:${inv.id}` });
  return { alreadyApplied: false };
}

export async function onInvoiceFailed(tx: Tx, invoiceId: string, t: Date) {
  const inv = await tx.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.status === "PAID") return;
  const delays = DEMO_RULES.retryPaymentHours;
  const next = inv.attempts <= delays.length ? new Date(t.getTime() + delays[Math.min(inv.attempts, delays.length) - 1 >= 0 ? Math.min(inv.attempts, delays.length) - 1 : 0] * 3600_000) : null;
  await tx.subscriptionInvoice.update({ where: { id: inv.id }, data: { status: "FAILED", nextRetryAt: next } });
  const sub = await tx.subscription.findUniqueOrThrow({ where: { id: inv.subscriptionId } });
  if (sub.status === "PAST_DUE") await tx.subscription.update({ where: { id: sub.id }, data: { status: "GRACE", version: { increment: 1 } } });
  if (next && sub.autoRenew) await enqueue(tx, "subscription.autocharge", { invoiceId: inv.id }, { runAt: next, uniqueKey: `autocharge:${inv.id}:${inv.attempts}` });
  await notifyOrg(tx, sub.organizationId, { type: "subscription.failed", title: "Оплата подписки не прошла", body: next ? `Повторная попытка ${next.toLocaleString("ru-RU")}. До окончания льготного периода новые ответы доступны.` : "Оплатите счёт вручную.", link: "/a/subscription" });
}

/** Автосписание по токену метода (эмулятор: сохранённая «карта» SaaS-провайдера, поведение задаётся демопанелью). */
export async function autoCharge(invoiceId: string) {
  const inv = await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.status === "PAID") return { skipped: true };
  const behavior = ((await db.setting.findUnique({ where: { key: `saas_card:${inv.organizationId}` } }))?.value as any)?.behavior ?? "success";
  const key = `saas:auto:${inv.id}:${inv.attempts + 1}`;
  const amount = inv.amountKop - inv.discountKop;
  const p = await db.payment.upsert({ where: { idempotencyKey: key }, update: {}, create: { purpose: "SUBSCRIPTION", provider: "DEMO_SAAS_PAY", externalId: `pending:${key}`, payerOrgId: inv.organizationId, recipientLabel: "Платформа «Талисман» (подписка)", amountKop: amount, invoiceId: inv.id, idempotencyKey: key } });
  const ext = await adapters.payment.createPayment({ purpose: "SUBSCRIPTION", amountKop: amount, currency: "RUB", reference: `invoice:${inv.id}`, idempotencyKey: key });
  await db.payment.update({ where: { id: p.id }, data: { externalId: ext.externalId, status: "PENDING" } });
  await db.subscriptionInvoice.update({ where: { id: inv.id }, data: { attempts: { increment: 1 } } });
  const { emulatorPayerAction } = await import("../adapters/payment");
  await emulatorPayerAction(ext.externalId, behavior === "fail" ? "fail" : "success");
  return { charged: behavior };
}

export async function cancelAutoRenew(ctx: Ctx & { orgId: string }) {
  return txRetry(async (tx) => {
    const sub = await tx.subscription.findUniqueOrThrow({ where: { organizationId: ctx.orgId } });
    const upd = await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true, autoRenew: false, version: { increment: 1 } } });
    await audit(tx, actor(ctx), "subscription.cancel_renewal", "Subscription", sub.id, { after: { accessUntil: sub.periodEnd } });
    return upd;
  });
}

export async function enableAutoRenew(ctx: Ctx & { orgId: string }, confirm: boolean) {
  if (!confirm) throw err("VALIDATION", "Автопродление требует отдельного подтверждения");
  const t = await now();
  return txRetry(async (tx) => {
    const sub = await tx.subscription.findUniqueOrThrow({ where: { organizationId: ctx.orgId } });
    const upd = await tx.subscription.update({ where: { id: sub.id }, data: { autoRenew: true, autoRenewConsentAt: t, cancelAtPeriodEnd: false, version: { increment: 1 } } });
    await audit(tx, actor(ctx), "subscription.enable_renewal", "Subscription", sub.id);
    return upd;
  });
}

/** Смена плана — со следующего периода (P0), без пропорционального перерасчёта. */
export async function changePlan(ctx: Ctx & { orgId: string }, planCode: string) {
  const plan = await db.plan.findUnique({ where: { code: planCode } });
  if (!plan) throw err("NOT_FOUND", "Тариф не найден");
  return txRetry(async (tx) => {
    const sub = await tx.subscription.findUniqueOrThrow({ where: { organizationId: ctx.orgId } });
    const members = await tx.membership.count({ where: { organizationId: ctx.orgId, status: "ACTIVE" } });
    if (members > plan.maxUsers) throw err("LIMIT_EXCEEDED", `В тарифе «${plan.title}» до ${plan.maxUsers} пользователей, в команде ${members}`);
    const upd = await tx.subscription.update({ where: { id: sub.id }, data: { nextPlanId: plan.id === sub.planId ? null : plan.id, version: { increment: 1 } } });
    await tx.subscriptionInvoice.updateMany({ where: { subscriptionId: sub.id, status: { in: ["OPEN", "FAILED"] }, periodStart: { gte: sub.periodEnd } }, data: { planId: plan.id, amountKop: plan.priceKop } });
    await audit(tx, actor(ctx), "subscription.change_plan", "Subscription", sub.id, { after: { nextPlan: plan.code, from: sub.periodEnd } });
    return upd;
  });
}

/** Промокод на SaaS-подписку: резерв бюджета транзакционно (CHECK-ограничение не даёт выйти за бюджет). */
export async function applyPromo(ctx: Ctx & { orgId: string }, invoiceId: string, code: string) {
  const t = await now();
  return txRetry(async (tx) => {
    const inv = await tx.subscriptionInvoice.findFirst({ where: { id: invoiceId, organizationId: ctx.orgId } });
    if (!inv || inv.status === "PAID") throw err("NOT_FOUND", "Счёт не найден или оплачен");
    if (inv.promoId) throw err("ALREADY_DONE", "Промокод уже применён");
    const promo = await tx.promo.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!promo || !promo.enabled || promo.appliesTo !== "SAAS_SUBSCRIPTION" || promo.validFrom > t || promo.validTo < t) throw err("NOT_FOUND", "Промокод недействителен");
    const discount = Math.min(promo.discountKop, inv.amountKop - 100);
    const reserved = await tx.$executeRaw`UPDATE "Promo" SET "reservedKop" = "reservedKop" + ${discount}, "uses" = "uses" + 1, "version" = "version" + 1
      WHERE "id" = ${promo.id}::uuid AND "reservedKop" + "usedKop" + ${discount} <= "budgetKop" AND "uses" < "maxUses"`;
    if (reserved !== 1) throw err("LIMIT_EXCEEDED", "Бюджет или лимит применений промокода исчерпан");
    await audit(tx, actor(ctx), "promo.applied", "SubscriptionInvoice", inv.id, { after: { code: promo.code, discount } });
    return tx.subscriptionInvoice.update({ where: { id: inv.id }, data: { promoId: promo.id, discountKop: discount } });
  });
}

export async function startTrial(tx: Tx, orgId: string, planCode = "START", t: Date) {
  const plan = await tx.plan.findUniqueOrThrow({ where: { code: planCode } });
  return tx.subscription.create({ data: { organizationId: orgId, planId: plan.id, status: "TRIAL", periodStart: t, periodEnd: new Date(t.getTime() + DEMO_RULES.trialDays * 86400_000) } });
}

export async function tickSubscriptions() {
  const t = await now();
  const subs = await db.subscription.findMany({ where: { OR: [{ status: { in: ["ACTIVE", "TRIAL"] }, periodEnd: { lte: t } }, { status: { in: ["PAST_DUE", "GRACE"] } }] } });
  for (const s of subs) await txRetry(async (tx) => { await lockRow(tx, "Subscription", s.id); await syncSubscription(tx, s.id, t); });
  return { checked: subs.length };
}
