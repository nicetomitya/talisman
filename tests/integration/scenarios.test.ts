import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { now, advance } from "@/server/clock";
import { setEmu, EMU_DEFAULTS } from "@/server/adapters/emu";
import { runEventCheck } from "@/server/domain/events";
import { selectQuote } from "@/server/domain/checkout";
import { offersForClient, withdrawQuote } from "@/server/domain/auction";
import { reconcile } from "@/server/domain/payments";
import { drainJobs } from "@/server/worker";
import { hashPassword } from "@/server/auth/crypto";
import { ctxFor, fill, kaskoData, propData, quote, base, toPayment, payAndConclude } from "../helpers";

let anna: any, agentN: any, agentM: any;
let n = 0;
async function newClient() {
  const email = `t${Date.now()}${n++}@client.test`;
  await db.user.create({ data: { email, name: "Тестовый клиент", kind: "CLIENT", passwordHash: await hashPassword("Test-Password-1"), emailVerifiedAt: new Date(), isDemo: true } });
  return ctxFor(email);
}
async function eventPolicy(code: "RAIN01" | "WIND01") {
  const c = await newClient();
  // Каждый случай — своя дата: наблюдения станции общие для всех полисов одного окна.
  const d = new Date((await now()).getTime() + (30 + n++) * 86400_000).toISOString().slice(0, 10);
  const rain = code === "RAIN01";
  const r = await fill(c, code, { booking_ref: `T-${code}-${Date.now()}-${n++}`, booking_vendor: rain ? "Летний сад" : "Школа «Бриз»", purchase_date: (await now()).toISOString().slice(0, 10), booking_cost_rub: 45000, latitude: rain ? 59.9386 : 59.9862, longitude: rain ? 30.3141 : 30.2135, event_date: d, start_time: rain ? "14:00" : "11:00", end_time: rain ? "20:00" : "15:00", timezone: "Europe/Moscow" });
  const ch = await toPayment(c, r.id);
  const { policy } = await payAndConclude(c, ch);
  return { c, policy: policy! };
}
beforeAll(async () => { [anna, agentN, agentM] = await Promise.all([ctxFor("anna@client.test"), ctxFor("agent@nadezhny.test"), ctxFor("agent1@most.test")]); });
afterAll(async () => { await setEmu(EMU_DEFAULTS as any); });

