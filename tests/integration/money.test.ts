import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/server/db";
import { now, advance } from "@/server/clock";
import { selectQuote, createPremiumPayment } from "@/server/domain/checkout";
import { offersForClient, submitQuote } from "@/server/domain/auction";
import { processWebhook, reconcile } from "@/server/domain/payments";
import { emulatorPayerAction, replayWebhook, signWebhook } from "@/server/adapters/payment";
import { terminatePolicy } from "@/server/domain/policies";
import { saveDraft } from "@/server/domain/requests";
import { drainJobs } from "@/server/worker";
import { ctxFor, fill, kaskoData, propData, quote, base, toPayment, payAndConclude, qctx, productId } from "../helpers";

let anna: any, agentN: any, agentM: any;
beforeAll(async () => { [anna, agentN, agentM] = await Promise.all([ctxFor("anna@client.test"), ctxFor("agent@nadezhny.test"), ctxFor("agent1@most.test")]); });

async function kaskoWithTwoQuotes() {
  const r = await fill(anna, "KASKO", await kaskoData());
  const b = await base(agentN, r.id, "KASKO_SEV");
  await quote(agentN, r.id, "KASKO_SEV", Math.round(b.base));
  const b2 = await base(agentM, r.id, "KASKO_VOL");
  await quote(agentM, r.id, "KASKO_VOL", Math.round(b2.base));
  return r;
}

describe("Конкурентность и идемпотентность", () => {
  it("два одновременных выбора по одной заявке: успешен ровно один (AC08)", async () => {
    const r = await kaskoWithTwoQuotes();
    const offers = (await offersForClient(anna, r.id)).groups.flatMap((g) => g.offers);
    const res = await Promise.allSettled(offers.slice(0, 2).map((o) => selectQuote(anna, { requestId: r.id, requestVersion: 1, quoteId: o.id, quoteVersion: o.seq })));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db.checkout.count({ where: { requestId: r.id, status: { not: "CANCELLED" } } })).toBe(1);
  });
  it("одновременные предложения одного агентства: одна активная версия", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    const b = await base(agentN, r.id, "KASKO_SEV");
    const pid = await productId("KASKO_SEV");
    await Promise.allSettled([0, 1, 2].map((i) => submitQuote(qctx(agentN), { requestId: r.id, requestVersion: 1, productId: pid, premiumKop: (Math.round(b.base) - i * 200) * 100, publish: true })));
    expect(await db.quote.count({ where: { requestId: r.id, agencyOrgId: agentN.org.orgId, status: "PUBLISHED" } })).toBe(1);
  });
  it("двойное нажатие «Оплатить» не создаёт второго платежа (AC13)", async () => {
    const r = await kaskoWithTwoQuotes();
    const ch = await toPayment(anna, r.id);
    const [a, b] = await Promise.all([createPremiumPayment(anna, ch, "key-a"), createPremiumPayment(anna, ch, "key-b")]);
    expect(a.paymentId).toBe(b.paymentId);
    expect(await db.payment.count({ where: { checkoutId: ch } })).toBe(1);
  });
  it("повтор вебхука не меняет состояние дважды; поддельная подпись отвергается (AC13)", async () => {
    const r = await kaskoWithTwoQuotes();
    const ch = await toPayment(anna, r.id);
    const { externalId, policy } = await payAndConclude(anna, ch);
    expect(policy?.contractStatus).toBe("CONCLUDED");
    await replayWebhook(externalId); await replayWebhook(externalId); await drainJobs();
    const p = await db.payment.findFirstOrThrow({ where: { externalId } });
    expect(await db.paymentStatusHistory.count({ where: { paymentId: p.id, to: "SUCCEEDED" } })).toBe(1);
    expect(await db.policy.count({ where: { checkoutId: ch } })).toBe(1);
    expect(await db.commission.count({ where: { policyId: policy!.id, kind: "DISTRIBUTION" } })).toBeGreaterThan(0);
    const commBefore = await db.commission.count({ where: { policyId: policy!.id } });
    const body = JSON.stringify({ eventId: "forged-1", type: "payment.succeeded", externalId, amountKop: 1 });
    await expect(processWebhook("DEMO_CARRIER_PAY", body, "deadbeef")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.commission.count({ where: { policyId: policy!.id } })).toBe(commBefore);
  });
  it("вебхук с суммой, отличной от заказанной, не подтверждает оплату", async () => {
    const r = await kaskoWithTwoQuotes();
    const ch = await toPayment(anna, r.id);
    const pay = await createPremiumPayment(anna, ch, "k-mismatch");
    const externalId = pay.confirmationUrl.split("/").pop()!;
    const body = JSON.stringify({ eventId: "mm-" + externalId, type: "payment.succeeded", externalId, amountKop: 100, currency: "RUB" });
    await processWebhook("DEMO_CARRIER_PAY", body, signWebhook(body));
    expect((await db.payment.findFirstOrThrow({ where: { externalId } })).status).not.toBe("SUCCEEDED");
    expect(await db.exceptionItem.count({ where: { entityType: "Payment", status: { not: "RESOLVED" } } })).toBeGreaterThan(0);
  });
  it("потерянный вебхук восстанавливается сверкой (AC12)", async () => {
    const r = await kaskoWithTwoQuotes();
    const ch = await toPayment(anna, r.id);
    const pay = await createPremiumPayment(anna, ch, "k-lost");
    const externalId = pay.confirmationUrl.split("/").pop()!;
    await emulatorPayerAction(externalId, "lost_webhook");
    await drainJobs();
    expect((await db.payment.findFirstOrThrow({ where: { externalId } })).status).toBe("PENDING");
    const rep = await reconcile();
    expect(rep.resolved).toBeGreaterThanOrEqual(1);
    await drainJobs();
    expect((await db.payment.findFirstOrThrow({ where: { externalId } })).status).toBe("SUCCEEDED");
    expect((await db.policy.findUniqueOrThrow({ where: { checkoutId: ch } })).contractStatus).toBe("CONCLUDED");
  });
});

