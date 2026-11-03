import { db, txRetry, type Tx } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, type Ctx } from "../access";
import { now } from "../clock";
import { assertTransition } from "../state/machines";
import { DEMO_RULES } from "../config";
import { enqueue } from "../jobs";
import { notify, notifyOrg } from "./notify";
import { activeTariff, schemaFor } from "./catalog";
import { computeClassic, coverageFingerprint, termsFromRequest, type ClassicRules } from "./tariff";
import { applyBp } from "../money";
import { lockRow } from "./requests";
import { assertCanRespond, recordResponseUsage } from "./subscriptions";
import { rateLimit } from "../auth/ratelimit";

/** Проверка участника: проверен, не заблокирован, полномочия по страховщику и продукту действуют. */
export async function assertAgencyMayQuote(tx: Tx | typeof db, orgId: string, productId: string, t: Date) {
  const org = await tx.organization.findUnique({ where: { id: orgId } });
  if (!org || org.type !== "AGENCY") throw err("FORBIDDEN", "Организация не является агентством");
  if (org.status !== "ACTIVE") throw err("FORBIDDEN", "Агентство заблокировано");
  if (org.verificationStatus !== "VERIFIED" || (org.verifiedUntil && org.verifiedUntil < t)) throw err("FORBIDDEN", "Агентство не прошло проверку или срок проверки истёк — реальные предложения заблокированы");
  const mandate = await tx.mandate.findFirst({ where: { agencyOrgId: orgId, productId, status: "ACTIVE", validFrom: { lte: t }, validTo: { gte: t } } });
  if (!mandate) throw err("FORBIDDEN", "Нет действующих полномочий страховщика по этому продукту");
  return { org, mandate };
}

/** Синхронизация торгов по серверному времени (дополнительно к заданию worker). */
export async function syncAuction(tx: Tx, auctionId: string, t: Date) {
  const a = await tx.auction.findUniqueOrThrow({ where: { id: auctionId } });
  if ((a.status === "OPEN" || a.status === "EXTENDED") && a.closesAt <= t) {
    assertTransition("auction", a.status, "CLOSED", "SYSTEM");
    const upd = await tx.auction.update({ where: { id: a.id }, data: { status: "CLOSED", closedAt: t, version: { increment: 1 } } });
    const r = await tx.insuranceRequest.findUniqueOrThrow({ where: { id: a.requestId } });
    if (r.status === "OPEN" && r.currentVersion === a.requestVersion) {
      assertTransition("request", "OPEN", "SELECTION", "SYSTEM");
      await tx.insuranceRequest.update({ where: { id: r.id }, data: { status: "SELECTION", version: { increment: 1 } } });
      const n = await tx.quote.count({ where: { requestId: r.id, requestVersion: a.requestVersion, status: "PUBLISHED" } });
      await notify(tx, r.clientId, { type: "auction.closed", title: "Окно предложений завершено", body: n ? `Получено предложений: ${n}. Выберите подходящее.` : "Предложений нет. Можно расширить условия, увеличить срок или запросить ручной подбор.", link: `/c/requests/${r.id}`, dedupeKey: `auction.closed:${a.id}` });
    }
    await audit(tx, { role: "SYSTEM" }, "auction.closed", "Auction", a.id, { after: { closedAt: t } });
    return upd;
  }
  return a;
}

export async function closeAuctionJob(auctionId: string) {
  return txRetry(async (tx) => {
    await lockRow(tx, "Auction", auctionId);
    const t = await now();
    const a = await tx.auction.findUniqueOrThrow({ where: { id: auctionId } });
    if (a.status === "CLOSED" || a.status === "PAUSED") return { status: a.status };
    if (a.closesAt > t) {
      await enqueue(tx, "auction.close", { auctionId }, { runAt: a.closesAt, uniqueKey: `auction.close:${a.id}:${a.closesAt.getTime()}` });
      return { rescheduled: a.closesAt };
    }
    const r = await syncAuction(tx, auctionId, t);
    return { status: r.status };
  });
}

