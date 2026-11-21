import { DateTime } from "luxon";
import { db, txRetry, type Tx } from "../db";
import { err } from "../errors";
import { now } from "../clock";
import { audit, SYSTEM, type Actor } from "../audit";
import { assertTransition } from "../state/machines";
import { withIdempotency } from "../idempotency";
import { actor as ctxActor, asAdmin, type Ctx } from "../access";
import { build, canonicalKeyOf, canonicalTerms, extract, termsHashOf, EXTRACTOR_VERSION, type IntentFields } from "./intake";
import { placeByKey, stationOf, PLACES } from "./geo";
import { TEMPLATES, type TemplateCode } from "./templates";
import { matchAll, MATCH_VERSION, type MarketTerms } from "./matcher";
import { priceFor, spreadCents, SIM_VENUE_FEE_RULE, type Level, type Side } from "./pricing";
import { mockVenue, readOnlyMarketData, liveTradingEnabled, LIVE_ORDER_ROUTE_EXISTS, OUTAGE_KEY } from "./venue";
import { FIXTURE_MARKETS, fixtureById } from "./fixtures";
import { checkLimit, restrictionFor, tierFor, TIERS } from "./limits";
import { brierBp, decide, pickObservations, windowDays } from "./oracle";

/** Владелец черновика: аккаунт или гость (хэш cookie). Все запросы к данным — с этим фильтром. */
export type Owner = { userId: string; guestKeyHash?: undefined } | { userId?: undefined; guestKeyHash: string };
export const QUOTE_TTL_SEC = 60;
const ownerWhere = (o: Owner) => (o.userId ? { ownerUserId: o.userId } : { guestKeyHash: o.guestKeyHash!, ownerUserId: null });
const ownerActor = (o: Owner, ctx?: Ctx | null): Actor => (ctx ? ctxActor(ctx) : { userId: o.userId ?? null, role: o.userId ? "CLIENT" : "GUEST" });
const ownerRole = (o: Owner) => (o.userId ? "CLIENT" : "GUEST");
const today = async (tz = "America/New_York") => DateTime.fromJSDate(await now()).setZone(tz);

// ───────────── Risk Intake ─────────────