describe("Изменение заявки и прекращение договора", () => {
  it("изменение существенного поля инвалидирует предложения (AC09)", async () => {
    const r = await kaskoWithTwoQuotes();
    const res = await saveDraft(anna, r.id, { data: { car_value_rub: 2500000 }, version: r.version + 0 }).catch(async () => { const cur = await db.insuranceRequest.findUniqueOrThrow({ where: { id: r.id } }); return saveDraft(anna, r.id, { data: { car_value_rub: 2500000 }, version: cur.version }); });
    expect(res.requiresRepublish).toBe(true);
    expect(res.invalidatedQuotes).toBe(2);
    expect(await db.quote.count({ where: { requestId: r.id, status: "PUBLISHED" } })).toBe(0);
  });
  it("прекращение: возврат не больше оплаченного, сторно комиссий отдельными записями (AC26)", async () => {
    const r = await fill(anna, "PROPERTY", await propData());
    await drainJobs();
    const b = await base(agentN, r.id, "PROPERTY_SEV");
    await quote(agentN, r.id, "PROPERTY_SEV", Math.round(b.base)).catch(() => null);
    const ch = await toPayment(anna, r.id);
    const { policy } = await payAndConclude(anna, ch);
    const paid = await db.payment.findFirstOrThrow({ where: { checkoutId: ch, status: "SUCCEEDED" } });
    const subsBefore = await db.subscription.findMany();
    await advance(20 * 86400_000);
    try {
      await terminatePolicy(anna, policy!.id, { reason: "Продажа квартиры", confirm: true });
      await drainJobs();
      const refunds = await db.refund.findMany({ where: { policyId: policy!.id } });
      expect(refunds.reduce((a, x) => a + x.amountKop, 0)).toBeLessThanOrEqual(paid.amountKop);
      expect(refunds.length).toBe(1);
      const rev = await db.commission.findMany({ where: { policyId: policy!.id, kind: "REVERSAL" } });
      expect(rev.length).toBeGreaterThan(0);
      expect(rev.every((x) => x.amountKop < 0)).toBe(true);
      expect((await db.policy.findUniqueOrThrow({ where: { id: policy!.id } })).contractStatus).toBe("TERMINATED");
    } finally {
      await advance(-20 * 86400_000);
      // Сдвиг часов мог перевести подписки в GRACE/RESTRICTED — возвращаем исходное состояние для изоляции тестов.
      for (const s of subsBefore) await db.subscription.update({ where: { id: s.id }, data: { status: s.status, periodEnd: s.periodEnd, graceUntil: (s as any).graceUntil } });
    }
  });
  it("ограничение БД: выплаты по покрытию не превышают лимит", async () => {
    const c = await db.coverage.findFirstOrThrow();
    await expect(db.coverage.update({ where: { id: c.id }, data: { paidKop: c.limitKop + 1 } })).rejects.toThrow();
  });
});