export async function calculator(ctx: Ctx & { orgId: string }, requestId: string, productId: string, deductibleRub?: number) {
  const t = await now();
  const r = await db.insuranceRequest.findUnique({ where: { id: requestId } });
  if (!r || r.kind !== "CLASSIC" || r.currentVersion === 0) throw err("NOT_FOUND", "Заявка не найдена");
  const auction = await db.auction.findFirst({ where: { requestId, requestVersion: r.currentVersion } });
  if (!auction || !((auction.eligibleOrgIds as string[]) ?? []).includes(ctx.orgId)) throw err("NOT_FOUND", "Заявка не найдена");
  const product = await db.product.findUnique({ where: { id: productId }, include: { versions: { where: { status: "PUBLISHED" }, take: 1, orderBy: { version: "desc" } } } });
  if (!product || (product.versions[0]?.terms as any)?.productCode !== r.productCode) throw err("NOT_FOUND", "Продукт не подходит к заявке");
  const mandate = await db.mandate.findFirst({ where: { agencyOrgId: ctx.orgId, productId, status: "ACTIVE", validFrom: { lte: t }, validTo: { gte: t } } });
  const v = await db.requestVersion.findUniqueOrThrow({ where: { requestId_version: { requestId, version: r.currentVersion } } });
  const data = { ...(v.data as any) };
  if (deductibleRub !== undefined) data.deductible_rub = String(deductibleRub);
  const { tariff, stale, reason } = await activeTariff(db, productId, product.carrierOrgId, t);
  if (!tariff) return { ok: false as const, reason: reason ?? "Нет тарифа" };
  const rules = tariff.rules as unknown as ClassicRules & { commissionBp: number };
  const res = computeClassic(rules, data, t.getUTCFullYear());
  if (!res.ok) return { ok: false as const, reason: res.reason };
  const commissionKop = applyBp(res.basePremiumKop, rules.commissionBp);
  const platformKop = applyBp(commissionKop, DEMO_RULES.platformShareBp);
  const { ok: _ok, ...rest } = res;
  return { ok: true as const, stale, staleReason: reason, mandate: !!mandate, tariffVersion: tariff.version, tariffValidTo: tariff.validTo, ...rest, commissionBp: rules.commissionBp, commissionKop, platformKop, agencyKop: commissionKop - platformKop, quoteValidHours: DEMO_RULES.quoteValidityHours, alternatives: Object.keys(rules.baseRateBp).map(Number) };
}

export type SubmitInput = {
  requestId: string; requestVersion: number; productId: string; premiumKop: number; deductibleRub?: number;
  discountKop?: number; discountPayer?: "AGENCY_COMMISSION" | null; feesKop?: number; publish: boolean; via?: "MANUAL" | "CONFIRM" | "AUTO";
};

/**
 * Подать или улучшить предложение (reverse auction). Все проверки — на сервере (AC04, AC05, AC06):
 * участник, полномочия, подписка, версия заявки, окно торгов, разрешённые пределы цены, отсутствие скрытых сборов,
 * шаг улучшения, одна активная версия на (заявка, агентство, страховщик, продукт), продление окна.
 */
