import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { setEmu, EMU_DEFAULTS } from "@/server/adapters/emu";
import { createRequest, saveDraft, getOwnRequest } from "@/server/domain/requests";
import { offersForClient, submitQuote, withdrawQuote } from "@/server/domain/auction";
import { selectQuote, requestCode } from "@/server/domain/checkout";
import { uploadFile, scanDocument } from "@/server/domain/documents";
import { sendMessage } from "@/server/domain/messaging";
import { upsertReview, agencyRating } from "@/server/domain/reviews";
import { notify } from "@/server/domain/notify";
import { setConsent } from "@/server/domain/consents";
import { coverageState } from "@/server/domain/policies";
import { payInvoice, cancelAutoRenew, syncSubscription, assertCanRespond } from "@/server/domain/subscriptions";
import { emulatorPayerAction, replayWebhook } from "@/server/adapters/payment";
import { enqueue } from "@/server/jobs";
import { recoverStale, drainJobs } from "@/server/worker";
import { ctxFor, fill, kaskoData, propData, quote, base, qctx, productId, toPayment } from "../helpers";

const qctxFull = (c: any) => ({ ...c, orgId: c.org.orgId });
let anna: any, igor: any, agentN: any, agentM: any, parus: any;
beforeAll(async () => { [anna, igor, agentN, agentM, parus] = await Promise.all([ctxFor("anna@client.test"), ctxFor("igor@client.test"), ctxFor("agent@nadezhny.test"), ctxFor("agent1@most.test"), ctxFor("owner@parus.test", { orgName: "Парус и погода" })]); });

