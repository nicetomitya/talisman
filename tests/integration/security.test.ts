import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/server/db";
import { asAdmin, asClient, asAgency } from "@/server/access";
import { offersForClient } from "@/server/domain/auction";
import { requestForAgency, saveDraft } from "@/server/domain/requests";
import { canAccessDocument } from "@/server/domain/documents";
import { grantSupportAccess } from "@/server/domain/admin";
import { getConversation } from "@/server/domain/messaging";
import { getOwnCheckout } from "@/server/domain/checkout";
import { ctxFor, fill, kaskoData, quote, base } from "../helpers";

let anna: any, igor: any, agentN: any, agentM: any, horizon: any, support: any, admin: any, adminNoMfa: any;
let reqId: string;
beforeAll(async () => {
  [anna, igor, agentN, agentM, horizon, support, admin, adminNoMfa] = await Promise.all([ctxFor("anna@client.test"), ctxFor("igor@client.test"), ctxFor("agent@nadezhny.test"), ctxFor("agent1@most.test"), ctxFor("owner@horizon.test"), ctxFor("support@talisman.test"), ctxFor("admin1@talisman.test"), ctxFor("admin2@talisman.test", { mfa: false })]);
  reqId = (await fill(anna, "KASKO", await kaskoData())).id;
});

describe("RBAC и защита от IDOR", () => {
  it("клиент не видит чужую заявку и предложения", async () => {
    await expect(offersForClient(igor, reqId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveDraft(igor, reqId, { data: { car_make: "X" }, version: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("непроверенное агентство не видит заявку и не может предложить цену", async () => {
    await expect(requestForAgency({ ...horizon, orgId: horizon.org.orgId }, reqId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("агент видит только поля для расчёта: без VIN и собственника", async () => {
    const v = await requestForAgency({ ...agentN, orgId: agentN.org.orgId }, reqId);
    expect(v.data.car_vin).toBeUndefined();
    expect(v.data.owner_name).toBeUndefined();
    expect(v.data.car_make).toBe("Kia");
  });
  it("премия вне разрешённой котировки отвергается сервером", async () => {
    const b = await base(agentN, reqId, "KASKO_SEV");
    await expect(quote(agentN, reqId, "KASKO_SEV", Math.floor(b.min) - 100)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(quote(agentN, reqId, "KASKO_SEV", Math.ceil(b.max) + 100)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("агентство без полномочия на продукт не может предложить его", async () => {
    // «Мост» не имеет полномочий по каско «Северного щита» в демо-данных
    const pid = (await db.product.findUniqueOrThrow({ where: { code: "KASKO_SEV" } })).id;
    await db.mandate.updateMany({ where: { agencyOrgId: agentM.org.orgId, productId: pid }, data: { status: "REVOKED", revokeReason: "тест" } });
    await expect(quote(agentM, reqId, "KASKO_SEV", 50000)).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/полномочий/) });
    await db.mandate.updateMany({ where: { agencyOrgId: agentM.org.orgId, productId: pid, revokeReason: "тест" }, data: { status: "ACTIVE", revokeReason: null } });
  });
  it("документы: чужой клиент не получает доступ, поддержка — только по основанию со сроком", async () => {
    const doc = await db.document.findFirstOrThrow({ where: { ownerUserId: anna.user.id, kind: "POLICY" } });
    await expect(canAccessDocument(igor, doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(canAccessDocument(support, doc.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await grantSupportAccess(support, { targetType: "Document", targetId: doc.id, reason: "Обращение клиента №1: проверка документа", minutes: 10 });
    expect((await canAccessDocument(support, doc.id)).basis).toMatch(/^support_grant/);
    const audit = await db.auditLog.count({ where: { action: "support.access_granted", entityId: doc.id } });
    expect(audit).toBeGreaterThan(0);
  });
  it("агентство не читает переписку и оформление другого агентства", async () => {
    const conv = await db.conversation.findFirstOrThrow({ where: { agencyOrgId: agentN.org.orgId } });
    await expect(getConversation(agentM, conv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ch = await db.checkout.findFirstOrThrow({ where: { clientId: anna.user.id } });
    await expect(getOwnCheckout(db, igor, ch.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("административные изменения требуют второго фактора; роли не смешиваются", () => {
    expect(() => asAdmin(adminNoMfa, { mutation: true })).toThrow(/второй фактор/);
    expect(() => asAdmin(admin, { mutation: true })).not.toThrow();
    expect(() => asAdmin(support, { mutation: true })).toThrow();
    expect(() => asClient(agentN)).toThrow();
    expect(() => asAgency(anna)).toThrow();
  });
});