export async function submitQuote(ctx: { orgId: string; userId: string | null; correlationId?: string; role?: string }, i: SubmitInput) {
  if (ctx.userId) await rateLimit(`quote:${ctx.userId}`, 60, 600);
  return txRetry(async (tx) => {
    await lockRow(tx, "InsuranceRequest", i.requestId);
    const t = await now();
    const r = await tx.insuranceRequest.findUnique({ where: { id: i.requestId } });
    if (!r) throw err("NOT_FOUND", "Заявка не найдена");
    if (r.kind !== "CLASSIC") throw err("FORBIDDEN", "Для событийных продуктов действует мгновенная котировка по утверждённому тарифу");
    if (r.currentVersion !== i.requestVersion) throw err("VERSION_CHANGED", "Клиент изменил заявку — рассчитайте предложение по новой версии");
    const auction = await tx.auction.findFirst({ where: { requestId: r.id, requestVersion: r.currentVersion } });
    if (!auction) throw err("NOT_FOUND", "Торги не найдены");
    if (!((auction.eligibleOrgIds as string[]) ?? []).includes(ctx.orgId)) throw err("NOT_FOUND", "Заявка не найдена");
    await lockRow(tx, "Auction", auction.id);
    const a = await syncAuction(tx, auction.id, t);
    if (a.status === "PAUSED") throw err("CONFLICT", "Клиент выбрал предложение — новые предложения временно не принимаются");
    if (a.status !== "OPEN" && a.status !== "EXTENDED") throw err("INVALID_TRANSITION", "Окно предложений закрыто");
    if (r.status !== "OPEN") throw err("INVALID_TRANSITION", "Заявка не принимает предложения");

    const product = await tx.product.findUnique({ where: { id: i.productId }, include: { versions: { where: { status: "PUBLISHED" }, take: 1, orderBy: { version: "desc" } } } });
    if (!product || product.status !== "PUBLISHED" || (product.versions[0]?.terms as any)?.productCode !== r.productCode) throw err("VALIDATION", "Продукт не подходит к заявке");
    const { org } = await assertAgencyMayQuote(tx, ctx.orgId, product.id, t);
    const sub = await assertCanRespond(tx, ctx.orgId, r.id, t);

    const v = await tx.requestVersion.findUniqueOrThrow({ where: { requestId_version: { requestId: r.id, version: r.currentVersion } } });
    const data = { ...(v.data as any) };
    const ded = i.deductibleRub ?? Number(data.deductible_rub);
    if (ded !== Number(data.deductible_rub) && !data.allow_alt_deductible) throw err("VALIDATION", "Клиент не допускает другую франшизу");
    data.deductible_rub = String(ded);

    const { tariff, stale, reason } = await activeTariff(tx, product.id, product.carrierOrgId, t);
    let publish = i.publish;
    let draftReason: string | null = null;
    if (!tariff || stale) { publish = false; draftReason = `Тарифный источник недоступен или устарел: ${reason}`; }
    if (!tariff) throw err("SOURCE_UNAVAILABLE", draftReason!);
    const rules = tariff.rules as unknown as ClassicRules & { commissionBp: number; allowedFeesKop?: number };
    const calc = computeClassic(rules, data, t.getUTCFullYear());
    if (!calc.ok) throw err("VALIDATION", `Тариф не допускает расчёт: ${calc.reason}`);
    if (!Number.isInteger(i.premiumKop) || i.premiumKop % 100 !== 0) throw err("VALIDATION", "Премия указывается в целых рублях");
    if (i.premiumKop < calc.minPremiumKop || i.premiumKop > calc.maxPremiumKop) {
      throw err("FORBIDDEN", `Премия вне разрешённой котировки страховщика: допустимо от ${calc.minPremiumKop / 100} до ${calc.maxPremiumKop / 100} ₽`, { min: calc.minPremiumKop, max: calc.maxPremiumKop });
    }
    const feesKop = i.feesKop ?? 0;
    if (feesKop !== 0 && feesKop !== (rules.allowedFeesKop ?? 0)) throw err("FORBIDDEN", "Дополнительные сборы не предусмотрены тарифом: скрытая комиссия не допускается");
    const discountKop = i.discountKop ?? 0;
    const commissionKop = applyBp(i.premiumKop, rules.commissionBp);
    if (discountKop > 0) {
      if (i.discountPayer !== "AGENCY_COMMISSION") throw err("VALIDATION", "Скидка должна иметь указанного плательщика (вознаграждение агентства)");
      if (discountKop > commissionKop - applyBp(commissionKop, DEMO_RULES.platformShareBp)) throw err("FORBIDDEN", "Скидка не может превышать долю вознаграждения агентства");
    }
    const totalKop = i.premiumKop + feesKop - discountKop;

    const terms = termsFromRequest(r.productCode, data, rules, { deductibleRub: ded });
    const fp = coverageFingerprint(terms);
    const prev = await tx.quote.findFirst({ where: { requestId: r.id, agencyOrgId: ctx.orgId, carrierOrgId: product.carrierOrgId, productId: product.id, status: { in: ["DRAFT", "PUBLISHED", "SELECTED"] } } });
    if (prev?.status === "SELECTED") throw err("CONFLICT", "Предложение выбрано клиентом — изменения только через отмену оформления");
    // Поданное предложение фиксировано: можно только снизить цену при тех же условиях.
    const withdrawn = await tx.quote.findFirst({ where: { requestId: r.id, requestVersion: r.currentVersion, agencyOrgId: ctx.orgId, productId: product.id, status: "WITHDRAWN" } });
    if (withdrawn && !prev) throw err("FORBIDDEN", "Предложение по этому продукту было отозвано: повторно подать его по этой заявке нельзя");
    let improvement = false;
    if (prev && prev.status === "PUBLISHED" && publish) {
      if (prev.coverageFingerprint !== fp) throw err("FORBIDDEN", "Условия поданного предложения менять нельзя: можно только снизить цену");
      if (totalKop > prev.totalKop) throw err("FORBIDDEN", "После подачи цену можно только снижать");
      if (totalKop === prev.totalKop) throw err("ALREADY_DONE", "Такое предложение уже опубликовано");
      if (prev.totalKop - totalKop < a.minStepKop) throw err("VALIDATION", `Улучшение цены должно быть не меньше ${a.minStepKop / 100} ₽`);
      improvement = true;
    }

    if (publish) await recordResponseUsage(tx, ctx.orgId, r.id, sub.periodStart);

    if (prev) {
      await tx.quote.update({ where: { id: prev.id }, data: { status: "REPLACED", version: { increment: 1 } } });
      await tx.quoteEvent.create({ data: { quoteId: prev.id, type: "REPLACED" } });
    }
    const q = await tx.quote.create({
      data: {
        requestId: r.id, requestVersion: r.currentVersion, auctionId: a.id, agencyOrgId: ctx.orgId, carrierOrgId: product.carrierOrgId, productId: product.id, agentUserId: ctx.userId,
        status: publish ? "PUBLISHED" : "DRAFT", seq: (prev?.seq ?? 0) + 1, replacesQuoteId: prev?.id ?? null, coverageFingerprint: fp, terms: terms as any,
        premiumKop: i.premiumKop, feesKop, discountKop, discountPayer: discountKop ? "AGENCY_COMMISSION" : null, totalKop, sourceType: "TARIFF_GRID", tariffVersionId: tariff.id,
        commissionPct: rules.commissionBp, inspectionRequired: calc.inspectionRequired, expiresAt: new Date(t.getTime() + DEMO_RULES.quoteValidityHours * 3600_000),
        createdVia: i.via ?? "MANUAL", publishedAt: publish ? t : null, withdrawReason: draftReason,
      },
    });
    await tx.quoteEvent.create({ data: { quoteId: q.id, type: publish ? (prev ? "REVISED" : "PUBLISHED") : "DRAFT_SAVED", data: { totalKop, prevTotalKop: prev?.totalKop ?? null, via: i.via ?? "MANUAL" } } });

    // Продление окна: улучшение или новое предложение в последние 15 минут продлевает на 15 минут, суммарно не больше часа.
    let extended = false;
    if (publish && (improvement || !prev) && a.closesAt.getTime() - t.getTime() <= DEMO_RULES.extendThresholdSec * 1000 && a.extensionTotalSec < DEMO_RULES.maxExtensionSec) {
      const add = Math.min(DEMO_RULES.extendBySec, DEMO_RULES.maxExtensionSec - a.extensionTotalSec);
      const closesAt = new Date(a.closesAt.getTime() + add * 1000);
      assertTransition("auction", a.status, "EXTENDED", "SYSTEM");
      await tx.auction.update({ where: { id: a.id }, data: { status: "EXTENDED", closesAt, extensionTotalSec: a.extensionTotalSec + add, version: { increment: 1 } } });
      await enqueue(tx, "auction.close", { auctionId: a.id }, { runAt: closesAt, uniqueKey: `auction.close:${a.id}:${closesAt.getTime()}` });
      await audit(tx, { role: "SYSTEM" }, "auction.extended", "Auction", a.id, { before: { closesAt: a.closesAt }, after: { closesAt } });
      extended = true;
    }
    await audit(tx, { userId: ctx.userId, orgId: ctx.orgId, role: ctx.role ?? "AGENT", correlationId: ctx.correlationId }, publish ? (prev ? "quote.revised" : "quote.published") : "quote.draft", "Quote", q.id, { after: { totalKop, fingerprint: fp, seq: q.seq } });
    if (publish) await notify(tx, r.clientId, { type: "quote.new", title: prev ? "Предложение обновлено" : "Новое предложение", body: `${org.name}: ${(totalKop / 100).toLocaleString("ru-RU")} ₽`, link: `/c/requests/${r.id}` });
    return { quote: q, extended, draftReason };
  });
}