describe("Reverse auction: окно, продление, резерв", () => {
  it("улучшение в последние 15 минут продлевает окно на 15 минут, суммарно не более часа (AC07)", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    const a = await db.auction.findFirstOrThrow({ where: { requestId: r.id } });
    await db.auction.update({ where: { id: a.id }, data: { closesAt: new Date((await now()).getTime() + 10_000) } });
    const b = await base(agentN, r.id, "KASKO_SEV");
    let price = Math.round(b.base);
    await quote(agentN, r.id, "KASKO_SEV", price);
    for (let i = 0; i < 6; i++) {
      const cur = await db.auction.findUniqueOrThrow({ where: { id: a.id } });
      await db.auction.update({ where: { id: a.id }, data: { closesAt: new Date((await now()).getTime() + 10_000), extensionTotalSec: cur.extensionTotalSec } });
      price -= 100; await quote(agentN, r.id, "KASKO_SEV", price).catch(() => null);
    }
    const fin = await db.auction.findUniqueOrThrow({ where: { id: a.id } });
    expect(fin.extensionTotalSec).toBe(3600);
    expect(fin.status).toBe("EXTENDED");
  });
  it("слишком малое улучшение отвергается (минимальный шаг)", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    const b = await base(agentN, r.id, "KASKO_SEV");
    await quote(agentN, r.id, "KASKO_SEV", Math.round(b.base));
    await expect(quote(agentN, r.id, "KASKO_SEV", Math.round(b.base) - 10)).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("окно закрывается по серверному времени, затем ожидает выбора клиента", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    await quote(agentN, r.id, "KASKO_SEV", Math.round((await base(agentN, r.id, "KASKO_SEV")).base));
    const H = 24 * 3600_000 + 60_000;
    await advance(20 * 3600_000); // через 20 часов окно ещё открыто
    try { await drainJobs(); expect((await db.auction.findFirstOrThrow({ where: { requestId: r.id } })).status).toBe("OPEN"); }
    finally { await advance(-20 * 3600_000); }
    await advance(H);
    try { await drainJobs(); expect((await db.auction.findFirstOrThrow({ where: { requestId: r.id } })).status).toBe("CLOSED"); expect((await db.insuranceRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("SELECTION"); }
    finally { await advance(-H); }
  });
  it("после матча 2 часа на оформление: напоминания за час и за 15 минут, затем матч завершается (AC10)", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    await quote(agentN, r.id, "KASKO_SEV", Math.round((await base(agentN, r.id, "KASKO_SEV")).base));
    const o = (await offersForClient(anna, r.id)).groups[0].offers[0];
    const sel = await selectQuote(anna, { requestId: r.id, requestVersion: 1, quoteId: o.id, quoteVersion: o.seq });
    await advance(61 * 60_000);
    try {
      await drainJobs();
      expect((await db.checkout.findUniqueOrThrow({ where: { id: sel.checkout_id } })).status).not.toBe("CANCELLED");
      expect(await db.notification.count({ where: { userId: anna.user.id, type: "match.reminder", link: { contains: sel.checkout_id } } })).toBe(1);
    } finally { await advance(-61 * 60_000); }
    await advance(121 * 60_000);
    try {
      await drainJobs();
      expect((await db.checkout.findUniqueOrThrow({ where: { id: sel.checkout_id } })).status).toBe("CANCELLED");
      // Матч завершён: к прежним предложениям вернуться нельзя, заявка закрыта.
      expect((await db.insuranceRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CANCELLED");
      expect(await db.quote.count({ where: { requestId: r.id, status: { in: ["PUBLISHED", "SELECTED"] } } })).toBe(0);
    }
    finally { await advance(-121 * 60_000); }
  });
});

describe("Фиксированные условия после подачи", () => {
  it("после подачи цену можно только снижать, условия менять нельзя", async () => {
    const r = await fill(anna, "KASKO", await kaskoData({ allow_alt_deductible: true }));
    const b = Math.round((await base(agentN, r.id, "KASKO_SEV")).base);
    await quote(agentN, r.id, "KASKO_SEV", b - 1000);
    await expect(quote(agentN, r.id, "KASKO_SEV", b)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(quote(agentN, r.id, "KASKO_SEV", b - 1000)).rejects.toMatchObject({ code: "ALREADY_DONE" });
    await expect(quote(agentN, r.id, "KASKO_SEV", b - 2000, { deductibleRub: 30000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const q = await quote(agentN, r.id, "KASKO_SEV", b - 2000);
    expect(q.quote.totalKop).toBe((b - 2000) * 100);
  });
  it("отозванное предложение нельзя подать заново", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    const b = Math.round((await base(agentN, r.id, "KASKO_SEV")).base);
    const q = (await quote(agentN, r.id, "KASKO_SEV", b)).quote;
    await withdrawQuote({ ...agentN, orgId: agentN.org.orgId }, q.id, "Ошибка в расчёте");
    await expect(quote(agentN, r.id, "KASKO_SEV", b - 1000)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Сценарий Б: автоматизация агентств", () => {
  it("«Мост» отвечает на квартиру автоматически в пределах тарифа; решение журналируется (AC21)", async () => {
    const r = await fill(anna, "PROPERTY", await propData());
    await drainJobs();
    const most = (await db.quote.findMany({ where: { requestId: r.id, agencyOrgId: agentM.org.orgId } }))[0];
    expect(most?.createdVia).toBe("AUTO");
    expect(most?.status).toBe("PUBLISHED");
    const run = await db.automationRun.findFirstOrThrow({ where: { requestId: r.id, organizationId: agentM.org.orgId } });
    expect(run.result).toBe("SENT");
    expect((run.steps as any[]).length).toBeGreaterThan(2);
  });
  it("«Надёжный курс» в режиме подтверждения готовит черновик по каско, без публикации", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    await drainJobs();
    const q = await db.quote.findFirst({ where: { requestId: r.id, agencyOrgId: agentN.org.orgId } });
    expect(q?.status).toBe("DRAFT");
    expect(q?.createdVia).toBe("CONFIRM");
  });
  it("автоответ не срабатывает для случаев, требующих человека (сдача в аренду)", async () => {
    const r = await fill(anna, "PROPERTY", await propData({ usage: "RENT_OUT" }));
    await drainJobs();
    expect(await db.quote.count({ where: { requestId: r.id, agencyOrgId: agentM.org.orgId, status: "PUBLISHED" } })).toBe(0);
  });
});

describe("Сценарии В и Г: параметрические продукты", () => {
  const cases: [string, "RAIN01" | "WIND01", string, string][] = [
    ["5.2 мм → выплата", "RAIN01", "r52", "PAID"], ["ровно 5.0 мм → выплата", "RAIN01", "r50", "PAID"], ["4.9 мм → без выплаты", "RAIN01", "r49", "NOT_MET"],
    ["пропуск основного, резерв есть → выплата", "RAIN01", "r_gap_backup", "PAID"], ["пропуск обоих → проверка специалистом", "RAIN01", "r_gap_both", "REVIEW"],
    ["ветер выполнен → выплата", "WIND01", "w_met", "PAID"], ["ровно 3.0 м/с → без выплаты", "WIND01", "w_exact3", "NOT_MET"], ["конфликт источников → специалист", "WIND01", "w_conflict", "REVIEW"],
  ];
  for (const [title, code, fx, expected] of cases) {
    it(`${code}: ${title} (AC16–AC19)`, async () => {
      await setEmu({ weather: { [code]: fx } } as any);
      const { policy } = await eventPolicy(code);
      await runEventCheck(policy.id, { force: true });
      await drainJobs();
      const ec = await db.eventCheck.findUniqueOrThrow({ where: { policyId: policy.id } });
      const claims = await db.claim.findMany({ where: { policyId: policy.id } });
      const payouts = await db.payoutItem.findMany({ where: { policyId: policy.id } });
      if (expected === "PAID") { expect(claims[0]?.status).toBe("PAID"); expect(payouts.filter((p) => p.status === "PAID")).toHaveLength(1); }
      if (expected === "NOT_MET") { expect(ec.result).toBe("NOT_MET"); expect(payouts).toHaveLength(0); }
      if (expected === "REVIEW") { expect(["NEEDS_DATA", "SPECIALIST_REVIEW"]).toContain(ec.status); expect(payouts).toHaveLength(0); expect(await db.exceptionItem.count({ where: { entityId: ec.id } })).toBeGreaterThan(0); }
      // Повторный расчёт не создаёт второй выплаты по тому же основанию.
      await runEventCheck(policy.id, { force: true }).catch(() => null); await drainJobs();
      expect((await db.payoutItem.findMany({ where: { policyId: policy.id, status: "PAID" } })).length).toBeLessThanOrEqual(1);
    });
  }
  it("клиент видит данные и основание результата и может открыть спор (AC20)", async () => {
    await setEmu({ weather: { RAIN01: "r49" } } as any);
    const { c, policy } = await eventPolicy("RAIN01");
    await runEventCheck(policy.id, { force: true });
    await drainJobs();
    const ec = await db.eventCheck.findUniqueOrThrow({ where: { policyId: policy.id } });
    expect(ec.result).toBe("NOT_MET");
    const { openDispute } = await import("@/server/domain/claims");
    const claim = await openDispute(c, { policyId: policy.id, reason: "На площадке шёл сильный дождь весь день" });
    expect(["REVIEWING", "DISPUTED"]).toContain(claim.status);
    expect(await db.exceptionItem.count({ where: { entityType: "Claim", entityId: claim.id, type: "DISPUTE" } })).toBeGreaterThan(0);
    // Чужой клиент не может оспорить чужой полис.
    await expect(openDispute(anna, { policyId: policy.id, reason: "Попытка оспорить чужой полис" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("событийный продукт нельзя купить менее чем за 14 дней", async () => {
    const c = await newClient();
    const d = new Date((await now()).getTime() + 5 * 86400_000).toISOString().slice(0, 10);
    await expect(fill(c, "RAIN01", { booking_ref: "T-LATE-" + Date.now(), booking_vendor: "Сад", purchase_date: (await now()).toISOString().slice(0, 10), booking_cost_rub: 45000, latitude: 59.9386, longitude: 30.3141, event_date: d, start_time: "14:00", end_time: "20:00", timezone: "Europe/Moscow" })).rejects.toThrow(/publish failed.*14/);
  });
});

describe("Сценарий Д: сбои страховщика", () => {
  it("страховщик не подтверждает → защита не действует, задача поддержке; после восстановления договор заключён (AC14)", async () => {
    await setEmu({ carrier: { confirm: "error" } } as any);
    const r = await fill(anna, "KASKO", await kaskoData());
    await quote(agentN, r.id, "KASKO_SEV", Math.round((await base(agentN, r.id, "KASKO_SEV")).base));
    const ch = await toPayment(anna, r.id);
    const { policy } = await payAndConclude(anna, ch);
    expect(policy?.contractStatus).toBe("PREPARED");
    for (let i = 0; i < 4; i++) { await advance(10 * 60_000); await drainJobs(); }
    expect((await db.checkout.findUniqueOrThrow({ where: { id: ch } })).status).toBe("AWAITING_CARRIER");
    expect(await db.exceptionItem.count({ where: { entityId: ch, status: { not: "RESOLVED" } } })).toBeGreaterThan(0);
    await setEmu({ carrier: { confirm: "ok" } } as any);
    await reconcile(); await drainJobs();
    await advance(-40 * 60_000);
    expect((await db.policy.findUniqueOrThrow({ where: { checkoutId: ch } })).contractStatus).toBe("CONCLUDED");
    expect(await db.exceptionItem.count({ where: { entityId: ch, status: { not: "RESOLVED" } } })).toBe(0);
  });
});
