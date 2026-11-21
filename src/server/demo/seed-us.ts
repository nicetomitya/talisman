import { db } from "../db";
import { buildCtx, type Ctx } from "../access";
import { randomToken, sha256 } from "../auth/crypto";
import { advance, resetClock } from "../clock";
import { priceUnits, type Level } from "../ev/pricing";
import { fixtureById } from "../ev/fixtures";
import * as EV from "../ev/service";

/**
 * Демо-данные US Event Risk (ТЗ v2). Все люди и суммы вымышлены; домены .test; все позиции — SIMULATED.
 */
async function ctxFor(email: string): Promise<Ctx> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: { include: { organization: true } } } });
  const s = await db.session.create({ data: { tokenHash: sha256(randomToken()), userId: u.id, activeOrgId: u.memberships[0]?.organizationId ?? null, mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), isDemoSwitch: true } });
  return buildCtx({ ...s, user: u }, "seed-us");
}
const mid = async (venueMarketId: string) => (await db.venueMarket.findUniqueOrThrow({ where: { venue_venueMarketId: { venue: "MOCK_VENUE", venueMarketId } } })).id;

async function buy(ctx: Ctx, venueMarketId: string, side: "YES" | "NO", payoutUsd: number, riskIntentId?: string) {
  const id = await mid(venueMarketId);
  const q = await EV.quote(id, side, payoutUsd * 100);
  return EV.placeSimOrder(ctx, { marketId: id, side, targetPayoutCents: payoutUsd * 100, quoteSnapshotId: q.quoteSnapshotId, termsHash: q.termsHash, riskIntentId: riskIntentId ?? null, allowPartial: true, confirm: true, idempotencyKey: `seed-${ctx.user.id}-${venueMarketId}-${side}-${payoutUsd}` });
}
/** Историческая бумажная позиция по уже прошедшему демо-событию (торги закрыты, поэтому через прямую запись). */
async function historicLot(userId: string, venueMarketId: string, side: "YES" | "NO", units: number) {
  const id = await mid(venueMarketId);
  const f = fixtureById(venueMarketId)!;
  const c = priceUnits(side, (side === "YES" ? f.yesAsks : f.noAsks) as Level[], units);
  const m = await db.venueMarket.findUniqueOrThrow({ where: { id } });
  const snap = await db.quoteSnapshot.create({ data: { marketId: id, source: "Mock venue (fixed demo order book)", yesAsks: f.yesAsks as any, noAsks: f.noAsks as any, termsHash: m.termsHash, takenAt: new Date(m.tradingCloseUtc.getTime() - 86400_000), staleAt: new Date(m.tradingCloseUtc.getTime() - 86400_000 + 60_000) } });
  const o = await db.simOrder.create({ data: { userId, marketId: id, side, requestedUnits: units, filledUnits: c.filledUnits, costCents: c.costCents, feeCents: c.venueFeeCents, quoteSnapshotId: snap.id, termsHash: m.termsHash, status: "FILLED", fills: { create: c.fills }, createdAt: snap.takenAt } });
  await db.position.create({ data: { orderId: o.id, userId, marketId: id, side, units: c.filledUnits, costCents: c.costCents, feeCents: c.venueFeeCents, createdAt: snap.takenAt } });
}