export async function withdrawQuote(ctx: Ctx & { orgId: string }, quoteId: string, reason: string) {
  return txRetry(async (tx) => {
    await lockRow(tx, "Quote", quoteId);
    const q = await tx.quote.findFirst({ where: { id: quoteId, agencyOrgId: ctx.orgId } });
    if (!q) throw err("NOT_FOUND", "Предложение не найдено");
    if (q.status === "SELECTED") throw err("INVALID_TRANSITION", "После резерва отзыв возможен только через отмену оформления с уведомлением клиента");
    assertTransition("quote", q.status, "WITHDRAWN", ctx.org?.role === "AGENCY_OWNER" ? "OWNER" : "AGENT");
    const upd = await tx.quote.update({ where: { id: q.id }, data: { status: "WITHDRAWN", withdrawReason: reason, version: { increment: 1 } } });
    await tx.quoteEvent.create({ data: { quoteId: q.id, type: "WITHDRAWN", data: { reason } } });
    const r = await tx.insuranceRequest.findUniqueOrThrow({ where: { id: q.requestId } });
    await notify(tx, r.clientId, { type: "quote.withdrawn", title: "Предложение отозвано", body: `Причина: ${reason}`, link: `/c/requests/${r.id}` });
    await audit(tx, actor(ctx), "quote.withdrawn", "Quote", q.id, { reason });
    return upd;
  });
}

