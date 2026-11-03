import { randomUUID } from "node:crypto";
import { db, txRetry, type Tx } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, type Ctx } from "../access";
import { now } from "../clock";
import { assertTransition } from "../state/machines";
import { DEMO_RULES } from "../config";
import { enqueue } from "../jobs";
import { notify, notifyOrg, notifyPlatformRole } from "./notify";
import { lockRow, releaseCheckout } from "./requests";
import { assertAgencyMayQuote } from "./auction";
import { adapters } from "../adapters";
import { generateDocument, shareWithAgency } from "./documents";
import { hashCode, sha256, safeEqual } from "../auth/crypto";
import { rateLimit } from "../auth/ratelimit";
import { buildTemplates, policyTemplate } from "./templates";
import { raiseException } from "./exceptions";
import { accrueCommissions } from "./commissions";
import { schemaFor } from "./catalog";
import { allFields } from "./forms";
import { scheduleEventCheck } from "./events";
import { ensureConversation } from "./messaging";

const REQUIRED_ACK = ["OFFER", "RULES", "INDIVIDUAL_TERMS", "APPLICATION"];

export async function getOwnCheckout(tx: Tx | typeof db, ctx: Ctx, id: string) {
  const c = await tx.checkout.findFirst({ where: { id, clientId: ctx.user.id } });
  if (!c) throw err("NOT_FOUND", "Оформление не найдено");
  return c;
}

/**
 * Выбор предложения. Атомарно: актуальность заявки и предложения, полномочия, срок цены, ёмкость страховщика.
 * Один запрос — не более одного активного резерва (блокировка строки заявки + частичный UNIQUE) (AC08, AC10).
 * Цена берётся из серверной котировки.
 */
