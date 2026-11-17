/**
 * Критерии приёмки дополнения ТЗ от 16.11.2026 (раздел 14): CRM агента без регистрации клиентов,
 * приглашение и связывание, изоляция агентств, независимость новых подборов, атрибуция и биллинг,
 * страховой случай свободным текстом, полисы вне платформы, отзыв согласия, спорная комиссия.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/server/db";
import { asAgency } from "@/server/access";
import * as CRM from "@/server/domain/crm";
import { addExternalPolicy, marketCheck, triageIncident, looksLikeIncident } from "@/server/domain/cabinet";
import { accrueCommissions, disputeCommission, setCommissionStatus } from "@/server/domain/commissions";
import { startRenewal } from "@/server/domain/policies";
import { publishRequest, saveDraft, confirmFields, createRequest } from "@/server/domain/requests";
import { allFields } from "@/server/domain/forms";
import { schemaFor } from "@/server/domain/catalog";
import { hashPassword } from "@/server/auth/crypto";
import { ctxFor, fill, kaskoData, propData, quote, base, toPayment, payAndConclude } from "../helpers";

let ownerN: any, agentN: any, agentM: any, ownerM: any, anna: any, admin: any;
const ag = (c: any) => asAgency(c);
let n = 0;
async function newClient(email?: string) {
  const e = email ?? `crm-client-${Date.now()}-${++n}@client.test`;
  await db.user.create({ data: { email: e, name: `Клиент ${n} Тестовый`, kind: "CLIENT", passwordHash: await hashPassword("demo-password-123"), emailVerifiedAt: new Date() } });
  return ctxFor(e);
}
async function invite(agency: any, email: string, notes = "Внутренняя заметка: торгуется, звонить вечером") {
  const c = await CRM.createContact(ag(agency), { name: "Ольга Импортная", email, phone: null, legalBasis: "EXISTING_CONTRACT", notes });
  const inv = await CRM.prepareInvitation(ag(agency), c.id);
  return { contact: c, token: inv.link.split("/invite/")[1], inv };
}

beforeAll(async () => {
  [ownerN, agentN, agentM, ownerM, anna, admin] = await Promise.all([ctxFor("owner@nadezhny.test"), ctxFor("agent@nadezhny.test"), ctxFor("agent1@most.test"), ctxFor("owner@most.test"), ctxFor("anna@client.test"), ctxFor("admin1@talisman.test")]);
});

describe("CRM: импорт собственной базы без регистрации клиентов", () => {
  it("агент импортирует 500 контактов, ведёт задачи и продления при 0 зарегистрированных", async () => {
    const users0 = await db.user.count();
    const mails0 = await db.demoMail.count();
    const m0 = await CRM.crmMetrics(ag(ownerN));
    const lines = ["Имя;Телефон;Email;Вид;Страховщик;Номер полиса;Объект;Дата окончания;Премия;Примечание"];
    for (let i = 0; i < 500; i++) lines.push(`Контакт ${i};+7 900 ${String(1000000 + i).slice(0, 3)}-${String(1000000 + i).slice(3, 5)}-${String(1000000 + i).slice(5, 7)};imp${i}@import.test;КАСКО;Северный щит;SH-${i};"Kia Rio, ${2015 + (i % 8)}";${["15.03.2027", "2027-01-20"][i % 2]};12 500;звонить после 18`);
    lines.push("Контакт 0 дубль;+7 900 100-00-00;;КАСКО;;;;;;"); // дубль по телефону внутри файла
    lines.push(";+7 911 000-00-00;;;;;;;;"); // без имени
    const r = await CRM.importContacts(ag(agentN), { fileName: "base.csv", csv: lines.join("\n"), legalBasis: "EXISTING_CONTRACT" });
    expect(r).toMatchObject({ total: 502, created: 500, duplicates: 1, rejected: 1, policies: 500, tasks: 500 });
    expect(await db.user.count()).toBe(users0); // аккаунты не создаются
    expect(await db.demoMail.count()).toBe(mails0); // и ничего не отправляется
    const p = await db.crmPolicy.findFirstOrThrow({ where: { organizationId: agentN.org.orgId, number: "SH-1" } });
    expect(p.premiumKop).toBe(1_250_000);
    expect(p.category).toBe("KASKO");
    const m = await CRM.crmMetrics(ag(ownerN));
    expect(m.imported - m0.imported).toBe(500);
    expect(m.registered).toBe(m0.registered); // импорт не добавляет зарегистрированных
    const batch = await db.crmContact.findMany({ where: { organizationId: agentN.org.orgId, importBatchId: r.batchId } });
    expect(batch.every((c) => c.linkState === "NOT_INVITED" && c.linkedUserId === null)).toBe(true);
    // Повторная загрузка того же файла — только дубли.
    const again = await CRM.importContacts(ag(agentN), { fileName: "base.csv", csv: lines.join("\n"), legalBasis: "EXISTING_CONTRACT" });
    expect(again.created).toBe(0);
    expect(again.duplicates).toBe(501);
  });

  it("контакты агентства не видны другому агентству; агент видит свои и неназначенные карточки", async () => {
    const any = await db.crmContact.findFirstOrThrow({ where: { organizationId: agentN.org.orgId } });
    await expect(CRM.contactCard(ag(agentM), any.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await CRM.listContacts(ag(agentM), { q: "Контакт 1" })).length).toBe(0);
    await expect(CRM.prepareInvitation(ag(agentM), any.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Карточка, закреплённая за другим сотрудником, агенту не видна; владельцу — видна.
    const otherStaff = await db.membership.findFirstOrThrow({ where: { organizationId: ownerN.org.orgId, userId: ownerN.user.id } });
    const c = await CRM.createContact(ag(ownerN), { name: "Закреплённый контакт", phone: "+7 901 555-44-33", legalBasis: "CLIENT_CONSENT", responsibleUserId: otherStaff.userId });
    await expect(CRM.contactCard(ag(agentN), c.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await CRM.contactCard(ag(ownerN), c.id)).contact.id).toBe(c.id);
  });

  it("ручной контакт: дубль по телефону отклоняется, задачи и подготовленный текст без отправки", async () => {
    const c = await CRM.createContact(ag(agentN), { name: "Павел Ручной", phone: "8 (902) 111-22-33", legalBasis: "CLIENT_CONSENT" });
    expect(c.phoneNorm).toBe("+79021112233");
    await expect(CRM.createContact(ag(agentN), { name: "Павел 2", phone: "+7 902 111 22 33", legalBasis: "CLIENT_CONSENT" })).rejects.toMatchObject({ code: "CONFLICT" });
    const t = new Date(Date.now() + 40 * 86400_000).toISOString().slice(0, 10);
    await CRM.addCrmPolicy(ag(agentN), c.id, { category: "PROPERTY", insurerName: "Волга-Гарант", objectTitle: "Квартира", endsAt: t });
    const card = await CRM.contactCard(ag(agentN), c.id);
    expect(card.tasks.some((x) => x.title.startsWith("Продление"))).toBe(true);
    const mails0 = await db.demoMail.count();
    const d = await CRM.draftMessage(ag(agentN), c.id, "RENEWAL");
    expect(d.text).toContain("Волга-Гарант");
    expect(d.text).not.toMatch(/гарантир|успейте|только сегодня/i);
    expect(await db.demoMail.count()).toBe(mails0);
  });
});

describe("Приглашение и связывание аккаунта", () => {
  it("агент готовит приглашение; клиент регистрируется, подтверждает данные; чужие заметки не раскрываются", async () => {
    const client = await newClient();
    const { contact, token, inv } = await invite(agentN, client.user.email);
    expect(inv.text).toContain("/invite/");
    expect(inv.text).not.toMatch(/обязательн(о|ая) регистр/i);
    await CRM.addCrmPolicy(ag(agentN), contact.id, { category: "KASKO", insurerName: "Северный щит", number: "SH-777", objectTitle: "Kia Rio", endsAt: "2027-05-01" });
    await CRM.markInvitationSent(ag(agentN), contact.id, "WHATSAPP");
    expect((await db.crmContact.findUniqueOrThrow({ where: { id: contact.id } })).linkState).toBe("SENT");

    const preview = await CRM.invitationPreview(token);
    expect(Object.keys(preview).sort()).toEqual(["expiresAt", "orgName"]); // без данных контакта

    const acc = await CRM.acceptInvitation(client, token);
    expect(acc.channelsMatch).toBe(true);
    expect((await db.crmContact.findUniqueOrThrow({ where: { id: contact.id } })).linkState).toBe("REGISTERED");
    await expect(CRM.acceptInvitation(client, token)).rejects.toMatchObject({ code: "NOT_FOUND" }); // ссылка одноразовая
    const u = await db.user.findUniqueOrThrow({ where: { id: client.user.id } });
    expect(u).toMatchObject({ acquisitionSource: "IMPORTED_BY_AGENT", acquisitionOrgId: agentN.org.orgId });

    const links = await CRM.myAgentLinks(client);
    expect(links).toHaveLength(1);
    expect(JSON.stringify(links)).not.toContain("Внутренняя заметка");
    expect(JSON.stringify(links)).not.toContain("звонить");

    const r = await CRM.confirmLink(client, contact.id, { sharePolicies: true });
    expect(r.sharedPolicies).toBe(1);
    const ext = await db.externalPolicy.findMany({ where: { clientId: client.user.id } });
    expect(ext).toHaveLength(1);
    expect(ext[0]).toMatchObject({ source: "AGENT_CRM", verification: "AGENT_STATED", number: "SH-777" });
    expect((await db.crmContact.findUniqueOrThrow({ where: { id: contact.id } })).linkState).toBe("VERIFIED_LINKED");
    expect((await CRM.crmMetrics(ag(ownerN))).linked).toBeGreaterThanOrEqual(1);
  });

  it("совпадение по почте без подтверждённого канала — не автоматическое слияние: связать нельзя", async () => {
    const client = await newClient();
    const { contact, token } = await invite(agentN, `someone-else-${Date.now()}@client.test`);
    await CRM.acceptInvitation(client, token);
    await expect(CRM.confirmLink(client, contact.id, { sharePolicies: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Клиент может отклонить: карточка агентства остаётся, связь снимается.
    await CRM.revokeLink(client, contact.id);
    const c = await db.crmContact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(c).toMatchObject({ linkState: "REVOKED", linkedUserId: null });
  });

  it("истёкшее приглашение не принимается; агент не может сам перевести контакт в «связан»", async () => {
    const client = await newClient();
    const { contact, token } = await invite(agentN, client.user.email);
    await db.crmContact.update({ where: { id: contact.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    await expect(CRM.acceptInvitation(client, token)).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    await expect(CRM.markInvitationSent(ag(agentN), contact.id, "EMAIL")).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    await expect(CRM.confirmLink(agentN, contact.id, { sharePolicies: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("один клиент у двух агентств: каждое видит только свои данные и свои договоры", async () => {
    const client = await newClient();
    const a = await invite(agentN, client.user.email, "Заметка Надёжного");
    const b = await invite(agentM, client.user.email, "Заметка Моста");
    await CRM.acceptInvitation(client, a.token); await CRM.confirmLink(client, a.contact.id, { sharePolicies: false });
    await CRM.acceptInvitation(client, b.token); await CRM.confirmLink(client, b.contact.id, { sharePolicies: false });
    const cardN = await CRM.contactCard(ag(agentN), a.contact.id);
    const cardM = await CRM.contactCard(ag(agentM), b.contact.id);
    expect(cardN.contact.notes).toBe("Заметка Надёжного");
    expect(cardM.contact.notes).toBe("Заметка Моста");
    await expect(CRM.contactCard(ag(agentM), a.contact.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Договор, оформленный с «Мостом», в карточке «Надёжного» не появляется.
    const r = await fill(client, "PROPERTY", await propData());
    await quote(agentM, r.id, "PROPERTY_VOL", Math.round((await base(agentM, r.id, "PROPERTY_VOL")).base));
    const { policy } = await payAndConclude(client, await toPayment(client, r.id));
    expect(policy?.agencyOrgId).toBe(agentM.org.orgId);
    expect((await CRM.contactCard(ag(agentN), a.contact.id)).platformPolicies).toHaveLength(0);
    expect((await CRM.contactCard(ag(agentM), b.contact.id)).platformPolicies.map((p) => p.id)).toContain(policy!.id);
    // Отзыв доступа у «Мост»: карточка остаётся, договоры — тоже, но связь снята.
    await CRM.revokeLink(client, b.contact.id);
    expect((await CRM.contactCard(ag(agentM), b.contact.id)).platformPolicies).toHaveLength(0);
    const consent = await db.consent.findFirstOrThrow({ where: { userId: client.user.id, purpose: "AGENT_LINK", recipients: agentM.org.orgId } });
    expect(consent.revokedAt).not.toBeNull();
  });
});

describe("Новый подбор не закрепляется за прежним агентом; атрибуция и биллинг", () => {
  let imported: any;
  beforeAll(async () => {
    imported = await newClient();
    const { contact, token } = await invite(agentN, imported.user.email);
    await CRM.acceptInvitation(imported, token);
    await CRM.confirmLink(imported, contact.id, { sharePolicies: false });
  });

  it("импортированный клиент: заявка открыта всем подходящим агентствам, побеждает другое — обычная marketplace-доля", async () => {
    const r = await fill(imported, "KASKO", await kaskoData());
    expect(r).toMatchObject({ source: "IMPORTED_BY_AGENT", sourceOrgId: agentN.org.orgId, directAgencyOrgId: null });
    const auction = await db.auction.findFirstOrThrow({ where: { requestId: r.id } });
    expect(auction.eligibleOrgIds).toEqual(expect.arrayContaining([agentN.org.orgId, agentM.org.orgId]));
    await quote(agentM, r.id, "KASKO_VOL", Math.round((await base(agentM, r.id, "KASKO_VOL")).base));
    const { policy } = await payAndConclude(imported, await toPayment(imported, r.id));
    const rows = await db.commission.findMany({ where: { policyId: policy!.id, kind: "DISTRIBUTION" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.dealOrigin === "IMPORTED_OTHER_AGENCY")).toBe(true);
    expect(rows.find((x) => x.recipientType === "PLATFORM")!.rateBp).toBe(2000);
    // Повторное начисление по тому же полису не создаёт второй записи.
    await db.$transaction((tx) => accrueCommissions(tx, policy!.id));
    expect(await db.commission.count({ where: { policyId: policy!.id, kind: "DISTRIBUTION" } })).toBe(2);
  });

  it("импортированный клиент снова выбирает пригласившее агентство — пониженная доля, без двойного начисления", async () => {
    const r = await fill(imported, "PROPERTY", await propData());
    expect(r.source).toBe("EXISTING_USER"); // вторая заявка — уже существующий пользователь, но агентство-источник сохраняется
    expect(r.sourceOrgId).toBe(agentN.org.orgId);
    await quote(agentN, r.id, "PROPERTY_SEV", Math.round((await base(agentN, r.id, "PROPERTY_SEV")).base));
    const { policy } = await payAndConclude(imported, await toPayment(imported, r.id));
    const rows = await db.commission.findMany({ where: { policyId: policy!.id, kind: "DISTRIBUTION" } });
    const platform = rows.find((x) => x.recipientType === "PLATFORM")!, agency = rows.find((x) => x.recipientType === "AGENCY")!;
    expect(platform).toMatchObject({ dealOrigin: "IMPORTED_SAME_AGENCY", rateBp: 1000 });
    expect(platform.amountKop + agency.amountKop).toBe(Math.round((policy!.premiumKop * 1500) / 10000)); // одна сумма делится, а не начисляется дважды
  });

  it("клиент пришёл сам — MARKETPLACE; полисы из CRM и добавленные вручную начислений не создают", async () => {
    const before = await db.commission.count();
    const r = await fill(anna, "KASKO", await kaskoData());
    expect(["ORGANIC", "EXISTING_USER"]).toContain(r.source);
    expect(r.sourceOrgId).toBeNull();
    await addExternalPolicy(anna, { category: "OSAGO", insurerName: "Другая страховая", objectTitle: "Kia K5", endsAt: "2027-06-01" });
    await CRM.addCrmPolicy(ag(agentN), (await db.crmContact.findFirstOrThrow({ where: { organizationId: agentN.org.orgId } })).id, { category: "KASKO", insurerName: "Северный щит", objectTitle: "Авто", endsAt: "2027-06-01" });
    expect(await db.commission.count()).toBe(before);
    await quote(agentN, r.id, "KASKO_SEV", Math.round((await base(agentN, r.id, "KASKO_SEV")).base));
    const { policy } = await payAndConclude(anna, await toPayment(anna, r.id));
    const rows = await db.commission.findMany({ where: { policyId: policy!.id } });
    expect(rows.every((x) => x.dealOrigin === "MARKETPLACE")).toBe(true);
  });

  it("повторный подбор по истекающему полису: прежнее агентство конкурирует с новыми", async () => {
    const pol = await db.policy.findFirstOrThrow({ where: { clientId: anna.user.id, productCode: "KASKO", contractStatus: "CONCLUDED", agencyOrgId: agentN.org.orgId } });
    const nr = await startRenewal(anna, pol.id);
    const r = await db.insuranceRequest.findUniqueOrThrow({ where: { id: nr.id } });
    const keys = allFields(schemaFor("KASKO")).filter((f) => f.keyField && (r.data as any)[f.key] !== undefined).map((f) => f.key);
    const conf = await confirmFields(anna, r.id, keys, r.version);
    const pub = await publishRequest(anna, r.id, conf.version);
    expect(pub.published).toBe(true);
    const auction = await db.auction.findFirstOrThrow({ where: { requestId: r.id } });
    expect(auction.eligibleOrgIds).toEqual(expect.arrayContaining([agentN.org.orgId, agentM.org.orgId]));
    expect(r.directAgencyOrgId).toBeNull();
  });

  it("спорная комиссия: владелец агентства оспаривает, администратор решает; сторно отдельной записью", async () => {
    const c = await db.commission.findFirstOrThrow({ where: { kind: "DISTRIBUTION", recipientType: "PLATFORM", dealOrigin: "IMPORTED_SAME_AGENCY" } });
    await expect(disputeCommission(ag(agentN), c.id, "Клиент наш, сделка не с маркетплейса")).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // только владелец
    await expect(disputeCommission(ag(ownerM), c.id, "Чужое начисление пытаемся оспорить")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const d = await disputeCommission(ag(ownerN), c.id, "Клиент наш, сделка не с маркетплейса");
    expect(d.status).toBe("DISPUTED");
    await expect(setCommissionStatus(agentN, c.id, "REVERSED")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await setCommissionStatus(admin, c.id, "REVERSED", "Признано: клиент из CRM агентства");
    const rev = await db.commission.findFirstOrThrow({ where: { reversalOfId: c.id, kind: "DISPUTE_REVERSAL" } });
    expect(rev.amountKop).toBe(-c.amountKop);
    await expect(setCommissionStatus(admin, c.id, "CONFIRMED")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("Кабинет клиента: страховой случай текстом, полисы вне платформы, дубли", () => {
  it("«Меня затопили соседи»: подходящий полис, чек-лист и доказательства без обещания выплаты", async () => {
    expect(looksLikeIncident("Меня затопили соседи")).toBe(true);
    expect(looksLikeIncident("Хочу застраховать свадьбу от дождя")).toBe(false);
    const r = await triageIncident(anna, "Меня затопили соседи сверху, течёт с потолка");
    expect(r.category).toBe("PROPERTY");
    const prop = r.candidates.find((c) => c.kind === "PLATFORM");
    expect(prop).toBeTruthy();
    // Защита по демо-полису ещё не началась — обращение не предлагается, причина объяснена.
    if (!prop!.canCreateClaim) expect(prop!.why).toMatch(/Защита начинается/);
    expect(r.firstSteps.join(" ")).toMatch(/акт/i);
    expect(r.evidence.length).toBeGreaterThan(0);
    const all = JSON.stringify(r);
    expect(all).toMatch(/не решение о выплате/);
    expect(all).not.toMatch(/гарантир|вам выплатят|покрытие подтверждено/i);
  });

  it("полис вне платформы: источник и проверка отдельно; «сравнить с рынком» — новая независимая заявка", async () => {
    const p = await addExternalPolicy(anna, { category: "PROPERTY", insurerName: "Иная СК", number: "IN-1", objectTitle: "Дача", endsAt: "2027-03-01" });
    expect(p).toMatchObject({ source: "CLIENT_MANUAL", verification: "UNVERIFIED" });
    const r = await marketCheck(anna, p.id);
    const req = await db.insuranceRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(req).toMatchObject({ productCode: "PROPERTY", directAgencyOrgId: null });
    expect(req.sourceDetail).toContain("market-check");
    const igor = await ctxFor("igor@client.test");
    await expect(marketCheck(igor, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const osago = await addExternalPolicy(anna, { category: "OSAGO", insurerName: "Иная СК", objectTitle: "Kia", endsAt: "2027-03-01" });
    await expect(marketCheck(anna, osago.id)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("одна активная заявка на объект и период: дубль не публикуется", async () => {
    const data = await kaskoData();
    await fill(anna, "KASKO", data);
    await expect(fill(anna, "KASKO", data)).rejects.toMatchObject({ code: "CONFLICT" });
    // Другой объект — можно.
    await expect(fill(anna, "KASKO", await kaskoData())).resolves.toBeTruthy();
  });

  it("SEO-переход фиксируется в заявке как источник", async () => {
    const r = await createRequest(anna, { productCode: "RAIN01", sourceDetail: "seo:wedding-rain" });
    expect(r.sourceDetail).toBe("seo:wedding-rain");
    await saveDraft(anna, r.id, { data: {}, version: r.version });
  });
});