/** Сравнение для клиента: группы сопоставимости, сортировка по общей цене внутри группы, отличия альтернатив (AC05). */
export async function offersForClient(ctx: Ctx, requestId: string) {
  const r = await db.insuranceRequest.findFirst({ where: { id: requestId, clientId: ctx.user.id } });
  if (!r) throw err("NOT_FOUND", "Заявка не найдена");
  const t = await now();
  const auction = r.currentVersion ? await db.auction.findFirst({ where: { requestId, requestVersion: r.currentVersion } }) : null;
  if (auction && (auction.status === "OPEN" || auction.status === "EXTENDED") && auction.closesAt <= t) await txRetry((tx) => syncAuction(tx, auction.id, t));
  const quotes = await db.quote.findMany({ where: { requestId, requestVersion: r.currentVersion, status: { in: ["PUBLISHED", "SELECTED"] } }, orderBy: { totalKop: "asc" } });
  const orgIds = [...new Set(quotes.flatMap((q) => [q.agencyOrgId, q.carrierOrgId]).filter(Boolean) as string[])];
  const orgs = await db.organization.findMany({ where: { id: { in: orgIds } } });
  const ratings = await db.review.groupBy({ by: ["agencyOrgId"], where: { agencyOrgId: { in: orgIds }, status: "PUBLISHED" }, _avg: { rating: true }, _count: true });
  const data = r.data as any;
  const requested = { deductibleRub: Number(data.deductible_rub) };
  const groups = new Map<string, any[]>();
  for (const q of quotes) { const g = groups.get(q.coverageFingerprint) ?? []; g.push(q); groups.set(q.coverageFingerprint, g); }
  const carrierCount = (cid: string) => quotes.filter((x) => x.carrierOrgId === cid).length;
  const out = [...groups.entries()].map(([fp, list]) => {
    const terms = list[0].terms as any;
    const diffs: string[] = [];
    if (r.kind === "CLASSIC" && terms.deductibleRub !== requested.deductibleRub) diffs.push(`Франшиза ${terms.deductibleRub.toLocaleString("ru-RU")} ₽ вместо ${requested.deductibleRub.toLocaleString("ru-RU")} ₽`);
    return {
      fingerprint: fp, matchesRequest: diffs.length === 0, differences: diffs, terms,
      offers: list.sort((a, b) => a.totalKop - b.totalKop).map((q, idx) => {
        const ag = orgs.find((o) => o.id === q.agencyOrgId); const ca = orgs.find((o) => o.id === q.carrierOrgId);
        const rt = ratings.find((x) => x.agencyOrgId === q.agencyOrgId);
        return { id: q.id, seq: q.seq, rankInGroup: idx + 1, status: q.status, agency: ag ? { id: ag.id, name: ag.name } : null, carrier: { id: ca?.id, name: ca?.name }, sameCarrierOtherAgents: carrierCount(q.carrierOrgId) > 1,
          premiumKop: q.premiumKop, feesKop: q.feesKop, discountKop: q.discountKop, discountPayer: q.discountPayer, totalKop: q.totalKop, expiresAt: q.expiresAt, expired: q.expiresAt <= t,
          isPreliminary: q.isPreliminary, inspectionRequired: q.inspectionRequired, sourceType: q.sourceType, rating: rt ? { avg: rt._avg.rating, count: rt._count } : null, terms: q.terms };
      }),
    };
  }).sort((a, b) => Number(b.matchesRequest) - Number(a.matchesRequest));
  return { request: r, auction: auction ? await db.auction.findUnique({ where: { id: auction.id } }) : null, groups: out, serverNow: t };
}

