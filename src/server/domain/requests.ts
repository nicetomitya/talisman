import { createHash } from "node:crypto";
import { db, txRetry, type Tx } from "../db";
import { err } from "../errors";
import { audit, type Actor } from "../audit";
import type { Ctx } from "../access";
import { actor } from "../access";
import { now } from "../clock";
import { assertTransition } from "../state/machines";
import { allFields, validateForm, publicView, essentialSnapshot, checkValue, type FieldIssue } from "./forms";
import { schemaFor, productsForCode, assertSalesAllowed } from "./catalog";
import { stableStringify } from "../idempotency";
import { DEMO_RULES } from "../config";
import { enqueue, outbox } from "../jobs";
import { notify, notifyOrg } from "./notify";
import { eventEligibility, createInstantQuote } from "./eventsales";
import { rateLimit } from "../auth/ratelimit";
import { PRODUCT_TITLES } from "./labels";

/** Пессимистическая блокировка строки в транзакции (для конкурентных команд). */
export async function lockRow(tx: Tx, table: "InsuranceRequest" | "Quote" | "Checkout" | "Auction" | "Policy" | "Coverage" | "Subscription" | "Payment" | "Claim" | "EventCheck" | "Promo", id: string) {
  await tx.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE`, id);
}

export const fingerprintOf = (snapshot: unknown) => createHash("sha256").update(stableStringify(snapshot)).digest("hex").slice(0, 32);

const KIND: Record<string, "CLASSIC" | "EVENT"> = { KASKO: "CLASSIC", PROPERTY: "CLASSIC", RAIN01: "EVENT", WIND01: "EVENT" };

/** Бытовое описание → подсказка продукта (детерминированно). Свободный текст не заменяет обязательные поля. */
export function suggestProduct(text: string): string | null {
  const t = text.toLowerCase();
  if (/(машин|авто|каско|угон|дтп)/.test(t)) return "KASKO";
  if (/(квартир|дом|залив|пожар|соседи)/.test(t)) return "PROPERTY";
  if (/(дожд|осадк|свадьб|мероприят|пикник|площадк)/.test(t)) return "RAIN01";
  if (/(парус|ветер|ветр|яхт|регат)/.test(t)) return "WIND01";
  return null;
}

export async function getOwnRequest(tx: Tx | typeof db, ctx: Ctx, id: string) {
  const r = await tx.insuranceRequest.findFirst({ where: { id, clientId: ctx.user.id } });
  if (!r) throw err("NOT_FOUND", "Заявка не найдена");
  return r;
}

export async function createRequest(ctx: Ctx, i: { productCode: string; freeText?: string; savedObjectId?: string }) {
  await rateLimit(`request:create:${ctx.user.id}`, 20, 3600);
  const kind = KIND[i.productCode];
  if (!kind) throw err("VALIDATION", "Продукт недоступен в первой версии");
  const schema = schemaFor(i.productCode);
  const schemaRow = await db.formSchema.findUniqueOrThrow({ where: { country_productCode_version: { country: "RU", productCode: i.productCode, version: schema.version } } });
  let data: Record<string, any> = kind === "EVENT" ? { timezone: "Europe/Moscow" } : {};
  const confirmed: Record<string, any> = {};
  if (i.savedObjectId) {
    const obj = await db.savedObject.findFirst({ where: { id: i.savedObjectId, clientId: ctx.user.id } });
    if (!obj) throw err("NOT_FOUND", "Объект не найден");
    data = { ...data, ...(obj.data as object) };
    for (const k of Object.keys(obj.data as object)) confirmed[k] = { status: "NEEDS_RECHECK", source: "saved_object" };
  }
  const r = await db.$transaction(async (tx) => {
    const r = await tx.insuranceRequest.create({ data: { clientId: ctx.user.id, productCode: i.productCode, kind, title: PRODUCT_TITLES[i.productCode], freeText: i.freeText?.slice(0, 2000), formSchemaId: schemaRow.id, data, confirmed } });
    await audit(tx, actor(ctx), "request.create", "InsuranceRequest", r.id, { after: { productCode: i.productCode } });
    return r;
  });
  return r;
}

/**
 * Автосохранение черновика. Принимаются только поля схемы (защита от массового присваивания).
 * Изменение существенного поля опубликованной заявки создаёт новую версию: котировки инвалидируются,
 * торги закрываются, активный резерв освобождается (AC09).
 */
export async function saveDraft(ctx: Ctx, id: string, i: { data: Record<string, unknown>; version: number }) {
  return txRetry(async (tx) => {
    await lockRow(tx, "InsuranceRequest", id);
    const r = await getOwnRequest(tx, ctx, id);
    if (["COMPLETED", "CANCELLED"].includes(r.status)) throw err("INVALID_TRANSITION", "Заявка закрыта для изменений");
    if (r.version !== i.version) throw err("VERSION_CHANGED", "Заявка изменилась в другой вкладке — обновите страницу", { current: r.version });
    const schema = schemaFor(r.productCode);
    const fields = allFields(schema);
    const issues: FieldIssue[] = [];
    const data = { ...(r.data as Record<string, any>) };
    const confirmed = { ...(r.confirmed as Record<string, any>) };
    for (const [k, v] of Object.entries(i.data)) {
      const f = fields.find((x) => x.key === k);
      if (!f) throw err("VALIDATION", `Неизвестное поле ${k}`);
      const norm = f.type === "number" && v !== "" && v !== null ? Number(v) : f.key === "car_vin" && typeof v === "string" ? v.toUpperCase() : v;
      if (norm !== "" && norm !== null && norm !== undefined) { const e = checkValue(f, norm); if (e) issues.push({ key: k, message: e }); }
      if (stableStringify(data[k]) !== stableStringify(norm)) {
        data[k] = norm;
        if (f.keyField) confirmed[k] = { status: "UNCONFIRMED", source: "manual" };
      }
    }
    const before = essentialSnapshot(schema, r.data as any);
    const after = essentialSnapshot(schema, data);
    const essentialChanged = fingerprintOf(before) !== fingerprintOf(after);
    let status = r.status;
    let invalidated = 0;
    if (essentialChanged && ["OPEN", "SELECTION", "CHECKOUT", "NEEDS_INFO"].includes(r.status)) {
      invalidated = await invalidateForNewVersion(tx, ctx, r.id, r.status);
      status = "DRAFT";
    }
    const upd = await tx.insuranceRequest.update({ where: { id: r.id }, data: { data, confirmed, status, version: { increment: 1 } } });
    if (essentialChanged && r.status !== "DRAFT") await audit(tx, actor(ctx), "request.essential_change", "InsuranceRequest", r.id, { before, after, reason: `Инвалидировано предложений: ${invalidated}` });
    return { request: upd, issues, invalidatedQuotes: invalidated, requiresRepublish: essentialChanged && r.status !== "DRAFT" };
  });
}

async function invalidateForNewVersion(tx: Tx, ctx: Ctx, requestId: string, status: string) {
  const t = await now();
  const active = await tx.checkout.findFirst({ where: { requestId, status: { notIn: ["CANCELLED", "COMPLETED"] } } });
  if (active) {
    const livePay = await tx.payment.findFirst({ where: { checkoutId: active.id, status: { in: ["SUCCEEDED", "UNKNOWN", "PENDING", "AUTHORIZED"] } } });
    if (livePay) throw err("CONFLICT", "Оплата уже начата — изменить существенные данные можно после отмены оформления через поддержку");
    await releaseCheckout(tx, active.id, "Клиент изменил существенные данные заявки", "CLIENT");
  }
  const quotes = await tx.quote.findMany({ where: { requestId, status: { in: ["DRAFT", "PUBLISHED", "SELECTED"] } } });
  for (const q of quotes) {
    await tx.quote.update({ where: { id: q.id }, data: { status: "EXPIRED", withdrawReason: "Изменилась версия заявки", version: { increment: 1 } } });
    await tx.quoteEvent.create({ data: { quoteId: q.id, type: "INVALIDATED_REQUEST_VERSION" } });
    if (q.agencyOrgId) await notifyOrg(tx, q.agencyOrgId, { type: "request.changed", title: "Клиент изменил заявку", body: "Существенные данные изменились, прежнее предложение больше недействительно. После повторной публикации можно отправить новое.", link: `/a/requests/${requestId}` });
  }
  const auctions = await tx.auction.findMany({ where: { requestId, status: { not: "CLOSED" } } });
  for (const a of auctions) await tx.auction.update({ where: { id: a.id }, data: { status: "CLOSED", closedAt: t, version: { increment: 1 } } });
  if (status !== "DRAFT") assertTransition("request", status === "CHECKOUT" ? "OPEN" : status, "DRAFT", "CLIENT");
  return quotes.length;
}

/** Освобождение резерва (отмена или истечение). Возвращает ёмкость и, при открытом окне, возобновляет торги. */
export async function releaseCheckout(tx: Tx, checkoutId: string, reason: string, by: string) {
  const c = await tx.checkout.findUniqueOrThrow({ where: { id: checkoutId } });
  if (c.status === "CANCELLED" || c.status === "COMPLETED") return c;
  assertTransition("checkout", c.status, "CANCELLED", by === "CLIENT" ? "CLIENT" : "SYSTEM");
  const t = await now();
  const upd = await tx.checkout.update({ where: { id: c.id, version: c.version }, data: { status: "CANCELLED", cancelReason: reason, version: { increment: 1 } } });
  const q = await tx.quote.findUniqueOrThrow({ where: { id: c.quoteId } });
  const productCode = (await tx.insuranceRequest.findUniqueOrThrow({ where: { id: c.requestId } })).productCode;
  await tx.$executeRaw`UPDATE "CapacityPool" SET "reservedCount" = "reservedCount" - 1, "version" = "version" + 1 WHERE "carrierOrgId" = ${c.carrierOrgId}::uuid AND "productCode" = ${productCode} AND "reservedCount" > 0`;
  if (q.status === "SELECTED") {
    const stillValid = q.expiresAt > t;
    await tx.quote.update({ where: { id: q.id }, data: { status: stillValid ? "PUBLISHED" : "EXPIRED", version: { increment: 1 } } });
  }
  const r = await tx.insuranceRequest.findUniqueOrThrow({ where: { id: c.requestId } });
  if (r.status === "CHECKOUT") {
    const auction = await tx.auction.findFirst({ where: { requestId: r.id, requestVersion: r.currentVersion } });
    const windowOpen = auction && auction.status === "PAUSED" && auction.closesAt > t;
    if (auction && auction.status === "PAUSED") await tx.auction.update({ where: { id: auction.id }, data: { status: windowOpen ? "OPEN" : "CLOSED", closedAt: windowOpen ? null : t, version: { increment: 1 } } });
    const next = !auction || windowOpen ? "OPEN" : "SELECTION";
    await tx.insuranceRequest.update({ where: { id: r.id }, data: { status: auction ? next : "OPEN", version: { increment: 1 } } });
  }
  await audit(tx, { role: by }, "checkout.released", "Checkout", c.id, { reason });
  await notify(tx, c.clientId, { type: "checkout.released", title: "Резерв предложения освобождён", body: reason, link: `/c/requests/${c.requestId}` });
  if (c.agencyOrgId) await notifyOrg(tx, c.agencyOrgId, { type: "checkout.released", title: "Оформление отменено", body: reason, link: `/a/requests/${c.requestId}` });
  return upd;
}

export async function confirmFields(ctx: Ctx, id: string, keys: string[], version: number) {
  return txRetry(async (tx) => {
    const r = await getOwnRequest(tx, ctx, id);
    if (r.version !== version) throw err("VERSION_CHANGED", "Заявка изменилась — обновите страницу");
    const schema = schemaFor(r.productCode);
    const data = r.data as Record<string, any>;
    const confirmed = { ...(r.confirmed as Record<string, any>) };
    for (const k of keys) {
      const f = allFields(schema).find((x) => x.key === k);
      if (!f) throw err("VALIDATION", `Неизвестное поле ${k}`);
      if (data[k] === undefined || data[k] === "" || data[k] === null) throw err("VALIDATION", `Поле «${f.label}» пустое — нечего подтверждать`, { fields: [{ path: k, message: "Заполните поле" }] });
      confirmed[k] = { ...(confirmed[k] ?? {}), status: "CONFIRMED", at: new Date().toISOString() };
    }
    return tx.insuranceRequest.update({ where: { id: r.id, version: r.version }, data: { confirmed, version: { increment: 1 } } });
  });
}

/** Применить подсказку распознавания: значение заполняется, но ключевое поле остаётся неподтверждённым до действия клиента. */
export async function applySuggestion(ctx: Ctx, id: string, docId: string, key: string, version: number) {
  return txRetry(async (tx) => {
    const r = await getOwnRequest(tx, ctx, id);
    if (r.version !== version) throw err("VERSION_CHANGED", "Заявка изменилась — обновите страницу");
    const doc = await tx.document.findFirst({ where: { id: docId, requestId: r.id, status: "CLEAN" } });
    if (!doc) throw err("NOT_FOUND", "Документ не найден или ещё проверяется");
    const s = ((doc.extracted as any)?.suggestions ?? []).find((x: any) => x.key === key);
    if (!s) throw err("NOT_FOUND", "Подсказка не найдена");
    const f = allFields(schemaFor(r.productCode)).find((x) => x.key === key);
    if (!f) throw err("VALIDATION", "Поле не входит в анкету");
    const e = checkValue(f, s.value);
    if (e) throw err("VALIDATION", `Распознанное значение не прошло проверку: ${e}`);
    const data = { ...(r.data as any), [key]: s.value };
    const confirmed = { ...(r.confirmed as any), [key]: { status: s.confidence >= 0.85 ? "SUGGESTED" : "LOW_CONFIDENCE", source: `document:${doc.id}`, confidence: s.confidence } };
    return tx.insuranceRequest.update({ where: { id: r.id, version: r.version }, data: { data, confirmed, version: { increment: 1 } } });
  });
}

/**
 * Публикация заявки: проверка анкеты, снимок версии, отпечаток, торги или мгновенная котировка.
 * Неполная анкета не публикуется: заявка переходит в «Нужна информация» с причинами у полей (AC02).
 */
export async function publishRequest(ctx: Ctx, id: string, version: number) {
  await rateLimit(`request:publish:${ctx.user.id}`, 30, 3600);
  const result = await txRetry(async (tx) => {
    await lockRow(tx, "InsuranceRequest", id);
    const r = await getOwnRequest(tx, ctx, id);
    if (r.version !== version) throw err("VERSION_CHANGED", "Заявка изменилась — обновите страницу");
    if (!["DRAFT", "NEEDS_INFO"].includes(r.status)) throw err("INVALID_TRANSITION", "Заявка уже опубликована");
    const schema = schemaFor(r.productCode);
    const data = r.data as Record<string, any>;
    const issues = validateForm(schema, data, r.confirmed as any);
    const t = await now();
    if (r.kind === "CLASSIC" && data.start_date && new Date(data.start_date + "T00:00:00Z") < new Date(t.toISOString().slice(0, 10) + "T00:00:00Z")) issues.push({ key: "start_date", message: "Дата начала не может быть в прошлом" });
    const products = await productsForCode(tx, r.productCode);
    if (products.length === 0) throw err("SALES_SUSPENDED", "Продукт сейчас не продаётся");
    if (r.kind === "EVENT" && issues.length === 0) issues.push(...(await eventEligibility(tx, ctx.user.id, products[0], data, t)));
    if (issues.length) {
      if (r.status === "DRAFT") assertTransition("request", "DRAFT", "NEEDS_INFO", "CLIENT");
      await tx.insuranceRequest.update({ where: { id: r.id }, data: { status: "NEEDS_INFO", version: { increment: 1 } } });
      return { published: false as const, issues };
    }
    for (const p of products) await assertSalesAllowed(tx, { carrierOrgId: p.carrierOrgId, productCode: r.productCode, territory: data.region ?? null });
    assertTransition("request", r.status, "OPEN", "CLIENT");
    const newVersion = r.currentVersion + 1;
    const snapshot = essentialSnapshot(schema, data);
    await tx.requestVersion.create({ data: { requestId: r.id, version: newVersion, data, schemaSnapshot: schema as any, publicData: publicView(schema, data), fingerprint: fingerprintOf(snapshot) } });
    await tx.insuranceRequest.update({ where: { id: r.id }, data: { status: "OPEN", currentVersion: newVersion, publishedAt: t, territory: data.region ?? data.city ?? null, version: { increment: 1 } } });
    await audit(tx, actor(ctx), "request.publish", "InsuranceRequest", r.id, { after: { version: newVersion } });

    if (r.kind === "EVENT") {
      const q = await createInstantQuote(tx, r.id, newVersion, products[0], data, t);
      await notify(tx, r.clientId, { type: "quote.new", title: "Готова котировка по утверждённому тарифу", body: `${r.title}: премия ${(q.totalKop / 100).toLocaleString("ru-RU")} ₽`, link: `/c/requests/${r.id}` });
      return { published: true as const, version: newVersion, instantQuoteId: q.id };
    }
    // reverse auction: подходящие участники — проверенные агентства с действующими полномочиями по продуктам этой линии.
    const mandates = await tx.mandate.findMany({ where: { productId: { in: products.map((p) => p.id) }, status: "ACTIVE", validFrom: { lte: t }, validTo: { gte: t } } });
    const orgs = await tx.organization.findMany({ where: { id: { in: [...new Set(mandates.map((m) => m.agencyOrgId))] }, type: "AGENCY", status: "ACTIVE", verificationStatus: "VERIFIED" } });
    const eligible = orgs.filter((o) => !o.verifiedUntil || o.verifiedUntil > t).map((o) => o.id);
    const closesAt = new Date(t.getTime() + DEMO_RULES.auctionWindowSec * 1000);
    const auction = await tx.auction.create({ data: { requestId: r.id, requestVersion: newVersion, status: "OPEN", opensAt: t, closesAt, originalClosesAt: closesAt, minStepKop: DEMO_RULES.minImprovementKop, eligibleOrgIds: eligible } });
    await enqueue(tx, "auction.close", { auctionId: auction.id }, { runAt: closesAt, uniqueKey: `auction.close:${auction.id}` });
    await outbox(tx, "request.published", { requestId: r.id, version: newVersion, eligible });
    for (const orgId of eligible) await notifyOrg(tx, orgId, { type: "request.new", title: "Новая подходящая заявка", body: `${r.title}, окно предложений до ${closesAt.toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`, link: `/a/requests/${r.id}`, dedupeKey: `reqnew:${r.id}:${newVersion}:${orgId}` });
    return { published: true as const, version: newVersion, auctionId: auction.id };
  });
  return result;
}

export async function cancelRequest(ctx: Ctx, id: string) {
  return txRetry(async (tx) => {
    const r = await getOwnRequest(tx, ctx, id);
    const active = await tx.checkout.findFirst({ where: { requestId: r.id, status: { notIn: ["CANCELLED", "COMPLETED"] } } });
    if (active) throw err("CONFLICT", "Сначала отмените оформление");
    assertTransition("request", r.status, "CANCELLED", "CLIENT");
    await tx.quote.updateMany({ where: { requestId: r.id, status: { in: ["DRAFT", "PUBLISHED"] } }, data: { status: "EXPIRED", withdrawReason: "Заявка отменена клиентом" } });
    await tx.auction.updateMany({ where: { requestId: r.id, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedAt: await now() } });
    await audit(tx, actor(ctx), "request.cancel", "InsuranceRequest", r.id);
    return tx.insuranceRequest.update({ where: { id: r.id }, data: { status: "CANCELLED", version: { increment: 1 } } });
  });
}

/** Заявка с точки зрения агентства: только если оно входит в число подходящих участников или ведёт сделку. Возвращает минимальный объём данных (AC03). */
export async function requestForAgency(ctx: Ctx & { orgId: string }, id: string) {
  const r = await db.insuranceRequest.findUnique({ where: { id } });
  if (!r || r.currentVersion === 0) throw err("NOT_FOUND", "Заявка не найдена");
  const auction = await db.auction.findFirst({ where: { requestId: id }, orderBy: { requestVersion: "desc" } });
  const eligible = ((auction?.eligibleOrgIds as string[]) ?? []).includes(ctx.orgId);
  const hasQuote = await db.quote.count({ where: { requestId: id, agencyOrgId: ctx.orgId } });
  const deal = await db.checkout.findFirst({ where: { requestId: id, agencyOrgId: ctx.orgId, status: { not: "CANCELLED" } } });
  if (!eligible && !hasQuote && !deal) throw err("NOT_FOUND", "Заявка не найдена");
  const v = await db.requestVersion.findUniqueOrThrow({ where: { requestId_version: { requestId: id, version: r.currentVersion } } });
  const schema = schemaFor(r.productCode);
  const visible = deal ? (await import("./forms")).dealView(schema, v.data as any) : (v.publicData as Record<string, any>);
  return { request: { id: r.id, title: r.title, productCode: r.productCode, kind: r.kind, status: r.status, currentVersion: r.currentVersion, publishedAt: r.publishedAt, territory: r.territory }, data: visible, auction, schema, eligible, dealCheckoutId: deal?.id ?? null };
}

export { type Actor };