export async function selectQuote(ctx: Ctx, i: { requestId: string; requestVersion: number; quoteId: string; quoteVersion: number; reason?: string }) {
  return txRetry(async (tx) => {
    await lockRow(tx, "InsuranceRequest", i.requestId);
    const t = await now();
    const r = await tx.insuranceRequest.findFirst({ where: { id: i.requestId, clientId: ctx.user.id } });
    if (!r) throw err("NOT_FOUND", "Заявка не найдена");
    const active = await tx.checkout.findFirst({ where: { requestId: r.id, status: { notIn: ["CANCELLED"] } } });
    if (active) throw err("ALREADY_DONE", "По заявке уже есть активный выбор", { checkoutId: active.id, status: active.status });
    if (r.currentVersion !== i.requestVersion) throw err("VERSION_CHANGED", "Заявка изменилась — выберите из актуальных предложений");
    if (!["OPEN", "SELECTION"].includes(r.status)) throw err("INVALID_TRANSITION", "Заявка сейчас не допускает выбор");
    await lockRow(tx, "Quote", i.quoteId);
    const q = await tx.quote.findFirst({ where: { id: i.quoteId, requestId: r.id } });
    if (!q) throw err("NOT_FOUND", "Предложение не найдено");
    if (q.seq !== i.quoteVersion) throw err("VERSION_CHANGED", "Предложение обновилось — проверьте новую версию", { currentSeq: q.seq });
    if (q.requestVersion !== r.currentVersion) throw err("QUOTE_EXPIRED", "Предложение относится к прежней версии заявки");
    if (q.status !== "PUBLISHED") throw err("QUOTE_EXPIRED", q.status === "WITHDRAWN" ? "Предложение отозвано" : q.status === "REPLACED" ? "Предложение заменено новой версией" : "Предложение недоступно");
    if (q.expiresAt <= t) { await tx.quote.update({ where: { id: q.id }, data: { status: "EXPIRED" } }); throw err("QUOTE_EXPIRED", "Срок действия цены истёк — запросите подтверждение"); }
    if (q.isPreliminary) throw err("VALIDATION", "Предварительную оценку нельзя оформить");
    if (q.agencyOrgId) await assertAgencyMayQuote(tx, q.agencyOrgId, q.productId, t);
    const product = await tx.product.findUniqueOrThrow({ where: { id: q.productId } });
    if (product.status !== "PUBLISHED") throw err("SALES_SUSPENDED", "Продажи продукта приостановлены");
    const { assertSalesAllowed } = await import("./catalog");
    await assertSalesAllowed(tx, { carrierOrgId: q.carrierOrgId, productCode: r.productCode, territory: r.territory });
    const cap = await tx.$executeRaw`UPDATE "CapacityPool" SET "reservedCount" = "reservedCount" + 1, "version" = "version" + 1
      WHERE "carrierOrgId" = ${q.carrierOrgId}::uuid AND "productCode" = ${r.productCode} AND "reservedCount" + "usedCount" < "limitCount"`;
    if (cap !== 1) throw err("CAPACITY_EXHAUSTED", "Страховая ёмкость страховщика по продукту исчерпана");
    assertTransition("quote", "PUBLISHED", "SELECTED", "CLIENT");
    await tx.quote.update({ where: { id: q.id }, data: { status: "SELECTED", version: { increment: 1 } } });
    // Матч: подбор закрывается окончательно, остальные предложения перестают действовать,
    // их агентства получают нейтральное уведомление без данных клиента и теряют доступ к заявке.
    const auction = await tx.auction.findFirst({ where: { requestId: r.id, requestVersion: r.currentVersion } });
    if (auction && auction.status !== "CLOSED") {
      assertTransition("auction", auction.status, "CLOSED", "SYSTEM");
      await tx.auction.update({ where: { id: auction.id }, data: { status: "CLOSED", closedAt: t, version: { increment: 1 } } });
    }
    const others = await tx.quote.findMany({ where: { requestId: r.id, id: { not: q.id }, status: { in: ["DRAFT", "PUBLISHED"] } } });
    for (const o of others) {
      await tx.quote.update({ where: { id: o.id }, data: { status: "EXPIRED", withdrawReason: "Клиент выбрал другое предложение", version: { increment: 1 } } });
      await tx.quoteEvent.create({ data: { quoteId: o.id, type: "NOT_SELECTED" } });
    }
    for (const orgId of new Set(others.map((o) => o.agencyOrgId).filter((x): x is string => !!x && x !== q.agencyOrgId))) {
      await notifyOrg(tx, orgId, { type: "request.matched_other", title: "Клиент выбрал другое предложение", body: `${r.title}: подбор завершён. Данные клиента не передаются, заявка закрыта для вашего агентства.`, link: "/a", dedupeKey: `matched_other:${r.id}:${r.currentVersion}:${orgId}` });
    }
    assertTransition("request", r.status, "CHECKOUT", "CLIENT");
    await tx.insuranceRequest.update({ where: { id: r.id }, data: { status: "CHECKOUT", version: { increment: 1 } } });
    const rv = await tx.requestVersion.findUniqueOrThrow({ where: { requestId_version: { requestId: r.id, version: r.currentVersion } } });
    const reservationExpiresAt = new Date(t.getTime() + DEMO_RULES.reservationMin * 60_000);
    const policyNumber = `TLS-DEMO-${t.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const c = await tx.checkout.create({
      data: { requestId: r.id, requestVersion: r.currentVersion, quoteId: q.id, quoteSeq: q.seq, clientId: ctx.user.id, agencyOrgId: q.agencyOrgId, carrierOrgId: q.carrierOrgId, status: "RESERVED", reservationExpiresAt, selectionReason: i.reason?.slice(0, 300) ?? null,
        snapshot: { requestVersion: r.currentVersion, requestFingerprint: rv.fingerprint, requestData: rv.data as any, quote: { id: q.id, seq: q.seq, premiumKop: q.premiumKop, feesKop: q.feesKop, discountKop: q.discountKop, totalKop: q.totalKop, terms: q.terms, tariffVersionId: q.tariffVersionId, fingerprint: q.coverageFingerprint }, policyNumber, productId: q.productId, productCode: r.productCode } },
    });
    await enqueue(tx, "checkout.expire", { checkoutId: c.id }, { runAt: reservationExpiresAt, uniqueKey: `checkout.expire:${c.id}` });
    for (const m of DEMO_RULES.matchRemindMin) await enqueue(tx, "checkout.remind", { checkoutId: c.id, minutesLeft: m }, { runAt: new Date(reservationExpiresAt.getTime() - m * 60_000), uniqueKey: `checkout.remind:${c.id}:${m}` });
    if (q.agencyOrgId) {
      const uploads = await tx.document.findMany({ where: { requestId: r.id, kind: "UPLOAD", status: "CLEAN" } });
      await shareWithAgency(tx, { userId: ctx.user.id }, uploads.map((d) => d.id), q.agencyOrgId, "Клиент выбрал предложение агентства");
      await ensureConversation(tx, { contextType: "CHECKOUT", contextId: c.id, clientId: ctx.user.id, agencyOrgId: q.agencyOrgId, title: `Сделка: ${r.title}` });
      await notifyOrg(tx, q.agencyOrgId, { type: "quote.selected", title: "У вас матч: клиент выбрал ваше предложение", body: `${r.title}. Чат с клиентом открыт. Резерв цены до ${reservationExpiresAt.toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`, link: `/a/deals/${c.id}` });
    }
    await audit(tx, actor(ctx), "checkout.reserved", "Checkout", c.id, { after: { quoteId: q.id, seq: q.seq, totalKop: q.totalKop, reservationExpiresAt } });
    return { checkout_id: c.id, reservation_expires_at: reservationExpiresAt.toISOString(), status: c.status };
  });
}

/** Финальная котировка у страховщика (сетевой вызов вне транзакции) и формирование демонстрационного комплекта. */
export async function prepareDocuments(ctx: Ctx, checkoutId: string) {
  const c0 = await getOwnCheckout(db, ctx, checkoutId);
  if (c0.status !== "RESERVED") throw err("INVALID_TRANSITION", "Документы уже сформированы или оформление закрыто");
  await assertNotStale(db, c0);
  await txRetry(async (tx) => {
    await lockRow(tx, "Checkout", c0.id);
    const c = await tx.checkout.findUniqueOrThrow({ where: { id: c0.id } });
    assertTransition("checkout", c.status, "CHECKING", "CLIENT");
    await tx.checkout.update({ where: { id: c.id }, data: { status: "CHECKING", version: { increment: 1 } } });
  });
  const snap = c0.snapshot as any;
  let fq;
  try {
    fq = await adapters.carrier.finalQuote({ quoteId: c0.quoteId, seq: c0.quoteSeq, carrierOrgId: c0.carrierOrgId, productCode: snap.productCode, premiumKop: snap.quote.premiumKop, tariffVersionId: snap.quote.tariffVersionId, requestFingerprint: snap.requestFingerprint });
  } catch (e: any) {
    await txRetry(async (tx) => {
      await tx.checkout.update({ where: { id: c0.id }, data: { status: "RESERVED", version: { increment: 1 } } });
      await raiseException(tx, { type: "CHECKOUT", entityType: "Checkout", entityId: c0.id, reason: `Страховщик не ответил на запрос окончательного предложения: ${e.message}`, nextAction: "Повторить запрос или связаться со страховщиком", dueAt: new Date((await now()).getTime() + 3600_000), dedupeKey: `finalquote:${c0.id}` });
    });
    throw err("SOURCE_UNAVAILABLE", "Страховщик временно не отвечает. Резерв сохранён — повторите позже.");
  }
  return txRetry(async (tx) => {
    await lockRow(tx, "Checkout", c0.id);
    const c = await tx.checkout.findUniqueOrThrow({ where: { id: c0.id } });
    if (c.status !== "CHECKING") throw err("CONFLICT", "Состояние оформления изменилось");
    if (fq.premiumKop !== snap.quote.premiumKop) {
      await releaseCheckout(tx, c.id, "Страховщик изменил цену при окончательной проверке — нужна новая котировка и повторное согласие", "SYSTEM");
      await tx.quote.update({ where: { id: c.quoteId }, data: { status: "EXPIRED", withdrawReason: "Цена изменена страховщиком" } });
      return { status: "CANCELLED", reason: "price_changed" };
    }
    const docs = await buildTemplates(tx, c, fq.carrierQuoteId);
    for (const d of docs) await generateDocument(tx, d.template, { kind: d.kind, ownerUserId: c.clientId, checkoutId: c.id, createdById: null, seriesId: d.seriesId });
    assertTransition("checkout", "CHECKING", "DOCUMENTS", "SYSTEM");
    await tx.checkout.update({ where: { id: c.id }, data: { status: "DOCUMENTS", carrierFinalQuoteId: fq.carrierQuoteId, version: { increment: 1 } } });
    await audit(tx, actor(ctx), "checkout.documents_ready", "Checkout", c.id, { after: { carrierQuoteId: fq.carrierQuoteId } });
    await notify(tx, c.clientId, { type: "document.ready", title: "Документы готовы к ознакомлению", body: "Проверьте существенные условия, исключения и правила.", link: `/c/checkouts/${c.id}` });
    return { status: "DOCUMENTS" };
  });
}

/** Ознакомление фиксирует точную версию и хеш документа (AC11). */
export async function acknowledge(ctx: Ctx, checkoutId: string, documentId: string) {
  return txRetry(async (tx) => {
    await lockRow(tx, "Checkout", checkoutId);
    const c = await getOwnCheckout(tx, ctx, checkoutId);
    if (c.status !== "DOCUMENTS") throw err("INVALID_TRANSITION", "Ознакомление сейчас недоступно");
    const d = await tx.document.findFirst({ where: { id: documentId, checkoutId: c.id, supersededById: null } });
    if (!d) throw err("NOT_FOUND", "Документ не найден или заменён новой версией");
    const acks = { ...(c.acknowledgements as any), [d.kind]: { documentId: d.id, version: d.version, sha256: d.sha256, at: (await now()).toISOString(), sessionId: ctx.sessionId } };
    await tx.checkout.update({ where: { id: c.id }, data: { acknowledgements: acks, version: { increment: 1 } } });
    await audit(tx, actor(ctx), "checkout.acknowledged", "Document", d.id, { after: { kind: d.kind, sha256: d.sha256 } });
    return acks;
  });
}

async function currentAckState(tx: Tx | typeof db, c: { id: string; acknowledgements: any }) {
  const docs = await tx.document.findMany({ where: { checkoutId: c.id, supersededById: null, kind: { in: REQUIRED_ACK } } });
  const acks = c.acknowledgements as Record<string, any>;
  const missing = REQUIRED_ACK.filter((k) => { const d = docs.find((x) => x.kind === k); return !d || acks[k]?.documentId !== d.id || acks[k]?.sha256 !== d.sha256; });
  return { docs, missing };
}

/** Запрос одноразового кода. Код в БД — только HMAC; сам код — в приватной демопочте. */
export async function requestCode(ctx: Ctx, checkoutId: string) {
  await rateLimit(`otp:${ctx.user.id}`, 5, 600);
  return txRetry(async (tx) => {
    await lockRow(tx, "Checkout", checkoutId);
    const c = await getOwnCheckout(tx, ctx, checkoutId);
    await assertNotStale(tx, c);
    if (c.status !== "DOCUMENTS" && c.status !== "CLIENT_CONFIRMATION") throw err("INVALID_TRANSITION", "Подтверждение сейчас недоступно");
    const { docs, missing } = await currentAckState(tx, c);
    if (missing.length) throw err("NEEDS_INFO", "Ознакомьтесь со всеми документами комплекта", { missing });
    const t = await now();
    await tx.signatureSession.updateMany({ where: { checkoutId: c.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    const { code, method } = await adapters.signature.prepare();
    const sid = randomUUID();
    const s = await tx.signatureSession.create({ data: { id: sid, checkoutId: c.id, userId: ctx.user.id, sessionId: ctx.sessionId, docHashes: docs.map((d) => ({ id: d.id, kind: d.kind, version: d.version, sha256: d.sha256 })), codeHash: hashCode(code, sid), expiresAt: new Date(t.getTime() + DEMO_RULES.otpTtlMin * 60_000), maxAttempts: DEMO_RULES.otpMaxAttempts, method, deliveryInfo: { channel: "DEMO_MAILBOX", at: t.toISOString() } } });
    await adapters.messaging.email(tx, { userId: ctx.user.id, to: ctx.user.email, subject: "Демонстрационный код подтверждения", body: `Код: ${code}\nДействует ${DEMO_RULES.otpTtlMin} минут. Демонстрационный код не имеет юридической силы.`, category: "SERVICE" });
    if (c.status === "DOCUMENTS") { assertTransition("checkout", "DOCUMENTS", "CLIENT_CONFIRMATION", "CLIENT"); await tx.checkout.update({ where: { id: c.id }, data: { status: "CLIENT_CONFIRMATION", version: { increment: 1 } } }); }
    await audit(tx, actor(ctx), "signature.code_sent", "SignatureSession", s.id);
    return { signatureSessionId: s.id, expiresAt: s.expiresAt };
  });
}

/** Проверка кода: срок, лимит попыток, хеши документов. Затем подпись страховщика (эмулятор) → этап оплаты. */
export async function verifyCode(ctx: Ctx, checkoutId: string, code: string) {
  const res = await txRetry(async (tx) => {
    await lockRow(tx, "Checkout", checkoutId);
    const c = await getOwnCheckout(tx, ctx, checkoutId);
    if (c.status !== "CLIENT_CONFIRMATION") throw err("INVALID_TRANSITION", "Подтверждение сейчас недоступно");
    const t = await now();
    const s = await tx.signatureSession.findFirst({ where: { checkoutId: c.id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    if (!s) throw err("NOT_FOUND", "Запросите новый код");
    if (s.expiresAt < t) { await tx.signatureSession.update({ where: { id: s.id }, data: { status: "EXPIRED" } }); return { ok: false as const, reason: "Срок действия кода истёк — запросите новый" }; }
    if (s.attempts >= s.maxAttempts) return { ok: false as const, reason: "Превышено число попыток — запросите новый код" };
    const ok = safeEqual(hashCode(code.trim(), s.id), s.codeHash);
    if (!ok) {
      const attempts = s.attempts + 1;
      await tx.signatureSession.update({ where: { id: s.id }, data: { attempts, status: attempts >= s.maxAttempts ? "FAILED" : "PENDING" } });
      await audit(tx, actor(ctx), "signature.code_invalid", "SignatureSession", s.id, { after: { attempts } });
      return { ok: false as const, reason: `Неверный код. Осталось попыток: ${s.maxAttempts - attempts}` };
    }
    const { docs, missing } = await currentAckState(tx, c);
    const hashesNow = docs.map((d) => d.sha256).sort().join();
    const hashesSigned = (s.docHashes as any[]).map((d) => d.sha256).sort().join();
    if (missing.length || hashesNow !== hashesSigned) {
      await tx.signatureSession.update({ where: { id: s.id }, data: { status: "EXPIRED" } });
      assertTransition("checkout", "CLIENT_CONFIRMATION", "DOCUMENTS", "SYSTEM");
      await tx.checkout.update({ where: { id: c.id }, data: { status: "DOCUMENTS", version: { increment: 1 } } });
      return { ok: false as const, reason: "Документы изменились после ознакомления — нужно новое подтверждение" };
    }
    await tx.signatureSession.update({ where: { id: s.id }, data: { status: "VERIFIED", verifiedAt: t, attempts: s.attempts + 1 } });
    const ackT = policyTemplate("ACK", c, { signature: { sessionId: s.id, method: s.method, at: t.toISOString(), userId: ctx.user.id, authSessionId: ctx.sessionId, docs: s.docHashes } });
    await generateDocument(tx, ackT, { kind: "ACK", ownerUserId: c.clientId, checkoutId: c.id });
    await audit(tx, actor(ctx), "signature.verified", "SignatureSession", s.id, { after: { docs: s.docHashes, method: s.method } });
    return { ok: true as const };
  });
  if (!res.ok) return res;
  // Подпись проекта полиса страховщиком — отдельная операция (эмулятор), вне транзакции.
  const c = await db.checkout.findUniqueOrThrow({ where: { id: checkoutId } });
  const draftT = policyTemplate("POLICY_DRAFT", c, {});
  const draftDoc = await generateDocument(db, draftT, { kind: "POLICY", ownerUserId: c.clientId, checkoutId: c.id, seriesId: policySeries(c.id) });
  const sig = await adapters.carrier.signPolicy(draftDoc.sha256, c.carrierOrgId);
  await txRetry(async (tx) => {
    await tx.document.update({ where: { id: draftDoc.id }, data: { signedAt: new Date(sig.at), signedBy: sig.signer, signatureInfo: sig as any, externalOrigin: "DEMO_CARRIER" } });
    assertTransition("checkout", "CLIENT_CONFIRMATION", "PAYMENT", "SYSTEM");
    await tx.checkout.update({ where: { id: c.id }, data: { status: "PAYMENT", version: { increment: 1 } } });
  });
  return { ok: true as const };
}

export const policySeries = (checkoutId: string) => sha256(`policy-series:${checkoutId}`).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");

async function assertNotStale(tx: Tx | typeof db, c: { requestId: string; requestVersion: number; quoteId: string; quoteSeq: number; status: string; reservationExpiresAt: Date; id: string }) {
  const t = await now();
  const r = await tx.insuranceRequest.findUniqueOrThrow({ where: { id: c.requestId } });
  if (r.currentVersion !== c.requestVersion || r.status !== "CHECKOUT") throw err("VERSION_CHANGED", "Данные заявки изменились: нужна новая котировка и повторное согласие");
  const q = await tx.quote.findUniqueOrThrow({ where: { id: c.quoteId } });
  if (q.status !== "SELECTED" || q.seq !== c.quoteSeq) throw err("QUOTE_EXPIRED", "Предложение больше не действительно");
  if (q.expiresAt <= t) throw err("QUOTE_EXPIRED", "Срок действия цены истёк — нужно повторное подтверждение цены");
  if (["RESERVED", "CHECKING", "DOCUMENTS", "CLIENT_CONFIRMATION"].includes(c.status) && c.reservationExpiresAt <= t) throw err("QUOTE_EXPIRED", "Резерв истёк");
}

/**
 * Создание оплаты премии напрямую эмулятору страховщика. Сумма — из серверной котировки.
 * Повторное нажатие с тем же ключом возвращает тот же платёж; второй «живой» платёж запрещён индексом (AC13).
 */
export async function createPremiumPayment(ctx: Ctx, checkoutId: string, idempotencyKey: string) {
  const c = await getOwnCheckout(db, ctx, checkoutId);
  if (c.status !== "PAYMENT") throw err("INVALID_TRANSITION", c.status === "AWAITING_CARRIER" || c.status === "COMPLETED" ? "Оплата уже выполнена" : "Оплата сейчас недоступна");
  const live = await db.payment.findFirst({ where: { checkoutId: c.id, status: { in: ["CREATED", "PENDING", "AUTHORIZED", "SUCCEEDED", "UNKNOWN"] } } });
  if (live) {
    if (live.status === "UNKNOWN") throw err("RESULT_PENDING", "Результат предыдущей оплаты уточняется — повторное списание не выполняется");
    return { paymentId: live.id, confirmationUrl: `/demo/pay/${live.externalId}`, status: live.status, existing: true };
  }
  await assertNotStale(db, { ...c, status: "PAYMENT" });
  const q = await db.quote.findUniqueOrThrow({ where: { id: c.quoteId } });
  const carrier = await db.organization.findUniqueOrThrow({ where: { id: c.carrierOrgId } });
  const key = `premium:${c.id}:${idempotencyKey}`;
  let p;
  try {
    p = await db.payment.create({ data: { purpose: "PREMIUM", provider: "DEMO_CARRIER_PAY", externalId: `pending:${key}`, payerUserId: ctx.user.id, recipientOrgId: carrier.id, recipientLabel: `${carrier.name} (страховщик)`, amountKop: q.totalKop, checkoutId: c.id, idempotencyKey: key } });
  } catch (e: any) {
    if (e?.code === "P2002") { const ex = await db.payment.findFirst({ where: { checkoutId: c.id, status: { in: ["CREATED", "PENDING", "SUCCEEDED", "UNKNOWN"] } } }); if (ex) return { paymentId: ex.id, confirmationUrl: `/demo/pay/${ex.externalId}`, status: ex.status, existing: true }; }
    throw e;
  }
  try {
    const ext = await adapters.payment.createPayment({ purpose: "PREMIUM", amountKop: q.totalKop, currency: "RUB", reference: `checkout:${c.id}`, idempotencyKey: key });
    await db.payment.update({ where: { id: p.id }, data: { externalId: ext.externalId, status: "PENDING", version: { increment: 1 } } });
    await db.paymentStatusHistory.create({ data: { paymentId: p.id, from: "CREATED", to: "PENDING", source: "create" } });
    await enqueue(db, "payment.check", { paymentId: p.id }, { runAt: new Date((await now()).getTime() + 10 * 60_000), uniqueKey: `payment.check:${p.id}` });
    await audit(db, actor(ctx), "payment.created", "Payment", p.id, { after: { amountKop: q.totalKop, recipient: carrier.name } });
    return { paymentId: p.id, confirmationUrl: ext.confirmationUrl, status: "PENDING", existing: false };
  } catch (e: any) {
    await db.payment.update({ where: { id: p.id }, data: { status: "UNKNOWN", failureReason: String(e?.message ?? e).slice(0, 200) } });
    await raiseException(db, { type: "PAYMENT", entityType: "Payment", entityId: p.id, reason: "Не удалось получить ответ провайдера при создании оплаты", nextAction: "Сверить статус с провайдером, повторно не списывать", dueAt: new Date((await now()).getTime() + 3600_000), priority: "HIGH" });
    throw err("RESULT_PENDING", "Результат создания оплаты уточняется");
  }
}

/** Вызывается из обработки вебхука/сверки в той же транзакции. */
export async function onPremiumSucceeded(tx: Tx, checkoutId: string, paymentId: string, t: Date) {
  await lockRow(tx, "Checkout", checkoutId);
  const c = await tx.checkout.findUniqueOrThrow({ where: { id: checkoutId } });
  if (c.status === "CANCELLED") {
    // Оплата пришла после отмены: не создаём полис молча — исключение на возврат/решение.
    await raiseException(tx, { type: "PAYMENT", priority: "CRITICAL", entityType: "Checkout", entityId: c.id, reason: "Успешная оплата по отменённому оформлению", nextAction: "Согласовать со страховщиком заключение или возврат", dueAt: new Date(t.getTime() + 2 * 3600_000), dedupeKey: `late_payment:${paymentId}` });
    return;
  }
  if (c.status !== "PAYMENT") return; // уже обработано
  assertTransition("checkout", "PAYMENT", "AWAITING_CARRIER", "SYSTEM");
  await tx.checkout.update({ where: { id: c.id }, data: { status: "AWAITING_CARRIER", version: { increment: 1 } } });
  const snap = c.snapshot as any;
  const q = await tx.quote.findUniqueOrThrow({ where: { id: c.quoteId } });
  const pv = await tx.productVersion.findFirstOrThrow({ where: { productId: q.productId, status: "PUBLISHED" }, orderBy: { version: "desc" } });
  const r = await tx.insuranceRequest.findUniqueOrThrow({ where: { id: c.requestId } });
  const terms = q.terms as any;
  const data = snap.requestData;
  let startsAt: Date, endsAt: Date, bookingRef: string | null = null, lat: number | null = null, lon: number | null = null;
  if (r.kind === "EVENT") { startsAt = new Date(terms.event.startUtc); endsAt = new Date(terms.event.endUtc); bookingRef = String(data.booking_ref); lat = Math.round(Number(data.latitude) * 1e6); lon = Math.round(Number(data.longitude) * 1e6); }
  else { startsAt = new Date(`${data.start_date}T00:00:00+03:00`); if (startsAt < t) startsAt = new Date(t.getTime() + 86400_000); endsAt = new Date(startsAt); endsAt.setUTCFullYear(endsAt.getUTCFullYear() + 1); }
  const schema = schemaFor(r.productCode);
  const objectTitle = r.productCode === "KASKO" ? `${data.car_make} ${data.car_model}, ${data.car_year}` : r.productCode === "PROPERTY" ? `${allFields(schema).find((f) => f.key === "property_type")?.options?.find((o) => o.value === data.property_type)?.label ?? ""}, ${data.city}` : `${data.booking_vendor}, ${data.event_date}`;
  const policy = await tx.policy.create({
    data: { number: snap.policyNumber, checkoutId: c.id, requestId: r.id, clientId: c.clientId, carrierOrgId: c.carrierOrgId, agencyOrgId: c.agencyOrgId, servicingAgentId: q.agentUserId, productCode: r.productCode, productVersionId: pv.id, quoteId: q.id,
      contractStatus: "PREPARED", objectTitle, terms: terms, premiumKop: q.totalKop, startsAt, endsAt, timezone: terms.event?.timezone ?? "Europe/Moscow", bookingRef, latitudeE6: lat, longitudeE6: lon },
  });
  if (r.kind === "EVENT") await tx.coverage.create({ data: { policyId: policy.id, code: terms.event.metric === "PRECIP_MM" ? "RAIN" : "WIND", title: terms.event.metric === "PRECIP_MM" ? "Дождь во время мероприятия" : "Недостаток ветра", limitKop: terms.event.payoutKop } });
  else for (const risk of terms.risks as string[]) await tx.coverage.create({ data: { policyId: policy.id, code: risk, title: risk, limitKop: Math.min(2_000_000_000, terms.sumInsuredRub * 100), deductibleKop: terms.deductibleRub * 100 } });
  await tx.$executeRaw`UPDATE "CapacityPool" SET "reservedCount" = "reservedCount" - 1, "usedCount" = "usedCount" + 1, "version" = "version" + 1 WHERE "carrierOrgId" = ${c.carrierOrgId}::uuid AND "productCode" = ${r.productCode} AND "reservedCount" > 0`;
  await tx.document.updateMany({ where: { checkoutId: c.id }, data: { policyId: policy.id } });
  await enqueue(tx, "carrier.confirm", { checkoutId: c.id }, { uniqueKey: `carrier.confirm:${c.id}` });
  await notify(tx, c.clientId, { type: "payment.succeeded", title: "Оплата подтверждена", body: "Оплата подтверждена, получаем подтверждение страховщика.", link: `/c/checkouts/${c.id}` });
  await audit(tx, { role: "SYSTEM" }, "checkout.paid", "Checkout", c.id, { after: { paymentId, policyId: policy.id } });
}

export async function onPremiumFailed(tx: Tx, checkoutId: string, t: Date) {
  const c = await tx.checkout.findUniqueOrThrow({ where: { id: checkoutId } });
  await notify(tx, c.clientId, { type: "payment.failed", title: "Оплата не прошла", body: "Списания не было. Можно повторить оплату — будет создано новое платёжное намерение.", link: `/c/checkouts/${c.id}` });
  if (c.reservationExpiresAt <= t && c.status === "PAYMENT") await releaseCheckout(tx, c.id, "Резерв истёк после неуспешной оплаты", "SYSTEM");
}

/**
 * Подтверждение заключения страховщиком. Задержка/ошибка — повтор с задержкой; после 3 попыток — задача специалисту.
 * Сервис не определяет юридический момент начала защиты сам (AC14).
 */
export async function confirmWithCarrier(checkoutId: string, attempt: number) {
  const c = await db.checkout.findUniqueOrThrow({ where: { id: checkoutId } });
  if (c.status !== "AWAITING_CARRIER") return { skipped: c.status };
  const policy = await db.policy.findUniqueOrThrow({ where: { checkoutId: c.id } });
  const payment = await db.payment.findFirstOrThrow({ where: { checkoutId: c.id, status: "SUCCEEDED" } });
  let res: Awaited<ReturnType<typeof adapters.carrier.confirmConclusion>> | null = null;
  let failure: string | null = null;
  try { res = await adapters.carrier.confirmConclusion({ policyNumber: policy.number, paymentExternalId: payment.externalId, startsAt: policy.startsAt }); }
  catch (e: any) { failure = e.message; }
  if (!res || res.status === "PENDING") {
    const t = await now();
    if (attempt >= 3) {
      await raiseException(db, { type: "CHECKOUT", priority: "HIGH", entityType: "Checkout", entityId: c.id, reason: `Оплата подтверждена, страховщик не подтвердил заключение договора${failure ? `: ${failure}` : " (задержка)"}`, nextAction: "Запросить статус у страховщика; повторная попытка выполняется автоматически", dueAt: new Date(t.getTime() + 4 * 3600_000), dedupeKey: `carrier_pending:${c.id}` });
      await notifyPlatformRole(db, "SUPPORT", { type: "carrier.pending", title: "Нет подтверждения страховщика после оплаты", body: `Полис ${policy.number}`, link: `/admin/exceptions`, dedupeKey: `carrier_pending_notice:${c.id}` });
    }
    throw new Error(failure ?? "CARRIER_PENDING"); // задание повторится с задержкой
  }
  const concluded = res;
  return txRetry(async (tx) => {
    await lockRow(tx, "Checkout", c.id);
    const cur = await tx.checkout.findUniqueOrThrow({ where: { id: c.id } });
    if (cur.status !== "AWAITING_CARRIER") return { skipped: cur.status };
    const t = await now();
    assertTransition("contract", "PREPARED", "CONCLUDED", "SYSTEM");
    const p = await tx.policy.update({ where: { id: policy.id }, data: { contractStatus: "CONCLUDED", concludedAt: t, externalNumber: concluded.externalNumber, startsAt: concluded.startsAt, version: { increment: 1 } } });
    const final = policyTemplate("POLICY_FINAL", cur, { externalNumber: concluded.externalNumber, concludedAt: t.toISOString() });
    const doc = await generateDocument(tx, final, { kind: "POLICY", ownerUserId: cur.clientId, checkoutId: cur.id, policyId: p.id, seriesId: policySeries(cur.id) });
    const sig = await adapters.carrier.signPolicy(doc.sha256, cur.carrierOrgId);
    await tx.document.update({ where: { id: doc.id }, data: { signedAt: new Date(sig.at), signedBy: sig.signer, signatureInfo: sig as any, externalOrigin: "DEMO_CARRIER" } });
    assertTransition("checkout", "AWAITING_CARRIER", "COMPLETED", "SYSTEM");
    await tx.checkout.update({ where: { id: cur.id }, data: { status: "COMPLETED", version: { increment: 1 } } });
    assertTransition("request", "CHECKOUT", "COMPLETED", "SYSTEM");
    await tx.insuranceRequest.update({ where: { id: cur.requestId }, data: { status: "COMPLETED", version: { increment: 1 } } });
    await accrueCommissions(tx, p.id);
    if (p.productCode === "RAIN01" || p.productCode === "WIND01") await scheduleEventCheck(tx, p.id);
    await tx.exceptionItem.updateMany({ where: { dedupeKey: `carrier_pending:${cur.id}`, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", resolution: "Страховщик подтвердил заключение (восстановление)" } });
    await notify(tx, cur.clientId, { type: "policy.concluded", title: "Договор заключён (демо)", body: `Полис ${p.number}. Защита начнёт действовать ${p.startsAt.toLocaleString("ru-RU", { timeZone: p.timezone })}.`, link: `/c/policies/${p.id}`, email: true });
    if (cur.agencyOrgId) await notifyOrg(tx, cur.agencyOrgId, { type: "policy.concluded", title: "Полис оформлен", body: `Полис ${p.number}`, link: `/a/deals/${cur.id}` });
    await audit(tx, { role: "SYSTEM" }, "policy.concluded", "Policy", p.id, { after: { externalNumber: concluded.externalNumber } });
    return { concluded: p.id };
  });
}

export async function cancelCheckout(ctx: Ctx, checkoutId: string, reason: string) {
  return txRetry(async (tx) => {
    await lockRow(tx, "Checkout", checkoutId);
    const c = await getOwnCheckout(tx, ctx, checkoutId);
    const live = await tx.payment.findFirst({ where: { checkoutId: c.id, status: { in: ["PENDING", "SUCCEEDED", "UNKNOWN", "AUTHORIZED"] } } });
    if (live) throw err("CONFLICT", live.status === "PENDING" ? "Оплата в процессе — дождитесь результата" : "Оплата уже прошла или уточняется: отмена — через запрос на прекращение");
    return releaseCheckout(tx, c.id, reason || "Клиент отменил оформление", "CLIENT");
  });
}

/** Напоминание клиенту, что срок оформления после матча заканчивается. */
export async function remindCheckout(checkoutId: string, minutesLeft: number) {
  const c = await db.checkout.findUnique({ where: { id: checkoutId } });
  if (!c || !["RESERVED", "CHECKING", "DOCUMENTS", "CLIENT_CONFIRMATION", "PAYMENT"].includes(c.status)) return { skipped: true };
  await notify(db as any, c.clientId, { type: "match.reminder", title: `До конца оформления ${minutesLeft >= 60 ? `${minutesLeft / 60} ч` : `${minutesLeft} мин`}`, body: "Ознакомьтесь с документами, подтвердите кодом и оплатите. Если не успеть, матч завершится, условия не продлеваются.", link: `/c/checkouts/${c.id}`, dedupeKey: `match.reminder:${c.id}:${minutesLeft}` });
  return { reminded: true };
}

/** Истечение резерва (задание worker). Не отменяет оформление, если оплата уже начата. */
export async function expireReservation(checkoutId: string) {
  return txRetry(async (tx) => {
    await lockRow(tx, "Checkout", checkoutId);
    const c = await tx.checkout.findUniqueOrThrow({ where: { id: checkoutId } });
    const t = await now();
    if (["CANCELLED", "COMPLETED", "AWAITING_CARRIER"].includes(c.status)) return { skipped: c.status };
    if (c.reservationExpiresAt > t) { await enqueue(tx, "checkout.expire", { checkoutId }, { runAt: c.reservationExpiresAt, uniqueKey: `checkout.expire:${c.id}:${c.reservationExpiresAt.getTime()}` }); return { rescheduled: true }; }
    const live = await tx.payment.findFirst({ where: { checkoutId: c.id, status: { in: ["PENDING", "SUCCEEDED", "UNKNOWN", "AUTHORIZED"] } } });
    if (live) return { skipped: "payment_in_progress" };
    await releaseCheckout(tx, c.id, "Время на оформление истекло: договор не оформлен и не оплачен за 2 часа после матча", "SYSTEM");
    return { expired: true };
  });
}