/** Агенту — только своё место среди полностью сопоставимых и наличие лучшего предложения (без цен, имён и комиссий конкурентов). */
export async function rankForAgency(orgId: string, requestId: string) {
  const r = await db.insuranceRequest.findUnique({ where: { id: requestId } });
  if (!r) return null;
  const mine = await db.quote.findMany({ where: { requestId, agencyOrgId: orgId, requestVersion: r.currentVersion, status: { in: ["PUBLISHED", "SELECTED", "DRAFT"] } } });
  const res = [];
  for (const q of mine) {
    const comparable = await db.quote.findMany({ where: { requestId, requestVersion: r.currentVersion, status: { in: ["PUBLISHED", "SELECTED"] }, coverageFingerprint: q.coverageFingerprint }, select: { id: true, totalKop: true } });
    const better = comparable.filter((c) => c.totalKop < q.totalKop).length;
    res.push({ quoteId: q.id, status: q.status, place: q.status === "DRAFT" ? null : better + 1, comparableCount: comparable.length, betterExists: better > 0, minCompetitorPrice: DEMO_RULES.showCompetitorMinPrice ? Math.min(...comparable.map((c) => c.totalKop)) : undefined });
  }
  return res;
}

export async function publishDraftQuote(ctx: Ctx & { orgId: string }, quoteId: string) {
  const q = await db.quote.findFirst({ where: { id: quoteId, agencyOrgId: ctx.orgId, status: "DRAFT" } });
  if (!q) throw err("NOT_FOUND", "Черновик не найден");
  const terms = q.terms as any;
  return submitQuote({ orgId: ctx.orgId, userId: ctx.user.id, correlationId: ctx.correlationId, role: "AGENT" }, { requestId: q.requestId, requestVersion: q.requestVersion, productId: q.productId, premiumKop: q.premiumKop, deductibleRub: terms.deductibleRub, discountKop: q.discountKop, discountPayer: q.discountPayer as any, feesKop: q.feesKop, publish: true, via: q.createdVia === "CONFIRM" ? "CONFIRM" : "MANUAL" });
}

export { schemaFor };