function intentDto(r: any) {
  const place = placeByKey(r.placeKey);
  return {
    id: r.id, version: r.version, status: r.status, rawDescription: r.rawDescription, category: r.category,
    templateCode: (Object.values(TEMPLATES).find((t) => t.category === r.category)?.code ?? null) as TemplateCode | null,
    place: place ? { key: place.key, name: place.name, timezone: place.timezone, stations: place.stations } : null,
    stationId: r.stationId, window: { startLocal: r.windowStartLocal, endLocal: r.windowEndLocal, timezone: r.timezone, startUtc: r.startUtc, endUtc: r.endUtc },
    trigger: { metric: r.metric, operator: r.operator, thresholdX100: r.thresholdX100, unit: r.unit },
    desiredPayoutCents: r.desiredPayoutCents, budgetCents: r.budgetCents, unresolved: r.unresolved, basisRisk: r.basisRisk,
    manipulationRisk: r.manipulationRisk, confidence: r.confidence, extractorVersion: r.extractorVersion, eventDefinitionId: r.eventDefinitionId,
    executionMode: r.executionMode, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
export type IntentDto = ReturnType<typeof intentDto>;

function persistable(b: ReturnType<typeof build>, f: IntentFields) {
  return {
    category: b.category, placeKey: b.placeKey, placeText: f.placeText, stationId: b.stationId, windowStartLocal: b.windowStartLocal, windowEndLocal: b.windowEndLocal,
    timezone: b.timezone, startUtc: b.startUtc, endUtc: b.endUtc, metric: b.metric, operator: b.operator, thresholdX100: b.thresholdX100, unit: b.unit,
    desiredPayoutCents: b.desiredPayoutCents, budgetCents: b.budgetCents, unresolved: b.unresolved as any, basisRisk: b.basisRisk as any,
    manipulationRisk: b.manipulationRisk, confidence: b.confidence, extractorVersion: EXTRACTOR_VERSION,
  };
}

export async function createIntent(owner: Owner, text: string, ctx?: Ctx | null) {
  const t = await today();
  const f = extract(text, t);
  const b = build(f, t);
  const r = await db.$transaction(async (tx) => {
    const row = await tx.riskIntent.create({ data: { ownerUserId: owner.userId ?? null, guestKeyHash: owner.guestKeyHash ?? null, rawDescription: text, ...persistable(b, f), status: b.status } });
    await audit(tx, ownerActor(owner, ctx), "ev.intent.create", "RiskIntent", row.id, { after: { status: row.status, category: row.category, unresolved: b.unresolved.map((u) => u.field) } });
    return row;
  });
  return { ...intentDto(r), monthHint: f.monthHint };
}

export async function getIntent(owner: Owner, id: string) {
  const r = await db.riskIntent.findFirst({ where: { id, ...ownerWhere(owner) } });
  if (!r) throw err("NOT_FOUND", "Risk not found");
  return intentDto(r);
}
export async function listIntents(owner: Owner) {
  return (await db.riskIntent.findMany({ where: { ...ownerWhere(owner), status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" }, take: 50 })).map(intentDto);
}

export type Clarify = Partial<{ placeKey: string; stationId: string | null; windowStartLocal: string; windowEndLocal: string; thresholdX100: number; desiredPayoutCents: number; budgetCents: number | null }>;

/** Уточнение условий: сервер пересобирает намерение; изменение после подтверждения — новая версия и повторная проверка. */
export async function clarifyIntent(owner: Owner, id: string, version: number, patch: Clarify, ctx?: Ctx | null) {
  const cur = await db.riskIntent.findFirst({ where: { id, ...ownerWhere(owner) } });
  if (!cur) throw err("NOT_FOUND", "Risk not found");
  if (cur.version !== version) throw err("VERSION_CHANGED", "This risk was changed in another tab. Reload to see the latest version.");
  if (patch.placeKey && !placeByKey(patch.placeKey)) throw err("VALIDATION", "Unsupported location");
  const placeKey = patch.placeKey ?? cur.placeKey;
  const placeChanged = placeKey !== cur.placeKey;
  const stationId = patch.stationId !== undefined ? patch.stationId : placeChanged ? null : cur.stationId;
  if (stationId && !stationOf(placeKey, stationId)) throw err("VALIDATION", "This station is not available for the chosen location");
  const f: IntentFields = {
    category: cur.category, placeKey, placeText: cur.placeText, stationId,
    windowStartLocal: patch.windowStartLocal ?? cur.windowStartLocal, windowEndLocal: patch.windowEndLocal ?? cur.windowEndLocal,
    timezone: placeByKey(placeKey)?.timezone ?? cur.timezone, monthHint: null,
    operator: cur.operator as any, thresholdX100: patch.thresholdX100 ?? cur.thresholdX100, unit: cur.unit, metric: cur.metric,
    desiredPayoutCents: patch.desiredPayoutCents ?? cur.desiredPayoutCents, budgetCents: patch.budgetCents !== undefined ? patch.budgetCents : cur.budgetCents,
  };
  const b = build(f, await today(f.timezone ?? undefined));
  assertTransition("evIntent", cur.status, b.status, ownerRole(owner));
  const r = await db.$transaction(async (tx) => {
    const u = await tx.riskIntent.updateMany({ where: { id, version }, data: { ...persistable(b, f), status: b.status, eventDefinitionId: null, version: { increment: 1 } } });
    if (u.count !== 1) throw err("VERSION_CHANGED", "This risk was changed in another tab. Reload to see the latest version.");
    await audit(tx, ownerActor(owner, ctx), "ev.intent.clarify", "RiskIntent", id, { before: { status: cur.status, version }, after: { status: b.status, fields: Object.keys(patch) } });
    return tx.riskIntent.findUniqueOrThrow({ where: { id } });
  });
  return intentDto(r);
}

/** Подтверждение человеком: создаётся неизменяемое EventDefinition (по canonical key). Это не листинг контракта. */
export async function confirmIntent(owner: Owner, id: string, version: number, ctx?: Ctx | null) {
  const cur = await db.riskIntent.findFirst({ where: { id, ...ownerWhere(owner) } });
  if (!cur) throw err("NOT_FOUND", "Risk not found");
  if (cur.version !== version) throw err("VERSION_CHANGED", "This risk changed. Review the latest terms before confirming.");
  if (cur.status !== "READY_FOR_REVIEW") throw err("NEEDS_INFO", "Answer the open questions before confirming", { unresolved: cur.unresolved });
  assertTransition("evIntent", cur.status, "CONFIRMED", ownerRole(owner));
  const tpl = TEMPLATES[(Object.values(TEMPLATES).find((t) => t.category === cur.category)!.code)];
  const terms = canonicalTerms({ templateCode: tpl.code, stationId: cur.stationId, operator: cur.operator, thresholdX100: cur.thresholdX100, windowStartLocal: cur.windowStartLocal, windowEndLocal: cur.windowEndLocal, timezone: cur.timezone });
  const canonicalKey = canonicalKeyOf({ ...terms, templateCode: tpl.code, stationId: cur.stationId, windowStartLocal: cur.windowStartLocal, windowEndLocal: cur.windowEndLocal });
  const r = await txRetry(async (tx) => {
    const def = await tx.eventDefinition.upsert({
      where: { canonicalKey_version: { canonicalKey, version: 1 } }, update: {},
      create: {
        canonicalKey, templateCode: tpl.code, metric: tpl.metric, operator: tpl.operator, thresholdX100: cur.thresholdX100!, unit: tpl.unit, aggregation: tpl.aggregation,
        stationId: cur.stationId!, timezone: cur.timezone!, windowStartLocal: cur.windowStartLocal!, windowEndLocal: cur.windowEndLocal!, startUtc: cur.startUtc!, endUtc: cur.endUtc!,
        source: tpl.source, fallbackSource: tpl.fallbackSource, missingDataPolicy: tpl.missingDataPolicy, ruleHash: termsHashOf(terms), manipulationRisk: tpl.manipulationRisk,
        lifecycle: tpl.manipulationRisk ? "COMPLIANCE_REVIEW" : "VALIDATED",
      },
    });
    const u = await tx.riskIntent.updateMany({ where: { id, version }, data: { status: "CONFIRMED", eventDefinitionId: def.id, version: { increment: 1 } } });
    if (u.count !== 1) throw err("VERSION_CHANGED", "This risk changed. Review the latest terms before confirming.");
    await audit(tx, ownerActor(owner, ctx), "ev.intent.confirm", "RiskIntent", id, { before: { status: cur.status }, after: { status: "CONFIRMED", eventDefinitionId: def.id, ruleHash: def.ruleHash } });
    return tx.riskIntent.findUniqueOrThrow({ where: { id } });
  });
  return intentDto(r);
}

export async function archiveIntent(owner: Owner, id: string, ctx?: Ctx | null) {
  const cur = await db.riskIntent.findFirst({ where: { id, ...ownerWhere(owner) } });
  if (!cur) throw err("NOT_FOUND", "Risk not found");
  assertTransition("evIntent", cur.status, "ARCHIVED", ownerRole(owner));
  await db.$transaction(async (tx) => {
    await tx.riskIntent.update({ where: { id }, data: { status: "ARCHIVED", version: { increment: 1 } } });
    await audit(tx, ownerActor(owner, ctx), "ev.intent.archive", "RiskIntent", id, { before: { status: cur.status } });
  });
}

/** После входа черновики гостя переходят владельцу (действие самого пользователя). */
export async function claimGuestIntents(userId: string, guestKeyHash: string) {
  const r = await db.riskIntent.updateMany({ where: { guestKeyHash, ownerUserId: null }, data: { ownerUserId: userId, guestKeyHash: null } });
  if (r.count) await audit(db, { userId, role: "CLIENT" }, "ev.intent.claim_guest", "RiskIntent", null, { after: { count: r.count } });
  return r.count;
}

export async function addDemand(owner: Owner, id: string, kind: "WATCH" | "WAITLIST" | "SUGGEST_SPEC", note?: string) {
  const cur = await db.riskIntent.findFirst({ where: { id, ...ownerWhere(owner) } });
  if (!cur) throw err("NOT_FOUND", "Risk not found");
  const d = await db.demandSignal.upsert({ where: { riskIntentId_kind: { riskIntentId: id, kind } }, update: { note: note ?? undefined }, create: { riskIntentId: id, userId: owner.userId ?? null, kind, note } });
  await audit(db, ownerActor(owner), "ev.demand", "RiskIntent", id, { after: { kind } });
  return { id: d.id, kind };
}

// ───────────── Market Discovery ─────────────

export function marketTerms(m: { terms: any; templateCode: string }): MarketTerms & { fallbackStationId: string | null; placeKey: string; metric?: string; source?: string; aggregation?: string } {
  return { ...(m.terms as any), templateCode: m.templateCode };
}
function marketDto(m: any) {
  const t = marketTerms(m);
  const tpl = TEMPLATES[m.templateCode as TemplateCode];
  return {
    id: m.id, venue: m.venue, venueMarketId: m.venueMarketId, sourceKind: m.sourceKind, title: m.title, templateCode: m.templateCode, template: tpl,
    terms: t, termsHash: m.termsHash, termsVersion: m.termsVersion, currency: m.currency, unitPayoutCents: m.unitPayoutCents, status: m.status,
    complianceStatus: m.complianceStatus, regulatoryNote: m.regulatoryNote, eventRootKey: m.eventRootKey, objectKey: m.objectKey,
    manipulationRisk: m.manipulationRisk, tradingCloseUtc: m.tradingCloseUtc, station: stationOf(t.placeKey, t.stationId), place: placeByKey(t.placeKey),
  };
}
export type MarketDto = ReturnType<typeof marketDto>;

export async function listMarkets() { return (await db.venueMarket.findMany({ orderBy: [{ templateCode: "asc" }, { title: "asc" }] })).map(marketDto); }
export async function getMarket(id: string) {
  const m = await db.venueMarket.findUnique({ where: { id } });
  if (!m) throw err("NOT_FOUND", "Contract not found");
  return marketDto(m);
}

/** Поиск рынков для намерения: симулированная площадка + внешние источники (не настроены → честно «нет данных»). */
export async function marketMatches(owner: Owner, id: string) {
  const intent = await db.riskIntent.findFirst({ where: { id, ...ownerWhere(owner) } });
  if (!intent) throw err("NOT_FOUND", "Risk not found");
  const tplCode = Object.values(TEMPLATES).find((t) => t.category === intent.category)?.code ?? null;
  const markets = await db.venueMarket.findMany({ where: { venue: mockVenue.name } });
  const draft = { templateCode: tplCode, placeKey: intent.placeKey, stationId: intent.stationId, operator: intent.operator, thresholdX100: intent.thresholdX100, windowStartLocal: intent.windowStartLocal, windowEndLocal: intent.windowEndLocal };
  const sim = matchAll(draft, markets.map((m) => ({ ...marketTerms(m), id: m.id, status: m.status, complianceStatus: m.complianceStatus, manipulationRisk: m.manipulationRisk })));
  const matchVersion = `${MATCH_VERSION}:intent-v${intent.version}`;
  const byId = new Map(markets.map((m) => [m.id, m]));
  const existing = await db.matchAssessment.findMany({ where: { riskIntentId: id } });
  const rows = sim.results.map((r) => ({ riskIntentId: id, marketId: r.marketId, exactness: r.exactness, mismatchTags: r.tags as any, explanation: r.explanation, matchVersion, termsHash: byId.get(r.marketId)!.termsHash, modelVersion: EXTRACTOR_VERSION, sourceRefs: [{ venue: mockVenue.name, venueMarketId: byId.get(r.marketId)!.venueMarketId, sourceKind: "SIMULATED" }] as any, confidence: r.confidence }));
  const fresh = rows.filter((r) => !existing.some((e) => e.marketId === r.marketId && e.matchVersion === r.matchVersion && e.termsHash === r.termsHash));
  if (fresh.length) await db.matchAssessment.createMany({ data: fresh });
  if (!rows.length && !existing.some((e) => e.matchVersion === matchVersion && e.exactness === "NONE")) {
    await db.matchAssessment.create({ data: { riskIntentId: id, marketId: null, exactness: "NONE", explanation: "No listed simulated contract matches this risk.", matchVersion, modelVersion: EXTRACTOR_VERSION, confidence: 90 } });
  }
  // Пересмотр: сопоставление, сделанное по прежним условиям рынка (termsHash), помечается как устаревшее (крит. 25).
  const termsChanged = existing.filter((e) => e.marketId && byId.get(e.marketId) && e.termsHash !== byId.get(e.marketId)!.termsHash).map((e) => e.marketId!);
  const live = await readOnlyMarketData.getVenueStatus();
  return {
    intentVersion: intent.version, matchVersion, intentStatus: intent.status,
    simulated: { overall: sim.overall, results: sim.results.map((r) => ({ ...r, market: marketDto(byId.get(r.marketId)!) })) },
    live: { overall: "NONE" as const, status: live, results: [] as never[], explanation: "No verified real market is connected, so no real contract can be offered." },
    termsChangedMarketIds: [...new Set(termsChanged)],
  };
}

// ───────────── Pricing / quotes ─────────────

export async function quote(marketId: string, side: Side, targetPayoutCents: number) {
  const m = await db.venueMarket.findUnique({ where: { id: marketId } });
  if (!m) throw err("NOT_FOUND", "Contract not found");
  if (m.venue !== mockVenue.name) throw err("INTEGRATION_NOT_CONFIGURED", "Quotes are available only from the simulated venue");
  const at = await now();
  const book = await mockVenue.getOrderbook(m.venueMarketId, at);
  const staleAt = new Date(book.takenAt.getTime() + QUOTE_TTL_SEC * 1000);
  const snap = await db.quoteSnapshot.create({ data: { marketId, source: book.source, sourceKind: book.sourceKind, yesAsks: book.yesAsks as any, noAsks: book.noAsks as any, termsHash: m.termsHash, takenAt: book.takenAt, staleAt } });
  return quoteDto(m, snap, side, targetPayoutCents, at);
}

function quoteDto(m: any, snap: any, side: Side, targetPayoutCents: number, at: Date) {
  const asks = (side === "YES" ? snap.yesAsks : snap.noAsks) as Level[];
  const calc = priceFor(side, asks, targetPayoutCents);
  const stale = at.getTime() >= snap.staleAt.getTime();
  const blockers: string[] = [];
  if (stale) blockers.push("STALE_QUOTE");
  if (m.status !== "OPEN") blockers.push(m.status === "SUSPENDED" ? "MARKET_SUSPENDED" : "MARKET_CLOSED");
  if (m.complianceStatus === "RESEARCH_ONLY" || m.complianceStatus === "BLOCKED") blockers.push("RESEARCH_ONLY");
  if (at >= m.tradingCloseUtc) blockers.push("TRADING_CLOSED");
  if (calc.filledUnits === 0) blockers.push("NO_DEPTH");
  return {
    marketId: m.id, quoteSnapshotId: snap.id, venue: m.venue, source: snap.source, sourceKind: snap.sourceKind, takenAt: snap.takenAt, staleAt: snap.staleAt,
    ageSec: Math.max(0, Math.floor((at.getTime() - snap.takenAt.getTime()) / 1000)), stale, termsHash: snap.termsHash, targetPayoutCents,
    book: { yesAsks: snap.yesAsks as Level[], noAsks: snap.noAsks as Level[], spreadCents: spreadCents(snap.yesAsks, snap.noAsks), bestYesBidCents: (snap.noAsks as Level[]).length ? 100 - Math.min(...(snap.noAsks as Level[]).map((l) => l[0])) : null },
    calc, feeRule: SIM_VENUE_FEE_RULE, canConfirm: blockers.length === 0, blockers, simulation: true,
  };
}
export type QuoteDto = ReturnType<typeof quoteDto>;

// ───────────── Eligibility, limits, conflicts ─────────────

async function userTier(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { riskTierOverride: true } });
  const ex = await db.expertProfile.findUnique({ where: { userId }, select: { moderationStatus: true } });
  return tierFor(u, ex?.moderationStatus === "APPROVED");
}
async function exposureByRoot(userId: string, eventRootKey: string) {
  const markets = await db.venueMarket.findMany({ where: { eventRootKey }, select: { id: true } });
  const lots = await db.position.findMany({ where: { userId, marketId: { in: markets.map((m) => m.id) }, state: { in: ["OPEN"] } }, select: { units: true } });
  return { lots: lots.length, payoutCents: lots.reduce((s, l) => s + l.units * 100, 0) };
}

export async function eligibility(ctx: Ctx | null) {
  const user = ctx ? await db.user.findUnique({ where: { id: ctx.user.id }, select: { usState: true, market: true, riskTierOverride: true } }) : null;
  const tier = ctx ? await userTier(ctx.user.id) : "T0";
  const reasons = ["LIVE_TRADING_DISABLED", "NO_REGULATED_PARTNER", "KYC_NOT_VERIFIED_BY_PARTNER", "STATE_NOT_CLEARED_BY_PARTNER"];
  return {
    simulation: { allowed: !!ctx, reason: ctx ? null : "Sign in to open paper positions. You can explore risks and quotes as a guest.", tier, tierLabel: TIERS[tier].label, maxPayoutPerEventCents: TIERS[tier].maxPayoutCents },
    live: { allowed: false, liveTradingFlag: liveTradingEnabled(), liveOrderRouteExists: LIVE_ORDER_ROUTE_EXISTS, reasons, declaredState: user?.usState ?? null, note: "Real-money event contracts would only be offered through a regulated partner after legal approval, the partner's KYC and its location checks. A state you declare here is never enough on its own." },
  };
}

export async function declareConflict(ctx: Ctx, objectKey: string, relationship: string, detail?: string) {
  if (!(await db.venueMarket.findFirst({ where: { objectKey } }))) throw err("NOT_FOUND", "Unknown project");
  const restriction = restrictionFor(relationship);
  const r = await db.$transaction(async (tx) => {
    const before = await tx.conflictDeclaration.findUnique({ where: { userId_objectKey: { userId: ctx.user.id, objectKey } } });
    // Ужесточение — сразу; снятие ограничения пользователем невозможно: только администратор (ручная проверка).
    const next = before && before.restriction !== "ALLOWED" && restriction === "ALLOWED" ? before.restriction : restriction;
    const row = await tx.conflictDeclaration.upsert({ where: { userId_objectKey: { userId: ctx.user.id, objectKey } }, update: { relationship, detail, restriction: next }, create: { userId: ctx.user.id, objectKey, relationship, detail, restriction: next } });
    await audit(tx, ctxActor(ctx), "ev.conflict.declare", "ConflictDeclaration", row.id, { before: before ? { relationship: before.relationship, restriction: before.restriction } : undefined, after: { relationship, restriction: next } });
    return row;
  });
  return { id: r.id, restriction: r.restriction };
}

// ───────────── Paper orders & positions ─────────────

export type OrderInput = { marketId: string; side: Side; targetPayoutCents: number; quoteSnapshotId: string; termsHash: string; riskIntentId?: string | null; allowPartial: boolean; confirm: true; idempotencyKey: string };

export async function placeSimOrder(ctx: Ctx, input: OrderInput) {
  if (ctx.user.kind !== "CLIENT") throw err("FORBIDDEN", "Paper positions are available to customer accounts");
  const { idempotencyKey, ...body } = input;
  return withIdempotency(ctx.user.id, "ev.sim_order", idempotencyKey, body, () => doPlace(ctx, body));
}

async function doPlace(ctx: Ctx, b: Omit<OrderInput, "idempotencyKey">) {
  const at = await now();
  const m = await db.venueMarket.findUnique({ where: { id: b.marketId } });
  if (!m) throw err("NOT_FOUND", "Contract not found");
  if (m.status !== "OPEN") throw err("SALES_SUSPENDED", m.status === "SUSPENDED" ? "This contract is suspended. No new positions." : "This contract is closed.");
  if (m.complianceStatus === "RESEARCH_ONLY" || m.complianceStatus === "BLOCKED") throw err("FORBIDDEN", "Research only: paper positions are not available for this contract.");
  if (at >= m.tradingCloseUtc) throw err("SALES_SUSPENDED", "Trading for this contract has closed.");
  if (b.termsHash !== m.termsHash) throw err("VERSION_CHANGED", "The contract terms changed after you reviewed them. Review the new terms and get a new quote.", { termsVersion: m.termsVersion });
  const snap = await db.quoteSnapshot.findUnique({ where: { id: b.quoteSnapshotId } });
  if (!snap || snap.marketId !== m.id) throw err("NOT_FOUND", "Quote not found");
  if (snap.termsHash !== m.termsHash) throw err("VERSION_CHANGED", "This quote was made for older contract terms. Get a new quote.");
  if (at.getTime() >= snap.staleAt.getTime()) throw err("QUOTE_EXPIRED", "This quote is out of date. Refresh the price before confirming.");
  if (b.riskIntentId && !(await db.riskIntent.findFirst({ where: { id: b.riskIntentId, ownerUserId: ctx.user.id } }))) throw err("NOT_FOUND", "Risk not found");
  if (m.complianceStatus === "RESTRICTED" || m.objectKey) {
    const decl = m.objectKey ? await db.conflictDeclaration.findUnique({ where: { userId_objectKey: { userId: ctx.user.id, objectKey: m.objectKey } } }) : null;
    if (!decl) throw err("NEEDS_INFO", "Declare whether you are connected to this project (employee, contractor, inspector, affiliate) before opening a paper position.", { need: "CONFLICT_DECLARATION", objectKey: m.objectKey });
    if (decl.restriction === "BLOCKED") throw err("FORBIDDEN", "Positions on this contract are not available to people connected with the project.", { restriction: "BLOCKED" });
    if (decl.restriction === "MANUAL_REVIEW") throw err("FORBIDDEN", "Your declaration needs a compliance review before you can open a position.", { restriction: "MANUAL_REVIEW" });
  }
  const calc = priceFor(b.side, (b.side === "YES" ? snap.yesAsks : snap.noAsks) as Level[], b.targetPayoutCents);
  if (calc.filledUnits === 0) throw err("CAPACITY_EXHAUSTED", "No depth is available at the simulated venue for this side.");
  if (calc.partial && !b.allowPartial) throw err("CAPACITY_EXHAUSTED", `Only ${calc.fillPct}% of the requested size is available. Confirm a partial fill or reduce the size.`, { fillPct: calc.fillPct, filledUnits: calc.filledUnits });
  const tier = await userTier(ctx.user.id);
  const exp = await exposureByRoot(ctx.user.id, m.eventRootKey);
  const lim = checkLimit(tier, exp.payoutCents, calc.filledUnits * 100);
  if (!lim.ok) throw err("LIMIT_EXCEEDED", `This would exceed your simulation limit for this event (${TIERS[tier].label}: up to $${lim.maxCents / 100} of possible payout across all related positions).`, { tier, maxCents: lim.maxCents, usedCents: lim.usedCents, remainingCents: lim.remainingCents, relatedLots: exp.lots });
  return txRetry(async (tx) => {
    const order = await tx.simOrder.create({ data: { userId: ctx.user.id, marketId: m.id, riskIntentId: b.riskIntentId ?? null, side: b.side, requestedUnits: calc.requestedUnits, filledUnits: calc.filledUnits, costCents: calc.costCents, feeCents: calc.venueFeeCents + calc.talismanFeeCents, quoteSnapshotId: snap.id, termsHash: m.termsHash, status: calc.partial ? "PARTIALLY_FILLED" : "FILLED", fills: { create: calc.fills } } });
    const pos = await tx.position.create({ data: { orderId: order.id, userId: ctx.user.id, marketId: m.id, side: b.side, units: calc.filledUnits, costCents: calc.costCents, feeCents: order.feeCents } });
    await audit(tx, ctxActor(ctx), "ev.sim_order.fill", "SimOrder", order.id, { after: { marketId: m.id, side: b.side, filledUnits: calc.filledUnits, costCents: calc.costCents, feeCents: order.feeCents, positionId: pos.id, simulation: true } });
    return { orderId: order.id, positionId: pos.id, status: order.status, filledUnits: calc.filledUnits, requestedUnits: calc.requestedUnits, costCents: calc.costCents, feeCents: order.feeCents, totalCents: calc.totalCents, maxLossCents: calc.maxLossCents, grossPayoutCents: calc.grossPayoutCents, simulation: true };
  });
}

export async function positions(ctx: Ctx) {
  const lots = await db.position.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" } });
  const markets = await db.venueMarket.findMany({ where: { id: { in: [...new Set(lots.map((l) => l.marketId))] } } });
  const res = await db.resolutionRecord.findMany({ where: { marketId: { in: markets.map((m) => m.id) } } });
  const st = await db.settlementRecord.findMany({ where: { positionId: { in: lots.map((l) => l.id) } } });
  return lots.map((l) => {
    const m = markets.find((x) => x.id === l.marketId)!;
    return { ...l, market: marketDto(m), resolution: res.find((r) => r.marketId === m.id) ?? null, settlement: st.find((s) => s.positionId === l.id) ?? null, maxLossCents: l.costCents + l.feeCents, grossIfPaysCents: l.units * 100 };
  });
}

// ───────────── Oracle, resolution, settlement ─────────────

async function adminActor(ctx: Ctx | null) { return ctx ? ctxActor(asAdmin(ctx, { mutation: true })) : SYSTEM; }

/** Сбор демонстрационных наблюдений и предложение исхода. Только после окончания окна события. */
export async function observeAndPropose(ctx: Ctx | null, marketId: string) {
  const a = await adminActor(ctx);
  const m = await db.venueMarket.findUnique({ where: { id: marketId } });
  if (!m) throw err("NOT_FOUND", "Contract not found");
  const t = marketTerms(m);
  const { endUtc } = { endUtc: DateTime.fromISO(t.windowEndLocal, { zone: t.timezone }).plus({ days: 1 }).startOf("day").toJSDate() };
  const at = await now();
  if (at < endUtc) throw err("VALIDATION", "The observation window has not ended yet");
  const f = fixtureById(m.venueMarketId);
  const days = windowDays(t.windowStartLocal, t.windowEndLocal);
  const obs = pickObservations(days, f?.observations ?? {}, f?.fallbackObservations, t.stationId, t.fallbackStationId ?? null);
  const decision = decide(m.templateCode, t.operator, t.thresholdX100, obs);
  return txRetry(async (tx) => {
    for (const o of obs) {
      const sourceTimestamp = DateTime.fromISO(o.day, { zone: t.timezone }).plus({ days: 1 }).toUTC().toJSDate();
      await tx.oracleObservation.createMany({ data: [{ marketId, sourceId: o.sourceId, isFallback: o.isFallback, metric: t.metric ?? m.templateCode, valueX100: o.valueX100, sourceTimestamp, retrievalTimestamp: at, evidenceHash: termsHashOf({ marketId, ...o }) }], skipDuplicates: true });
    }
    const cur = await tx.resolutionRecord.findUnique({ where: { marketId } });
    if (cur && (cur.status === "CONFIRMED" || cur.status === "DISPUTED")) throw err("ALREADY_DONE", `Resolution is already ${cur.status.toLowerCase()}`);
    if (m.status === "OPEN" || m.status === "SUSPENDED") { assertTransition("evMarket", m.status, "CLOSED", a.role === "SYSTEM" ? "SYSTEM" : "ADMIN"); await tx.venueMarket.update({ where: { id: marketId }, data: { status: "CLOSED", version: { increment: 1 } } }); }
    const tpl = TEMPLATES[m.templateCode as TemplateCode];
    const evidence = { observations: obs, decision, template: { code: tpl.code, version: tpl.version, aggregation: tpl.aggregation, missingDataPolicy: tpl.missingDataPolicy }, sourceKind: "SIMULATED" };
    const status = decision.status;
    if (cur) assertTransition("evResolution", cur.status, status, a.role === "SYSTEM" ? "SYSTEM" : "ADMIN");
    const data = { outcome: decision.status === "PROPOSED" ? decision.outcome : null, status, evidence: evidence as any, disputeDeadline: status === "PROPOSED" ? new Date(at.getTime() + tpl.disputeWindowHours * 3600_000) : null };
    const r = cur ? await tx.resolutionRecord.update({ where: { marketId }, data: { ...data, version: { increment: 1 } } }) : await tx.resolutionRecord.create({ data: { marketId, ...data } });
    await audit(tx, a, "ev.resolution.propose", "ResolutionRecord", r.id, { before: cur ? { status: cur.status, outcome: cur.outcome } : undefined, after: { status, outcome: r.outcome } });
    return r;
  });
}

export async function disputeResolution(ctx: Ctx, marketId: string, reason: string) {
  const held = await db.position.findFirst({ where: { userId: ctx.user.id, marketId } });
  if (!held) throw err("FORBIDDEN", "Only holders of a position in this contract can dispute");
  const at = await now();
  return db.$transaction(async (tx) => {
    const r = await tx.resolutionRecord.findUnique({ where: { marketId } });
    if (!r) throw err("NOT_FOUND", "No proposed outcome yet");
    if (r.disputeDeadline && at > r.disputeDeadline) throw err("VALIDATION", "The dispute window has ended");
    assertTransition("evResolution", r.status, "DISPUTED", "CLIENT");
    const u = await tx.resolutionRecord.update({ where: { id: r.id }, data: { status: "DISPUTED", disputeReason: reason, version: { increment: 1 } } });
    await audit(tx, ctxActor(ctx), "ev.resolution.dispute", "ResolutionRecord", r.id, { before: { status: r.status }, after: { status: "DISPUTED" }, reason });
    return u;
  });
}

/** Подтверждение исхода администратором и симулированный расчёт. Повтор не создаёт дублей (UNIQUE positionId). */
export async function finalizeResolution(ctx: Ctx, marketId: string, reason: string, outcomeOverride?: "YES" | "NO") {
  const a = await adminActor(ctx);
  const at = await now();
  const r = await db.resolutionRecord.findUnique({ where: { marketId } });
  if (!r) throw err("NOT_FOUND", "No proposed outcome");
  if (r.status === "CONFIRMED") return { resolution: r, settled: await settleMarket(marketId) };
  if (r.status === "NEEDS_DATA") throw err("NEEDS_INFO", "Data is missing. The outcome cannot be confirmed and nothing is paid until data is reviewed.");
  if (r.status === "PROPOSED" && r.disputeDeadline && at < r.disputeDeadline) throw err("VALIDATION", "The dispute window is still open");
  if (r.status === "DISPUTED" && !outcomeOverride) throw err("VALIDATION", "A disputed outcome needs an explicit decision (YES or NO) and a reason");
  const outcome = outcomeOverride ?? r.outcome!;
  assertTransition("evResolution", r.status, "CONFIRMED", "ADMIN");
  const res = await db.$transaction(async (tx) => {
    const u = await tx.resolutionRecord.updateMany({ where: { id: r.id, version: r.version }, data: { status: "CONFIRMED", outcome, confirmedAt: at, version: { increment: 1 } } });
    if (u.count !== 1) throw err("VERSION_CHANGED", "Resolution changed, reload");
    const m = await tx.venueMarket.findUniqueOrThrow({ where: { id: marketId } });
    assertTransition("evMarket", m.status, "RESOLVED", "ADMIN");
    await tx.venueMarket.update({ where: { id: marketId }, data: { status: "RESOLVED", version: { increment: 1 } } });
    await audit(tx, a, "ev.resolution.confirm", "ResolutionRecord", r.id, { before: { status: r.status, outcome: r.outcome }, after: { status: "CONFIRMED", outcome }, reason });
    return tx.resolutionRecord.findUniqueOrThrow({ where: { id: r.id } });
  });
  return { resolution: res, settled: await settleMarket(marketId) };
}

export async function settleMarket(marketId: string) {
  const r = await db.resolutionRecord.findUnique({ where: { marketId } });
  if (!r || r.status !== "CONFIRMED" || !r.outcome) throw err("NEEDS_INFO", "Only a confirmed outcome can be settled");
  const lots = await db.position.findMany({ where: { marketId, state: "OPEN" } });
  const at = await now();
  let created = 0;
  for (const p of lots) {
    const gross = p.side === r.outcome ? p.units * 100 : 0;
    await db.$transaction(async (tx) => {
      const ins = await tx.settlementRecord.createMany({ data: [{ positionId: p.id, partnerRef: `SIMULATED:${r.id}`, grossPayoutCents: gross, costCents: p.costCents, feesCents: p.feeCents, netCents: gross - p.costCents - p.feeCents, finalAt: at }], skipDuplicates: true });
      assertTransition("evPosition", "OPEN", "SETTLED", "SYSTEM");
      await tx.position.updateMany({ where: { id: p.id, state: "OPEN" }, data: { state: "SETTLED", version: { increment: 1 } } });
      if (ins.count) { created++; await audit(tx, SYSTEM, "ev.settlement.simulated", "Position", p.id, { after: { grossPayoutCents: gross, outcome: r.outcome, simulation: true } }); }
    });
  }
  const m = await db.venueMarket.findUniqueOrThrow({ where: { id: marketId } });
  if (m.status === "RESOLVED" && (await db.position.count({ where: { marketId, state: "OPEN" } })) === 0) {
    await db.$transaction(async (tx) => { assertTransition("evMarket", "RESOLVED", "SETTLED", "SYSTEM"); await tx.venueMarket.update({ where: { id: marketId }, data: { status: "SETTLED" } }); await audit(tx, SYSTEM, "ev.market.settled", "VenueMarket", marketId); });
  }
  return created;
}

/** Событие площадки (симулированный вебхук): повтор с тем же id не создаёт дублей (WebhookInbox). */
export async function ingestVenueEvent(payload: { eventId: string; type: "RESOLUTION_CONFIRMED"; marketId: string; outcome: "YES" | "NO" }, ctx: Ctx) {
  asAdmin(ctx, { mutation: true });
  const ins = await db.webhookInbox.createMany({ data: [{ provider: "MOCK_VENUE", externalEventId: payload.eventId, payload: payload as any, signatureValid: true }], skipDuplicates: true });
  if (!ins.count) { await db.webhookInbox.update({ where: { provider_externalEventId: { provider: "MOCK_VENUE", externalEventId: payload.eventId } }, data: { receivedCount: { increment: 1 } } }); return { duplicate: true }; }
  const r = await finalizeResolution(ctx, payload.marketId, `venue event ${payload.eventId}`, payload.outcome).catch((e) => { throw e; });
  await db.webhookInbox.update({ where: { provider_externalEventId: { provider: "MOCK_VENUE", externalEventId: payload.eventId } }, data: { processedAt: await now(), result: "OK" } });
  return { duplicate: false, settled: r.settled };
}

export async function resolutionFor(marketId: string) {
  const m = await getMarket(marketId);
  const r = await db.resolutionRecord.findUnique({ where: { marketId } });
  const obs = await db.oracleObservation.findMany({ where: { marketId }, orderBy: { sourceTimestamp: "asc" } });
  return { market: m, resolution: r, observations: obs };
}

// ───────────── Expert hub ─────────────

export async function upsertExpertProfile(ctx: Ctx, p: { displayName: string; tags: string[]; credentials: string; disclosures: string; conflicts?: string }) {
  if (ctx.user.kind !== "CLIENT") throw err("FORBIDDEN", "Expert profiles are for individual accounts");
  return db.$transaction(async (tx) => {
    const cur = await tx.expertProfile.findUnique({ where: { userId: ctx.user.id } });
    if (cur) assertTransition("expertProfile", cur.moderationStatus, "PENDING", "CLIENT");
    const row = await tx.expertProfile.upsert({ where: { userId: ctx.user.id }, update: { ...p, tags: p.tags as any, moderationStatus: "PENDING" }, create: { userId: ctx.user.id, ...p, tags: p.tags as any } });
    await audit(tx, ctxActor(ctx), "ev.expert.profile", "ExpertProfile", row.id, { before: cur ? { moderationStatus: cur.moderationStatus } : undefined, after: { moderationStatus: "PENDING" } });
    return row;
  });
}

/** Публикация прогноза: только одобренный эксперт, до закрытия торгов; правка — новая версия (старая неизменна). */
export async function publishForecast(ctx: Ctx, f: { marketId: string; probabilityBp: number; method: string; note?: string }) {
  const prof = await db.expertProfile.findUnique({ where: { userId: ctx.user.id } });
  if (!prof || prof.moderationStatus !== "APPROVED") throw err("FORBIDDEN", "Your expert profile must be approved before you publish forecasts");
  const m = await db.venueMarket.findUnique({ where: { id: f.marketId } });
  if (!m) throw err("NOT_FOUND", "Contract not found");
  const at = await now();
  if (at >= m.tradingCloseUtc || !["OPEN", "SUSPENDED"].includes(m.status) || (await db.resolutionRecord.findUnique({ where: { marketId: m.id } }))) throw err("VALIDATION", "Forecasts are closed for this contract. Past forecasts cannot be changed.");
  return txRetry(async (tx) => {
    const last = await tx.expertForecast.findFirst({ where: { expertUserId: ctx.user.id, marketId: m.id }, orderBy: { version: "desc" } });
    const row = await tx.expertForecast.create({ data: { expertUserId: ctx.user.id, marketId: m.id, probabilityBp: f.probabilityBp, method: f.method, note: f.note, version: (last?.version ?? 0) + 1, supersedesId: last?.id ?? null } });
    await audit(tx, ctxActor(ctx), "ev.expert.forecast", "ExpertForecast", row.id, { after: { marketId: m.id, probabilityBp: f.probabilityBp, version: row.version } });
    return row;
  });
}

export async function expertDashboard(ctx: Ctx) {
  const profile = await db.expertProfile.findUnique({ where: { userId: ctx.user.id } });
  const forecasts = await db.expertForecast.findMany({ where: { expertUserId: ctx.user.id }, orderBy: [{ marketId: "asc" }, { version: "desc" }] });
  const markets = await db.venueMarket.findMany({ where: { id: { in: [...new Set(forecasts.map((f) => f.marketId))] } } });
  const res = await db.resolutionRecord.findMany({ where: { marketId: { in: markets.map((m) => m.id) }, status: "CONFIRMED" } });
  const scored = res.map((r) => { const latest = forecasts.find((f) => f.marketId === r.marketId)!; return { marketId: r.marketId, probabilityBp: latest.probabilityBp, outcome: r.outcome, brierBp: brierBp(latest.probabilityBp, r.outcome === "YES") }; });
  const avgBrierBp = scored.length ? Math.floor(scored.reduce((s, x) => s + x.brierBp, 0) / scored.length) : null;
  return { profile, forecasts: forecasts.map((f) => ({ ...f, market: marketDto(markets.find((m) => m.id === f.marketId)!) })), calibration: { resolved: scored.length, avgBrierBp, items: scored } };
}

export async function publicForecasts(marketId: string) {
  const rows = await db.expertForecast.findMany({ where: { marketId }, orderBy: [{ expertUserId: "asc" }, { version: "asc" }] });
  const profiles = await db.expertProfile.findMany({ where: { userId: { in: [...new Set(rows.map((r) => r.expertUserId))] }, moderationStatus: "APPROVED" } });
  return rows.filter((r) => profiles.some((p) => p.userId === r.expertUserId)).map((r) => { const p = profiles.find((x) => x.userId === r.expertUserId)!; return { id: r.id, expert: p.displayName, tags: p.tags, disclosures: p.disclosures, probabilityBp: r.probabilityBp, method: r.method, note: r.note, version: r.version, supersedesId: r.supersedesId, createdAt: r.createdAt }; });
}

// ───────────── Compliance (admin) ─────────────

export async function setCompliance(ctx: Ctx, marketId: string, toStatus: string, reason: string) {
  const a = asAdmin(ctx, { mutation: true });
  return db.$transaction(async (tx) => {
    const m = await tx.venueMarket.findUnique({ where: { id: marketId } });
    if (!m) throw err("NOT_FOUND", "Contract not found");
    assertTransition("evCompliance", m.complianceStatus, toStatus, "ADMIN");
    await tx.venueMarket.update({ where: { id: marketId }, data: { complianceStatus: toStatus, version: { increment: 1 } } });
    const rev = await tx.complianceReview.create({ data: { marketId, fromStatus: m.complianceStatus, toStatus, reason, reviewerId: a.user.id } });
    await audit(tx, ctxActor(a), "ev.market.compliance", "VenueMarket", marketId, { before: { complianceStatus: m.complianceStatus }, after: { complianceStatus: toStatus, reviewId: rev.id }, reason });
    return rev;
  });
}

export async function setMarketStatus(ctx: Ctx, marketId: string, toStatus: "OPEN" | "SUSPENDED" | "CLOSED", reason: string) {
  const a = asAdmin(ctx, { mutation: true });
  return db.$transaction(async (tx) => {
    const m = await tx.venueMarket.findUnique({ where: { id: marketId } });
    if (!m) throw err("NOT_FOUND", "Contract not found");
    assertTransition("evMarket", m.status, toStatus, "ADMIN");
    await tx.venueMarket.update({ where: { id: marketId }, data: { status: toStatus, version: { increment: 1 } } });
    await audit(tx, ctxActor(a), "ev.market.status", "VenueMarket", marketId, { before: { status: m.status }, after: { status: toStatus }, reason });
    return { status: toStatus };
  });
}

/** Изменение условий рынка (демо: порог): новая версия и termsHash → прежние котировки и сопоставления требуют пересмотра. */
export async function updateMarketTerms(ctx: Ctx, marketId: string, patch: { thresholdX100: number }, reason: string) {
  const a = asAdmin(ctx, { mutation: true });
  return db.$transaction(async (tx) => {
    const m = await tx.venueMarket.findUnique({ where: { id: marketId } });
    if (!m) throw err("NOT_FOUND", "Contract not found");
    if (m.status !== "OPEN" && m.status !== "SUSPENDED") throw err("INVALID_TRANSITION", "Terms of a closed contract cannot change");
    const terms = { ...(m.terms as any), thresholdX100: patch.thresholdX100 };
    const termsHash = termsHashOf({ ...terms, templateCode: m.templateCode, version: m.termsVersion + 1 });
    await tx.venueMarket.update({ where: { id: marketId }, data: { terms, termsHash, termsVersion: { increment: 1 }, version: { increment: 1 } } });
    await audit(tx, ctxActor(a), "ev.market.terms", "VenueMarket", marketId, { before: { terms: m.terms, termsHash: m.termsHash }, after: { terms, termsHash }, reason });
    return { termsHash, termsVersion: m.termsVersion + 1 };
  });
}

export async function moderateExpert(ctx: Ctx, userId: string, to: "APPROVED" | "REJECTED", reason: string) {
  const a = asAdmin(ctx, { mutation: true });
  return db.$transaction(async (tx) => {
    const p = await tx.expertProfile.findUnique({ where: { userId } });
    if (!p) throw err("NOT_FOUND", "Profile not found");
    assertTransition("expertProfile", p.moderationStatus, to, "ADMIN");
    await tx.expertProfile.update({ where: { userId }, data: { moderationStatus: to } });
    await audit(tx, ctxActor(a), "ev.expert.moderate", "ExpertProfile", p.id, { before: { moderationStatus: p.moderationStatus }, after: { moderationStatus: to }, reason });
  });
}

/** Статус поставщика ликвидности (только для симуляции) назначает только администратор (крит. 17). */
export async function setLiquidityProvider(ctx: Ctx, userId: string, status: "NONE" | "APPROVED", reason: string) {
  const a = asAdmin(ctx, { mutation: true });
  return db.$transaction(async (tx) => {
    const p = await tx.expertProfile.findUnique({ where: { userId } });
    if (!p) throw err("NOT_FOUND", "Profile not found");
    if (status === "APPROVED" && p.moderationStatus !== "APPROVED") throw err("VALIDATION", "Only approved experts can be liquidity providers in simulation");
    await tx.expertProfile.update({ where: { userId }, data: { liquidityProviderStatus: status } });
    await audit(tx, ctxActor(a), "ev.expert.liquidity_provider", "ExpertProfile", p.id, { before: { liquidityProviderStatus: p.liquidityProviderStatus }, after: { liquidityProviderStatus: status }, reason });
  });
}

export async function setConflictRestriction(ctx: Ctx, declarationId: string, restriction: "ALLOWED" | "MANUAL_REVIEW" | "BLOCKED", reason: string) {
  const a = asAdmin(ctx, { mutation: true });
  const at = await now();
  return db.$transaction(async (tx) => {
    const d = await tx.conflictDeclaration.findUnique({ where: { id: declarationId } });
    if (!d) throw err("NOT_FOUND", "Declaration not found");
    await tx.conflictDeclaration.update({ where: { id: declarationId }, data: { restriction, assessedBy: a.user.id, assessedAt: at } });
    await audit(tx, ctxActor(a), "ev.conflict.assess", "ConflictDeclaration", d.id, { before: { restriction: d.restriction }, after: { restriction }, reason });
  });
}

export async function setTier(ctx: Ctx, userId: string, tier: "T1" | "T2" | "T3" | null, reason: string) {
  const a = asAdmin(ctx, { mutation: true });
  await db.$transaction(async (tx) => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await tx.user.update({ where: { id: userId }, data: { riskTierOverride: tier } });
    await audit(tx, ctxActor(a), "ev.user.tier", "User", userId, { before: { riskTierOverride: u.riskTierOverride }, after: { riskTierOverride: tier }, reason });
  });
}

export async function setVenueOutage(ctx: Ctx, on: boolean) {
  const a = asAdmin(ctx, { mutation: true });
  await db.setting.upsert({ where: { key: OUTAGE_KEY }, update: { value: { on } }, create: { key: OUTAGE_KEY, value: { on } } });
  await audit(db, ctxActor(a), "ev.venue.outage", "Setting", OUTAGE_KEY, { after: { on } });
}

/** Кластерный риск: общий объект (дом, стройка) и связанное событие — отдельно от индивидуальных позиций (крит. 19). */
export async function clusterRisk(ctx: Ctx) {
  asAdmin(ctx, { allowSupport: true });
  const markets = await db.venueMarket.findMany();
  const lots = await db.position.findMany({ where: { state: "OPEN" } });
  const groups = new Map<string, { key: string; kind: "OBJECT" | "EVENT"; users: Set<string>; lots: number; yesPayoutCents: number; noPayoutCents: number; costCents: number; markets: Set<string> }>();
  for (const l of lots) {
    const m = markets.find((x) => x.id === l.marketId)!;
    const key = m.objectKey ? `object:${m.objectKey}` : `event:${m.eventRootKey}`;
    const g = groups.get(key) ?? { key, kind: m.objectKey ? "OBJECT" as const : "EVENT" as const, users: new Set(), lots: 0, yesPayoutCents: 0, noPayoutCents: 0, costCents: 0, markets: new Set() };
    g.users.add(l.userId); g.lots++; g.costCents += l.costCents + l.feeCents; g.markets.add(m.title);
    if (l.side === "YES") g.yesPayoutCents += l.units * 100; else g.noPayoutCents += l.units * 100;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ key: g.key, kind: g.kind, holders: g.users.size, lots: g.lots, yesPayoutCents: g.yesPayoutCents, noPayoutCents: g.noPayoutCents, costCents: g.costCents, markets: [...g.markets] })).sort((a, b) => b.yesPayoutCents + b.noPayoutCents - (a.yesPayoutCents + a.noPayoutCents));
}

// ───────────── Fixtures → DB ─────────────

export async function syncMockMarkets(tx: Tx | typeof db = db) {
  for (const f of FIXTURE_MARKETS) {
    const tpl = TEMPLATES[f.templateCode];
    const terms = { placeKey: f.placeKey, stationId: f.stationId, fallbackStationId: f.fallbackStationId, operator: f.operator, thresholdX100: f.thresholdX100, unit: f.unit, windowStartLocal: f.windowStartLocal, windowEndLocal: f.windowEndLocal, timezone: f.timezone, metric: tpl.metric, aggregation: tpl.aggregation, source: tpl.source, fallbackSource: tpl.fallbackSource };
    const termsHash = termsHashOf({ ...terms, templateCode: f.templateCode, version: 1 });
    const tradingCloseUtc = DateTime.fromISO(f.windowStartLocal, { zone: f.timezone }).startOf("day").toUTC().toJSDate();
    await tx.venueMarket.upsert({
      where: { venue_venueMarketId: { venue: "MOCK_VENUE", venueMarketId: f.venueMarketId } }, update: {},
      create: { venue: "MOCK_VENUE", venueMarketId: f.venueMarketId, sourceKind: "SIMULATED", title: f.title, templateCode: f.templateCode, terms, termsHash, status: f.status, complianceStatus: f.complianceStatus, regulatoryNote: f.regulatoryNote, eventRootKey: f.eventRootKey, objectKey: f.objectKey ?? null, manipulationRisk: tpl.manipulationRisk, tradingCloseUtc },
    });
  }
  for (const t of Object.values(TEMPLATES)) {
    await tx.eventTemplate.upsert({ where: { code: t.code }, update: {}, create: { code: t.code, version: t.version, category: t.category, title: t.title, outcomeYes: t.outcomeYes, outcomeNo: t.outcomeNo, metric: t.metric, operator: t.operator, unit: t.unit, aggregation: t.aggregation, missingDataPolicy: t.missingDataPolicy, disputeWindowHours: t.disputeWindowHours, approvalStatus: t.approvalStatus, liveEligible: false, manipulationRisk: t.manipulationRisk } });
  }
}

export const SUPPORTED_PLACES = PLACES.map((p) => ({ key: p.key, name: p.name }));