export async function seedUs(pw: string, log: (s: string) => void = () => {}) {
  await EV.syncMockMarkets();
  const verified = new Date();
  const mk = (email: string, name: string, usState: string) => db.user.create({ data: { email, name, kind: "CLIENT", passwordHash: pw, emailVerifiedAt: verified, market: "US", usState, acquisitionSource: "ORGANIC" } });
  const maya = await mk("maya@consumer.test", "Maya Chen", "RI");
  const sam = await mk("sam@expert.test", "Sam Rivera", "MA");
  const jordan = await mk("jordan@builder.test", "Jordan Blake", "TX");
  const buyers = [await mk("buyer1@homebuyer.test", "Alex Park", "TX"), await mk("buyer2@homebuyer.test", "Riley Diaz", "TX"), await mk("buyer3@homebuyer.test", "Casey Nguyen", "TX")];
  await mk("olivia@consumer.test", "Olivia Brooks", "IL");

  const cMaya = await ctxFor(maya.email);
  const owner = { userId: maya.id };
  // Регата: черновик → уточнение → подтверждение → позиция.
  const reg = await EV.createIntent(owner, "I'm sailing in Newport next August. If the wind is too weak during the regatta, I want to offset $1,500 of my trip expenses.", cMaya);
  const reg2 = await EV.clarifyIntent(owner, reg.id, reg.version, { stationId: "KUUU", windowStartLocal: "2027-08-10", windowEndLocal: "2027-08-12", thresholdX100: 800 }, cMaya);
  const reg3 = await EV.confirmIntent(owner, reg2.id, reg2.version, cMaya);
  await EV.marketMatches(owner, reg3.id);
  await buy(cMaya, "SIM-WIND-NPT-20270810-8KN", "YES", 1500, reg3.id);
  // Свадьба в Остине: ещё уточняется (станция не выбрана).
  await EV.createIntent(owner, "Outdoor wedding in Austin on May 8, 2027. If it rains more than 0.5 inches I'd like $3,000 back. Budget up to $1,000.", cMaya);
  // Перелёт: рынка нет — честное NONE и подписка на спрос.
  const fl = await EV.createIntent(owner, "My flight from Chicago could be delayed next March, I want $400 if it is.", cMaya);
  await EV.addDemand(owner, fl.id, "WAITLIST", "Would use a flight delay contract");

  // Прошедшие события: одно рассчитано, по второму открыто окно спора.
  await historicLot(maya.id, "SIM-WIND-NPT-20261024-8KN", "YES", 1000);
  await historicLot(maya.id, "SIM-RAIN-AUS-20261114-050IN", "YES", 500);
  await historicLot(buyers[0].id, "SIM-WIND-NPT-20261024-8KN", "NO", 400);
  await EV.observeAndPropose(null, await mid("SIM-WIND-NPT-20261024-8KN"));
  await EV.observeAndPropose(null, await mid("SIM-RAIN-AUS-20261114-050IN"));

  // Эксперт: одобренный профиль, версии прогнозов; статус поставщика ликвидности не назначен.
  const cSam = await ctxFor(sam.email);
  await EV.upsertExpertProfile(cSam, { displayName: "Sam Rivera, coastal meteorology", tags: ["wind", "coastal", "New England"], credentials: "M.S. in atmospheric science (self-reported, demo). Not a licensed financial adviser.", disclosures: "No positions in contracts I forecast. Research only, not investment advice." });
  const admin = await ctxFor("admin1@talisman.test");
  await EV.moderateExpert(admin, sam.id, "APPROVED", "Demo: credentials document reviewed");
  await EV.publishForecast(cSam, { marketId: await mid("SIM-WIND-NPT-20270810-8KN"), probabilityBp: 2500, method: "Climatology 1995–2025 for mid-August at KUUU, adjusted for sea breeze days", note: "Light-wind spells are common in August, but three-day averages below 8 kn are less frequent." });
  await EV.publishForecast(cSam, { marketId: await mid("SIM-WIND-NPT-20270810-8KN"), probabilityBp: 2200, method: "Same climatology plus updated seasonal outlook", note: "Revised down slightly. The first version stays visible." });
  await EV.publishForecast(cSam, { marketId: await mid("SIM-TEMP-CHI-20270701-95F"), probabilityBp: 1800, method: "Count of years with a 95°F+ day in the first week of July at KMDW" });
  await db.expertForecast.create({ data: { expertUserId: sam.id, marketId: await mid("SIM-WIND-NPT-20261024-8KN"), probabilityBp: 6000, method: "Short-range model blend (demo)", version: 1, createdAt: new Date("2026-10-20T12:00:00Z") } });

  // Стройка: сотрудник девелопера заявил связь → запрет; три покупателя одного дома → кластерный риск.
  const cJordan = await ctxFor(jordan.email);
  await EV.declareConflict(cJordan, "austin-oak-ridge-lot-14", "EMPLOYEE", "Site coordinator at the builder");
  for (const b of buyers) {
    const c = await ctxFor(b.email);
    await EV.declareConflict(c, "austin-oak-ridge-lot-14", "NONE");
    await buy(c, "SIM-CONSTR-AUS-OAKRIDGE-L14", "YES", 300);
  }
  await buy(cMaya, "SIM-TEMP-CHI-20270701-95F", "NO", 500);

  // Рассчитать первое прошедшее событие: окно спора истекло (демо-часы), подтверждение администратора.
  await advance(3 * 86400_000);
  await EV.finalizeResolution(admin, await mid("SIM-WIND-NPT-20261024-8KN"), "Demo: dispute window ended without disputes");
  await resetClock();
  log("US event risk demo: markets, users, positions, forecasts, resolutions");
}
