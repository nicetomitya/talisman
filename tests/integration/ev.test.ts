import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/server/db";
import { advance, resetClock } from "@/server/clock";
import * as EV from "@/server/ev/service";
import { partnerExecution, LIVE_ORDER_ROUTE_EXISTS } from "@/server/ev/venue";
import { ctxFor } from "../helpers";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const mid = async (v: string) => (await db.venueMarket.findUniqueOrThrow({ where: { venue_venueMarketId: { venue: "MOCK_VENUE", venueMarketId: v } } })).id;
let n = 0;
async function order(email: string, venueMarketId: string, side: "YES" | "NO", usd: number, o: { allowPartial?: boolean; key?: string } = {}) {
  const ctx = await ctxFor(email);
  const id = await mid(venueMarketId);
  const q = await EV.quote(id, side, usd * 100);
  return EV.placeSimOrder(ctx, { marketId: id, side, targetPayoutCents: usd * 100, quoteSnapshotId: q.quoteSnapshotId, termsHash: q.termsHash, allowPartial: o.allowPartial ?? false, confirm: true, idempotencyKey: o.key ?? `it-${Date.now()}-${++n}` });
}
afterEach(async () => { await resetClock(); await db.setting.deleteMany({ where: { key: "ev_mock_venue_outage" } }); });