describe("Заявка и предложения", () => {
  it("AC01: черновик сохраняется и продолжается после выхода", async () => {
    const r = await createRequest(anna, { productCode: "KASKO" });
    await saveDraft(anna, r.id, { data: { car_make: "Kia", car_year: 2022 }, version: r.version });
    const again = await getOwnRequest(db, anna, r.id);
    expect((again.data as any).car_make).toBe("Kia");
    expect(again.status).toBe("DRAFT");
  });
  it("AC05: предложение с другой франшизой — в отдельной группе сопоставимости", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    await quote(agentN, r.id, "KASKO_SEV", Math.round((await base(agentN, r.id, "KASKO_SEV")).base));
    await quote(agentM, r.id, "KASKO_VOL", Math.round((await base(agentM, r.id, "KASKO_VOL", 30000)).base), { deductibleRub: 30000 });
    const o = await offersForClient(anna, r.id);
    expect(o.groups).toHaveLength(2);
    expect(o.groups[0].matchesRequest).toBe(true);
    expect(o.groups[1].differences[0]).toMatch(/Франшиза 30/);
  });
  it("AC06: скрытая комиссия (сборы вне тарифа) отклоняется", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    const b = await base(agentN, r.id, "KASKO_SEV");
    await expect(submitQuote(qctx(agentN), { requestId: r.id, requestVersion: 1, productId: await productId("KASKO_SEV"), premiumKop: Math.round(b.base) * 100, feesKop: 50000, publish: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("AC08: исчерпанная страховая ёмкость не позволяет зарезервировать", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    await quote(agentN, r.id, "KASKO_SEV", Math.round((await base(agentN, r.id, "KASKO_SEV")).base));
    const sev = await db.organization.findFirstOrThrow({ where: { name: { startsWith: "Северный щит" } } });
    const pool = await db.capacityPool.findFirstOrThrow({ where: { carrierOrgId: sev.id, productCode: "KASKO" } });
    await db.capacityPool.update({ where: { id: pool.id }, data: { limitCount: pool.usedCount + pool.reservedCount } });
    try {
      const o = (await offersForClient(anna, r.id)).groups[0].offers[0];
      await expect(selectQuote(anna, { requestId: r.id, requestVersion: 1, quoteId: o.id, quoteVersion: o.seq })).rejects.toMatchObject({ code: "CAPACITY_EXHAUSTED" });
    } finally { await db.capacityPool.update({ where: { id: pool.id }, data: { limitCount: pool.limitCount } }); }
  });
  it("AC10: отозванное и заменённое предложение нельзя оформить", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    const b = Math.round((await base(agentN, r.id, "KASKO_SEV")).base);
    const q1 = (await quote(agentN, r.id, "KASKO_SEV", b)).quote;
    await quote(agentN, r.id, "KASKO_SEV", b - 200);
    await expect(selectQuote(anna, { requestId: r.id, requestVersion: 1, quoteId: q1.id, quoteVersion: q1.seq })).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    const cur = await db.quote.findFirstOrThrow({ where: { requestId: r.id, status: "PUBLISHED" } });
    await withdrawQuote({ ...agentN, orgId: agentN.org.orgId }, cur.id, "Ошибка в расчёте");
    await expect(selectQuote(anna, { requestId: r.id, requestVersion: 1, quoteId: cur.id, quoteVersion: cur.seq })).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
  });
  it("AC21: при устаревшем тарифе автоответ не публикуется, создаётся черновик", async () => {
    await setEmu({ tariffs: { stale: true } } as any);
    try {
      const r = await fill(anna, "PROPERTY", await propData());
      await drainJobs();
      expect(await db.quote.count({ where: { requestId: r.id, agencyOrgId: agentM.org.orgId, status: "PUBLISHED" } })).toBe(0);
    } finally { await setEmu({ tariffs: { stale: false } } as any); }
  });
});

describe("Документы, подпись и помощник", () => {
  it("AC11: замена документа после ознакомления требует нового подтверждения", async () => {
    const r = await fill(anna, "KASKO", await kaskoData());
    await quote(agentN, r.id, "KASKO_SEV", Math.round((await base(agentN, r.id, "KASKO_SEV")).base));
    const ch = await toPayment(anna, r.id).catch(() => null);
    // toPayment выполняет всё до оплаты; для проверки замены документа — новое оформление
    const r2 = await fill(anna, "KASKO", await kaskoData());
    await quote(agentN, r2.id, "KASKO_SEV", Math.round((await base(agentN, r2.id, "KASKO_SEV")).base));
    const o = (await offersForClient(anna, r2.id)).groups[0].offers[0];
    const sel = await selectQuote(anna, { requestId: r2.id, requestVersion: 1, quoteId: o.id, quoteVersion: o.seq });
    const { prepareDocuments, acknowledge } = await import("@/server/domain/checkout");
    await prepareDocuments(anna, sel.checkout_id);
    for (const d of await db.document.findMany({ where: { checkoutId: sel.checkout_id } })) await acknowledge(anna, sel.checkout_id, d.id);
    const rules = await db.document.findFirstOrThrow({ where: { checkoutId: sel.checkout_id, kind: "RULES" } });
    const v2 = await db.document.create({ data: { ...(rules as any), id: undefined, version: 2, sha256: "f".repeat(64), createdAt: undefined } });
    await db.document.update({ where: { id: rules.id }, data: { supersededById: v2.id } });
    await db.rateLimit.deleteMany();
    await expect(requestCode(anna, sel.checkout_id)).rejects.toMatchObject({ code: "NEEDS_INFO" });
    expect(ch).toBeTruthy();
  });
  it("AC22: помощник отвечает со ссылкой на существующий пункт документа сделки", async () => {
    const conv = await db.conversation.findFirstOrThrow({ where: { clientId: anna.user.id, contextType: "CHECKOUT" } });
    await db.rateLimit.deleteMany();
    const r = await sendMessage(anna, conv.id, "Что не покрывается по правилам, какие исключения?", { askAssistant: true });
    const ai = await db.message.findFirstOrThrow({ where: { conversationId: conv.id, authorRole: "AI" }, orderBy: { createdAt: "desc" } });
    if (Array.isArray(ai.citations) && (ai.citations as any[]).length) {
      for (const c of ai.citations as any[]) expect(await db.document.count({ where: { id: c.documentId } })).toBe(1);
    } else expect(ai.handoff).toBe(true);
    expect(r.message).toBeTruthy();
  });
  it("AC23: вредоносная инструкция в документе не меняет права и не создаёт платежей", async () => {
    const r = await createRequest(anna, { productCode: "KASKO" });
    const paysBefore = await db.payment.count();
    const d = await uploadFile(anna, { requestId: r.id }, { name: "sts_injection.pdf", mime: "application/pdf", buf: readFileSync(path.resolve(__dirname, "../../fixtures/docs/sts_injection.pdf")) });
    await scanDocument(d.id);
    const doc = await db.document.findUniqueOrThrow({ where: { id: d.id } });
    expect((doc.extracted as any).untrustedInstructions.length).toBeGreaterThan(0);
    expect((doc.extracted as any).suggestions.every((s: any) => ["car_make", "car_model"].includes(s.key))).toBe(true);
    const u = await db.user.findUniqueOrThrow({ where: { id: anna.user.id }, include: { memberships: true } });
    expect(u.kind).toBe("CLIENT");
    expect(u.memberships).toHaveLength(0);
    expect(await db.payment.count()).toBe(paysBefore);
  });
});

describe("Полис, отзывы, согласия", () => {
  it("AC15: полис до даты начала не показывается действующим", () => {
    const t = new Date("2027-01-01T00:00:00Z");
    expect(coverageState({ contractStatus: "CONCLUDED", startsAt: new Date("2027-02-01"), endsAt: new Date("2028-02-01"), terminatedAt: null }, t)).toBe("PENDING_START");
    expect(coverageState({ contractStatus: "PREPARED", startsAt: new Date("2026-12-01"), endsAt: new Date("2027-12-01"), terminatedAt: null }, t)).toBe("NONE");
    expect(coverageState({ contractStatus: "CONCLUDED", startsAt: new Date("2026-12-01"), endsAt: new Date("2027-12-01"), terminatedAt: null }, t)).toBe("ACTIVE");
  });
  it("AC27: отзыв только по своей подтверждённой сделке; тариф агентства не влияет на рейтинг", async () => {
    const annaPolicy = await db.policy.findFirstOrThrow({ where: { clientId: anna.user.id, contractStatus: "CONCLUDED", agencyOrgId: { not: null } } });
    await expect(upsertReview(igor, { policyId: annaPolicy.id, stage: "SALE", rating: 5, text: "Чужой отзыв" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const before = await agencyRating(annaPolicy.agencyOrgId!);
    const sub = await db.subscription.findUniqueOrThrow({ where: { organizationId: annaPolicy.agencyOrgId! } });
    const team = await db.plan.findUniqueOrThrow({ where: { code: "TEAM" } });
    await db.subscription.update({ where: { id: sub.id }, data: { planId: team.id } });
    expect(await agencyRating(annaPolicy.agencyOrgId!)).toEqual(before);
    await db.subscription.update({ where: { id: sub.id }, data: { planId: sub.planId } });
  });
  it("AC28: маркетинг без согласия не отправляется, сервисные уведомления — всегда", async () => {
    await setConsent({ userId: igor.user.id }, "MARKETING", false, "test");
    expect(await notify(db, igor.user.id, { type: "promo", title: "Скидка", body: "…", category: "MARKETING" })).toBe(false);
    expect(await notify(db, igor.user.id, { type: "svc", title: "Сервис", body: "…" })).toBe(true);
    await setConsent({ userId: igor.user.id }, "MARKETING", true, "test");
    expect(await notify(db, igor.user.id, { type: "promo", title: "Скидка", body: "…", category: "MARKETING" })).toBe(true);
    await setConsent({ userId: igor.user.id }, "MARKETING", false, "test");
  });
});

describe("Подписки агентств", () => {
  it("AC24: повтор платёжного события не продлевает период дважды; отмена автопродления сохраняет доступ до конца периода", async () => {
    const pctx = { ...parus, orgId: parus.org.orgId };
    const inv = await db.subscriptionInvoice.findFirstOrThrow({ where: { organizationId: parus.org.orgId, status: { in: ["OPEN", "FAILED"] } } });
    await db.setting.deleteMany({ where: { key: `saas_card:${parus.org.orgId}` } });
    const pay = await payInvoice(pctx, inv.id, "inv-test-1");
    const ext = pay.confirmationUrl.split("/").pop()!;
    await emulatorPayerAction(ext, "success"); await drainJobs();
    const s1 = await db.subscription.findUniqueOrThrow({ where: { organizationId: parus.org.orgId } });
    expect(s1.status).toBe("ACTIVE");
    await replayWebhook(ext); await replayWebhook(ext); await drainJobs();
    const s2 = await db.subscription.findUniqueOrThrow({ where: { organizationId: parus.org.orgId } });
    expect(s2.periodEnd.getTime()).toBe(s1.periodEnd.getTime());
    await cancelAutoRenew(pctx);
    const s3 = await db.$transaction((tx) => syncSubscription(tx, s2.id, new Date(s2.periodEnd.getTime() - 3600_000)));
    expect(s3.status).toBe("ACTIVE");
    const s4 = await db.$transaction((tx) => syncSubscription(tx, s2.id, new Date(s2.periodEnd.getTime() + 3600_000)));
    expect(s4.status).toBe("ENDED");
  });
  it("AC25: ограниченная подписка запрещает новые ответы, но действующие сделки доступны", async () => {
    const org = agentM.org.orgId;
    const sub = await db.subscription.findUniqueOrThrow({ where: { organizationId: org } });
    await db.subscription.update({ where: { id: sub.id }, data: { status: "RESTRICTED" } });
    try {
      const r = await fill(anna, "KASKO", await kaskoData());
      await expect(db.$transaction((tx) => assertCanRespond(tx, org, r.id, new Date()))).rejects.toMatchObject({ code: "SUBSCRIPTION_RESTRICTED" });
      expect(await db.policy.count({ where: { agencyOrgId: org } })).toBeGreaterThan(0);
      const { canAccessDocument } = await import("@/server/domain/documents");
      const p = await db.policy.findFirstOrThrow({ where: { agencyOrgId: org, clientId: anna.user.id } });
      const doc = await db.document.findFirstOrThrow({ where: { policyId: p.id } });
      expect((await canAccessDocument(anna, doc.id)).basis).toBeTruthy();
    } finally { await db.subscription.update({ where: { id: sub.id }, data: { status: sub.status } }); }
  });
});

describe("Модель матча", () => {
  it("выбор = матч: торги закрыты, другие агентства уведомлены и теряют доступ; данные и чат только у выбранного", async () => {
    const { requestForAgency, repeatRequest, publishRequest } = await import("@/server/domain/requests");
    const { cancelCheckout } = await import("@/server/domain/checkout");
    const r = await fill(anna, "KASKO", await kaskoData());
    await quote(agentN, r.id, "KASKO_SEV", Math.round((await base(agentN, r.id, "KASKO_SEV")).base));
    await quote(agentM, r.id, "KASKO_VOL", Math.round((await base(agentM, r.id, "KASKO_VOL")).base));
    const offers = (await offersForClient(anna, r.id)).groups.flatMap((g: any) => g.offers);
    const pick = offers.find((o: any) => o.agency?.id === agentN.org.orgId)!;
    const sel = await selectQuote(anna, { requestId: r.id, requestVersion: 1, quoteId: pick.id, quoteVersion: pick.seq });
    expect((await db.auction.findFirstOrThrow({ where: { requestId: r.id } })).status).toBe("CLOSED");
    expect(await db.quote.count({ where: { requestId: r.id, agencyOrgId: agentM.org.orgId, status: "EXPIRED" } })).toBe(1);
    expect(await db.notification.count({ where: { type: "request.matched_other", link: "/a" } })).toBeGreaterThan(0);
    await expect(requestForAgency(qctxFull(agentM), r.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const mine = await requestForAgency(qctxFull(agentN), r.id);
    expect(mine.dealCheckoutId).toBe(sel.checkout_id);
    expect((mine.data as any).car_vin).toBeTruthy();
    expect(await db.conversation.count({ where: { contextType: "CHECKOUT", contextId: sel.checkout_id, agencyOrgId: agentN.org.orgId } })).toBe(1);
    expect(await db.conversation.count({ where: { contextType: "CHECKOUT", contextId: sel.checkout_id, agencyOrgId: agentM.org.orgId } })).toBe(0);
    // Изменить существенные данные внутри матча нельзя.
    const cur = await db.insuranceRequest.findUniqueOrThrow({ where: { id: r.id } });
    await expect(saveDraft(anna, r.id, { data: { car_value_rub: 2600000 }, version: cur.version })).rejects.toMatchObject({ code: "CONFLICT" });

    // Отмена матча до оплаты: заявка закрыта, прежние предложения не возвращаются.
    await cancelCheckout(anna, sel.checkout_id, "Клиент отменил матч");
    expect((await db.insuranceRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CANCELLED");
    expect(await db.quote.count({ where: { requestId: r.id, status: { in: ["PUBLISHED", "SELECTED"] } } })).toBe(0);
    await expect(requestForAgency(qctxFull(agentN), r.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Новая заявка тому же агентству: видит только оно.
    const again = await repeatRequest(anna, r.id, { toSameAgency: true });
    expect(again.directAgencyOrgId).toBe(agentN.org.orgId);
    const { confirmFields, getOwnRequest } = await import("@/server/domain/requests");
    const d = await getOwnRequest(db, anna, again.id);
    const { schemaFor } = await import("@/server/domain/catalog");
    const keys = (schemaFor("KASKO").sections as any[]).flatMap((s) => s.fields).filter((f: any) => f.keyField).map((f: any) => f.key);
    await confirmFields(anna, again.id, keys, d.version);
    const fresh = await getOwnRequest(db, anna, again.id);
    const pub = await publishRequest(anna, again.id, fresh.version);
    expect(pub.published).toBe(true);
    const a2 = await db.auction.findFirstOrThrow({ where: { requestId: again.id } });
    expect(a2.eligibleOrgIds).toEqual([agentN.org.orgId]);
    await expect(requestForAgency(qctxFull(agentM), again.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Надёжность и боевой режим", () => {
  it("AC33: задания хранятся в БД и восстанавливаются после падения worker", async () => {
    const j = await enqueue(db, "noop.test", {}, { uniqueKey: `noop:${Date.now()}` });
    await db.job.update({ where: { id: (j as any).id }, data: { status: "RUNNING", lockedAt: new Date(Date.now() - 10 * 60_000), lockedBy: "dead-worker" } });
    await recoverStale();
    expect((await db.job.findUniqueOrThrow({ where: { id: (j as any).id } })).status).toBe("PENDING");
    await db.job.delete({ where: { id: (j as any).id } });
  });
  it("AC34: в боевом режиме эмуляторы и демо-вход недоступны", async () => {
    const prev = process.env.APP_MODE;
    process.env.APP_MODE = "production";
    try {
      const { adapters } = await import("@/server/adapters");
      expect(() => adapters.payment.createPayment({} as any)).toThrow(/не подключён/);
      const { demoSwitch } = await import("@/server/domain/auth");
      await expect(demoSwitch("anna@client.test")).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { process.env.APP_MODE = prev; }
  });
});