describe("ТЗ v2 · Risk intake и права", () => {
  it("крит. 1–3: гость создаёт черновик без станции; после уточнения и подтверждения — EXACT на SIMULATED WIND_LOW", async () => {
    const guest = { guestKeyHash: "g".repeat(64) };
    const i = await EV.createIntent(guest, "Regatta in Newport Aug 10-12, 2027. If wind is below 8 knots I want $1,500.");
    expect(i.stationId).toBeNull();
    expect(i.status).toBe("NEEDS_CLARIFICATION");
    const i2 = await EV.clarifyIntent(guest, i.id, i.version, { stationId: "KUUU" });
    expect(i2.window.startUtc!.toISOString()).toBe("2027-08-10T04:00:00.000Z");
    const i3 = await EV.confirmIntent(guest, i2.id, i2.version);
    expect(i3.status).toBe("CONFIRMED");
    const m = await EV.marketMatches(guest, i3.id);
    expect(m.simulated.overall).toBe("EXACT");
    expect(m.simulated.results[0].market.sourceKind).toBe("SIMULATED");
    expect(m.live.overall).toBe("NONE");
    expect(await db.matchAssessment.count({ where: { riskIntentId: i.id, termsHash: { not: null } } })).toBeGreaterThan(0);
    // Чужой владелец не видит черновик (scoped-запрос).
    await expect(EV.getIntent({ guestKeyHash: "h".repeat(64) }, i.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const olivia = await ctxFor("olivia@consumer.test");
    await expect(EV.getIntent({ userId: olivia.user.id }, i.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // После входа черновик гостя переходит владельцу.
    expect(await EV.claimGuestIntents(olivia.user.id, guest.guestKeyHash)).toBe(1);
  });
  it("подтверждение без ответов на вопросы невозможно; изменение после подтверждения — новая проверка", async () => {
    const o = { userId: (await ctxFor("olivia@consumer.test")).user.id };
    const i = await EV.createIntent(o, "Austin wedding May 8, 2027, rain above 0.5 inches, $3,000");
    await expect(EV.confirmIntent(o, i.id, i.version)).rejects.toMatchObject({ code: "NEEDS_INFO" });
    const r = await EV.confirmIntent(o, i.id, (await EV.clarifyIntent(o, i.id, i.version, { stationId: "KAUS" })).version);
    const changed = await EV.clarifyIntent(o, i.id, r.version, { thresholdX100: 75 });
    expect(changed.status).toBe("READY_FOR_REVIEW");
    expect(changed.eventDefinitionId).toBeNull();
    expect((await EV.marketMatches(o, i.id)).simulated.overall).toBe("PARTIAL");
  });
  it("NONE для неподдерживаемого события: только сигнал спроса, без оплаты", async () => {
    const o = { userId: (await ctxFor("olivia@consumer.test")).user.id };
    const i = await EV.createIntent(o, "My flight from Chicago could be delayed next March, I want $400");
    expect((await EV.marketMatches(o, i.id)).simulated.overall).toBe("NONE");
    await EV.addDemand(o, i.id, "WAITLIST");
    expect(await db.simOrder.count({ where: { riskIntentId: i.id } })).toBe(0);
  });
});

describe("ТЗ v2 · Котировки и бумажные ордера", () => {
  it("крит. 7: котировка содержит площадку и возраст; устаревшая не подтверждается", async () => {
    const q = await EV.quote(await mid("SIM-WIND-NPT-20270810-8KN"), "YES", 1000_00);
    expect(q.venue).toBe("MOCK_VENUE"); expect(q.sourceKind).toBe("SIMULATED"); expect(q.ageSec).toBe(0); expect(q.canConfirm).toBe(true);
    const phx = await EV.quote(await mid("SIM-TEMP-PHX-20270615-115F"), "YES", 100_00);
    expect(phx.stale).toBe(true); expect(phx.canConfirm).toBe(false);
    const ctx = await ctxFor("olivia@consumer.test");
    await expect(EV.placeSimOrder(ctx, { marketId: phx.marketId, side: "YES", targetPayoutCents: 100_00, quoteSnapshotId: phx.quoteSnapshotId, termsHash: phx.termsHash, allowPartial: false, confirm: true, idempotencyKey: "stale-phx-1" })).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    await advance(61_000);
    await expect(EV.placeSimOrder(ctx, { marketId: q.marketId, side: "YES", targetPayoutCents: 1000_00, quoteSnapshotId: q.quoteSnapshotId, termsHash: q.termsHash, allowPartial: false, confirm: true, idempotencyKey: "stale-npt-1" })).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
  });
  it("крит. 6: частичное исполнение только с явным согласием", async () => {
    await expect(order("olivia@consumer.test", "SIM-RAIN-AUS-20270508-050IN", "YES", 5000)).rejects.toMatchObject({ code: "CAPACITY_EXHAUSTED" });
    const r = await order("olivia@consumer.test", "SIM-RAIN-AUS-20270508-050IN", "YES", 5000, { allowPartial: true });
    expect(r.result).toMatchObject({ status: "PARTIALLY_FILLED", filledUnits: 3000, requestedUnits: 5000, costCents: 2000 * 30 + 1000 * 33, simulation: true });
  });
  it("крит. 14: повтор с тем же ключом не создаёт второй ордер и позицию", async () => {
    const a = await order("olivia@consumer.test", "SIM-TEMP-CHI-20270701-95F", "NO", 100, { key: "dup-key-123" });
    const b = await order("olivia@consumer.test", "SIM-TEMP-CHI-20270701-95F", "NO", 100, { key: "dup-key-123" }).catch((e) => e);
    // Новый quoteSnapshotId → другое тело запроса: тот же ключ с другими данными отклоняется, дубля нет.
    expect(b.code).toBe("CONFLICT");
    expect(await db.position.count({ where: { orderId: a.result.orderId } })).toBe(1);
    const ctx = await ctxFor("olivia@consumer.test");
    const id = await mid("SIM-TEMP-CHI-20270701-95F");
    const q = await EV.quote(id, "NO", 100_00);
    const body = { marketId: id, side: "NO" as const, targetPayoutCents: 100_00, quoteSnapshotId: q.quoteSnapshotId, termsHash: q.termsHash, allowPartial: false, confirm: true as const, idempotencyKey: "dup-key-456" };
    const r1 = await EV.placeSimOrder(ctx, body); const r2 = await EV.placeSimOrder(ctx, body);
    expect(r2.replayed).toBe(true); expect(r2.result.orderId).toBe(r1.result.orderId);
  });
  it("крит. 18: лимит считается агрегированно по связанному событию (10 лотов на двух рынках одного события)", async () => {
    const ctx = await ctxFor("buyer2@homebuyer.test");
    for (let i = 0; i < 10; i++) await order(ctx.user.email, i % 2 ? "SIM-WIND-NPT-20270810-8KN" : "SIM-WIND-NPT-20270810-6KN", i % 3 ? "YES" : "NO", 500);
    const lots = await db.position.count({ where: { userId: ctx.user.id, marketId: { in: [await mid("SIM-WIND-NPT-20270810-8KN"), await mid("SIM-WIND-NPT-20270810-6KN")] } } });
    expect(lots).toBe(10); // T1: $5,000 на событие исчерпан ровно
    await expect(order(ctx.user.email, "SIM-WIND-NPT-20270810-8KN", "YES", 1)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", details: expect.objectContaining({ relatedLots: 10 }) });
    // Другое событие — свой лимит.
    await expect(order(ctx.user.email, "SIM-TEMP-CHI-20270701-95F", "YES", 100)).resolves.toBeTruthy();
  });
  it("крит. 25: изменение условий рынка требует новой котировки и пересмотра", async () => {
    const admin = await ctxFor("admin1@talisman.test");
    const id = await mid("SIM-WIND-NPT-20270810-6KN");
    const q = await EV.quote(id, "YES", 100_00);
    await EV.updateMarketTerms(admin, id, { thresholdX100: 650 }, "Venue rule update (demo)");
    const ctx = await ctxFor("olivia@consumer.test");
    await expect(EV.placeSimOrder(ctx, { marketId: id, side: "YES", targetPayoutCents: 100_00, quoteSnapshotId: q.quoteSnapshotId, termsHash: q.termsHash, allowPartial: false, confirm: true, idempotencyKey: "terms-chg-1" })).rejects.toMatchObject({ code: "VERSION_CHANGED" });
  });
  it("крит. 28: недоступность площадки — честная ошибка, без цен", async () => {
    const admin = await ctxFor("admin1@talisman.test");
    await EV.setVenueOutage(admin, true);
    await expect(EV.quote(await mid("SIM-WIND-NPT-20270810-8KN"), "YES", 100_00)).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });
  it("приостановленный рынок и research-only не принимают позиции", async () => {
    await expect(order("olivia@consumer.test", "SIM-RAIN-SAN-20270213-100IN", "YES", 10)).rejects.toMatchObject({ code: "SALES_SUSPENDED" });
  });
});

describe("ТЗ v2 · Реальные деньги отсутствуют", () => {
  it("крит. 9–13: нет маршрута реального ордера, адаптер партнёра не исполняет, допуск закрыт", async () => {
    expect(LIVE_ORDER_ROUTE_EXISTS).toBe(false);
    const routes: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : routes.push(path.join(d, f.name)); };
    walk("src/app/api/v2");
    expect(routes.filter((r) => /live|partner|real|orders\/route/.test(r.replace("sim/orders", "")))).toEqual([]);
    expect(existsSync("src/app/api/v2/orders")).toBe(false);
    await expect(partnerExecution.submitOrder()).rejects.toMatchObject({ code: "INTEGRATION_NOT_CONFIGURED" });
    const e = await EV.eligibility(await ctxFor("maya@consumer.test"));
    expect(e.live.allowed).toBe(false);
    expect(e.live.reasons).toContain("KYC_NOT_VERIFIED_BY_PARTNER");
  });
  it("крит. 12, 24: позиция существует только против площадки и только как SIMULATED", async () => {
    const p = await db.position.findFirstOrThrow();
    await expect(db.$executeRawUnsafe(`UPDATE "Position" SET "sourceKind"='LIVE' WHERE id='${p.id}'`)).rejects.toThrow(/check constraint/);
    await expect(db.$executeRawUnsafe(`UPDATE "SimOrder" SET "simulation"=false WHERE id='${p.orderId}'`)).rejects.toThrow(/check constraint/);
    expect(Object.keys(db.simOrder.fields)).not.toContain("counterpartyUserId");
  });
});

describe("ТЗ v2 · Оракул, разрешение, расчёт", () => {
  it("крит. 15: пропуск данных → NEEDS_DATA без выплаты; спор не ведёт к автоматической выплате", async () => {
    const admin = await ctxFor("admin1@talisman.test");
    const id = await mid("SIM-WIND-NPT-20270810-6KN");
    await expect(EV.observeAndPropose(admin, id)).rejects.toMatchObject({ code: "VALIDATION" }); // окно не закончилось
    await advance(300 * 86400_000);
    const r = await EV.observeAndPropose(admin, id);
    expect(r.status).toBe("NEEDS_DATA");
    await expect(EV.finalizeResolution(admin, id, "try")).rejects.toMatchObject({ code: "NEEDS_INFO" });
    expect(await db.settlementRecord.count({ where: { partnerRef: `SIMULATED:${r.id}` } })).toBe(0);
  });
  it("спор держателя позиции → решение администратора; расчёт идемпотентен; повтор события площадки не дублирует", async () => {
    const admin = await ctxFor("admin1@talisman.test");
    const maya = await ctxFor("maya@consumer.test");
    const id = await mid("SIM-RAIN-AUS-20261114-050IN"); // в сиде: PROPOSED, окно спора открыто
    await expect(EV.disputeResolution(await ctxFor("olivia@consumer.test"), id, "I do not hold this but want to dispute")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await EV.disputeResolution(maya, id, "Local gauges show more than an inch of rain");
    await expect(EV.finalizeResolution(admin, id, "no decision")).rejects.toMatchObject({ code: "VALIDATION" });
    const ev = { eventId: "venue-evt-0001", type: "RESOLUTION_CONFIRMED" as const, marketId: id, outcome: "NO" as const };
    const a = await EV.ingestVenueEvent(ev, admin);
    const b = await EV.ingestVenueEvent(ev, admin);
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(true);
    const lots = await db.position.findMany({ where: { marketId: id } });
    const st = await db.settlementRecord.findMany({ where: { positionId: { in: lots.map((l) => l.id) } } });
    expect(st).toHaveLength(lots.length);
    expect(st.every((s) => s.grossPayoutCents === 0 && s.sourceKind === "SIMULATED")).toBe(true);
    expect(await EV.settleMarket(id)).toBe(0);
    await expect(db.$executeRawUnsafe(`UPDATE "SettlementRecord" SET "netCents"=0 WHERE id='${st[0].id}'`)).rejects.toThrow(/immutable/);
  });
});

describe("ТЗ v2 · Эксперты, конфликты, комплаенс", () => {
  it("крит. 16: сотрудник застройщика не может открыть позицию; без декларации — запрос декларации", async () => {
    await expect(order("jordan@builder.test", "SIM-CONSTR-AUS-OAKRIDGE-L14", "YES", 10)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(order("olivia@consumer.test", "SIM-CONSTR-AUS-OAKRIDGE-L14", "YES", 10)).rejects.toMatchObject({ code: "NEEDS_INFO" });
    const j = await ctxFor("jordan@builder.test");
    expect((await EV.declareConflict(j, "austin-oak-ridge-lot-14", "NONE")).restriction).toBe("BLOCKED"); // снять ограничение сам нельзя
  });
  it("крит. 19: кластерный риск по общему объекту виден отдельно", async () => {
    const g = (await EV.clusterRisk(await ctxFor("admin1@talisman.test"))).find((x) => x.key === "object:austin-oak-ridge-lot-14")!;
    expect(g.kind).toBe("OBJECT"); expect(g.holders).toBe(3); expect(g.yesPayoutCents).toBe(900_00);
    await expect(EV.clusterRisk(await ctxFor("maya@consumer.test"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("крит. 17: эксперт публикует, но статус поставщика ликвидности — только администратор", async () => {
    const sam = await ctxFor("sam@expert.test");
    await expect(EV.setLiquidityProvider(sam, sam.user.id, "APPROVED", "self")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await EV.upsertExpertProfile(await ctxFor("olivia@consumer.test"), { displayName: "Olivia B", tags: ["heat"], credentials: "Ten years in event logistics", disclosures: "No positions" });
    expect(p.moderationStatus).toBe("PENDING");
    await expect(EV.publishForecast(await ctxFor("olivia@consumer.test"), { marketId: await mid("SIM-TEMP-CHI-20270701-95F"), probabilityBp: 3000, method: "gut feeling only" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("крит. 29: прогноз не правится задним числом; после закрытия торгов новых версий нет", async () => {
    const sam = await ctxFor("sam@expert.test");
    const f = await db.expertForecast.findFirstOrThrow({ where: { expertUserId: sam.user.id } });
    await expect(db.expertForecast.update({ where: { id: f.id }, data: { probabilityBp: 9900 } })).rejects.toThrow(/immutable/);
    await expect(EV.publishForecast(sam, { marketId: await mid("SIM-WIND-NPT-20261024-8KN"), probabilityBp: 9900, method: "hindsight is perfect" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await EV.expertDashboard(sam)).calibration.resolved).toBeGreaterThanOrEqual(1);
  });
  it("крит. 26: смена комплаенс-статуса требует администратора с 2FA и пишет кто/когда/основание", async () => {
    const id = await mid("SIM-TEMP-PHX-20270615-115F");
    await expect(EV.setCompliance(await ctxFor("maya@consumer.test"), id, "BLOCKED", "x".repeat(12))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(EV.setCompliance(await ctxFor("admin1@talisman.test", { mfa: false }), id, "BLOCKED", "x".repeat(12))).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const admin = await ctxFor("admin1@talisman.test");
    const r = await EV.setCompliance(admin, id, "RESEARCH_ONLY", "Stale data feed, research only until fixed");
    expect(r).toMatchObject({ fromStatus: "SIM_ALLOWED", toStatus: "RESEARCH_ONLY", reviewerId: admin.user.id });
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "ev.market.compliance", entityId: id }, orderBy: { at: "desc" } });
    expect(a).toMatchObject({ actorUserId: admin.user.id, reason: "Stale data feed, research only until fixed" });
  });
});
