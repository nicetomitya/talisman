import { rm } from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { hashPassword, randomToken, sha256 } from "../auth/crypto";
import { buildCtx, type Ctx } from "../access";
import { setNow, resetClock, now } from "../clock";
import { FORM_SCHEMAS } from "../domain/forms";
import { TEXT_VERSIONS } from "../domain/consents";
import { createRequest, saveDraft, confirmFields, publishRequest } from "../domain/requests";
import { submitQuote, offersForClient, closeAuctionJob } from "../domain/auction";
import { selectQuote, prepareDocuments, acknowledge, requestCode, verifyCode, createPremiumPayment } from "../domain/checkout";
import { emulatorPayerAction } from "../adapters/payment";
import { drainJobs } from "../worker";
import { allFields } from "../domain/forms";
import { schemaFor } from "../domain/catalog";
import { setEmu, EMU_DEFAULTS } from "../adapters/emu";
import { runEventCheck } from "../domain/events";
import { createClassicClaim, submitClaim, staffClaimAction } from "../domain/claims";
import { sendMessage, ensureConversation } from "../domain/messaging";
import { terminatePolicy } from "../domain/policies";
import { upsertReview } from "../domain/reviews";
import { buildFixtures } from "./fixtures";
import { totpNow } from "../auth/totp";
import { DEMO_RULES } from "../config";

export const DEMO_PASSWORD = "Demo-Talisman-2026";
/** Фиксированные TOTP-секреты демо-сотрудников (только DEMO_MODE; показываются в демопанели). */
export const DEMO_TOTP: Record<string, string> = {
  "admin1@talisman.test": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  "admin2@talisman.test": "KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU",
  "support@talisman.test": "MFRGGZDFMZTWQ2LKMFRGGZDFMZTWQ2LK",
  "rep@severshield.test": "NBSWY3DPO5XXE3DENBSWY3DPO5XXE3DE",
  "rep@volgagarant.test": "OBQXG43XN5ZGIZLSOBQXG43XN5ZGIZLS",
};

export async function truncateAll() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await rm(path.resolve(process.env.STORAGE_DIR ?? "./storage/private"), { recursive: true, force: true });
}

async function ctxFor(email: string, orgName?: string): Promise<Ctx> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: { include: { organization: true } } } });
  const org = orgName ? u.memberships.find((m) => m.organization.name === orgName) : u.memberships[0];
  const s = await db.session.create({ data: { tokenHash: sha256(randomToken()), userId: u.id, activeOrgId: org?.organizationId ?? null, mfaVerifiedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), isDemoSwitch: true } });
  return buildCtx({ ...s, user: u }, "seed");
}

const D = (s: string) => new Date(s);

export async function seed(opts: { log?: (s: string) => void; scenarioData?: boolean } = {}) {
  const log = opts.log ?? (() => {});
  await resetClock();
  const realNow = new Date();
  const pw = await hashPassword(DEMO_PASSWORD);

  // ── Организации ──
  const platform = await db.organization.create({ data: { type: "PLATFORM", name: "Платформа «Талисман» (демо)", verificationStatus: "VERIFIED", licenseNote: "Демонстрационная среда. Реальных продаж нет." } });
  const sev = await db.organization.create({ data: { type: "CARRIER", name: "Северный щит Страхование", legalName: "АО «Северный щит Страхование» (вымышленное)", inn: "7700000001", verificationStatus: "VERIFIED", licenseNote: "Вымышленный страховщик. Реальной страховой лицензии нет, продаж нет." } });
  const volga = await db.organization.create({ data: { type: "CARRIER", name: "Волга Гарант", legalName: "ООО СК «Волга Гарант» (вымышленное)", inn: "7700000002", verificationStatus: "VERIFIED", licenseNote: "Вымышленный страховщик. Реальной страховой лицензии нет, продаж нет." } });
  const yearAhead = new Date(realNow.getTime() + 365 * 86400_000);
  const agencyBase = { verificationStatus: "VERIFIED" as const, verifiedUntil: yearAhead, licenseNote: "Демонстрационное агентство. Реальных полномочий и продаж нет.", languages: "русский, английский" };
  const a1 = await db.organization.create({ data: { ...agencyBase, type: "AGENCY", name: "Надёжный курс", legalName: "ООО «Надёжный курс» (вымышл.)", inn: "7800000011", specialization: "Каско и имущество", territory: "Санкт-Петербург, Москва", responseMode: "С подтверждением, до 15 минут", description: "Подбираем каско и страхование квартиры с понятными условиями." } });
  const a2 = await db.organization.create({ data: { ...agencyBase, type: "AGENCY", name: "Страховой дом «Мост»", legalName: "ООО «Мост» (вымышл.)", inn: "7800000012", specialization: "Имущество, семейные клиенты", territory: "Россия", responseMode: "Автоматический для квартир", description: "Команда из трёх агентов, сопровождение клиентов круглый год." } });
  const a3 = await db.organization.create({ data: { ...agencyBase, type: "AGENCY", name: "Парус и погода", legalName: "ИП Ветров Г. С. (вымышл.)", inn: "7800000013", specialization: "Событийная защита, каско", territory: "Санкт-Петербург", responseMode: "Ручной", description: "Защита мероприятий от дождя и парусных занятий от штиля." } });
  const a4 = await db.organization.create({ data: { type: "AGENCY", name: "Новый горизонт", verificationStatus: "PENDING", licenseNote: "Проходит проверку: реальные предложения заблокированы.", specialization: "Каско" } });
  for (const a of [a1, a2, a3]) await db.orgVerification.create({ data: { organizationId: a.id, status: "VERIFIED", note: "Проверены документы о полномочиях (демо)", validUntil: yearAhead } });
  await db.orgVerification.create({ data: { organizationId: a4.id, status: "PENDING", note: "Ожидает проверки документов" } });

  // ── Пользователи ──
  const mkUser = async (email: string, name: string, kind: "CLIENT" | "STAFF", phone?: string) =>
    db.user.create({ data: { email, name, kind, phone, passwordHash: pw, emailVerifiedAt: realNow, totpSecret: DEMO_TOTP[email] ?? null, totpEnabled: !!DEMO_TOTP[email] } });
  const anna = await mkUser("anna@client.test", "Анна Смирнова", "CLIENT", "+7 900 000-00-01");
  const igor = await mkUser("igor@client.test", "Игорь Петров", "CLIENT", "+7 900 000-00-02");
  const staff: [string, string, string, any][] = [
    ["admin1@talisman.test", "Мария Админова", platform.id, "ADMIN"], ["admin2@talisman.test", "Олег Второв", platform.id, "ADMIN"], ["support@talisman.test", "Светлана Помощь", platform.id, "SUPPORT"],
    ["rep@severshield.test", "Павел Северов (страховщик)", sev.id, "CARRIER_REP"], ["rep@volgagarant.test", "Ольга Волжская (страховщик)", volga.id, "CARRIER_REP"],
    ["owner@nadezhny.test", "Елена Курсова", a1.id, "AGENCY_OWNER"], ["agent@nadezhny.test", "Дмитрий Агентов", a1.id, "AGENT"],
    ["owner@most.test", "Сергей Мостов", a2.id, "AGENCY_OWNER"], ["agent1@most.test", "Ирина Лаврова", a2.id, "AGENT"], ["agent2@most.test", "Артём Ковалёв", a2.id, "AGENT"],
    ["owner@parus.test", "Глеб Ветров", a3.id, "AGENCY_OWNER"], ["owner@horizon.test", "Нина Горизонтова", a4.id, "AGENCY_OWNER"],
  ];
  for (const [email, name, orgId, role] of staff) {
    const u = await mkUser(email, name, "STAFF");
    await db.membership.create({ data: { userId: u.id, organizationId: orgId, role } });
  }
  // Один человек в нескольких организациях: владелец «Паруса» также агент «Надёжного курса».
  const gleb = await db.user.findUniqueOrThrow({ where: { email: "owner@parus.test" } });
  await db.membership.create({ data: { userId: gleb.id, organizationId: a1.id, role: "AGENT" } });

  for (const u of [anna, igor]) {
    await db.consent.createMany({ data: [
      { userId: u.id, purpose: "PD_PROCESSING", textVersion: TEXT_VERSIONS.PD_PROCESSING, granted: true, method: "seed" },
      { userId: u.id, purpose: "TERMS", textVersion: TEXT_VERSIONS.TERMS, granted: true, method: "seed" },
      { userId: u.id, purpose: "MARKETING", textVersion: TEXT_VERSIONS.MARKETING, granted: u.id === anna.id, method: "seed" },
    ] });
  }

  // ── Каталог ──
  for (const s of FORM_SCHEMAS) await db.formSchema.create({ data: { country: s.country, productCode: s.productCode, version: s.version, fields: s as any } });
  const exclusions = [{ code: "DUI", title: "Управление в состоянии опьянения" }, { code: "NO_LICENSE", title: "Управление без права управления" }, { code: "WEAR", title: "Износ и коррозия" }];
  const pexcl = [{ code: "GRADUAL", title: "Постепенное разрушение и износ" }, { code: "INTENT", title: "Умышленные действия" }];
  const kaskoRules = (rates: Record<string, number>, discount: number) => ({ product: "KASKO", baseRateBp: rates, riskWeightsBp: { DAMAGE: 7000, THEFT: 2000, GLASS: 500, NATURAL: 500 }, surchargesBp: { perVehicleYear: 150, youngDriver: 2500, lowExperience: 2000, perClaim: 1500 }, usageBp: { PERSONAL: 0, TAXI: 6000, RENTAL: 4000 }, repairBp: { DEALER: 1500, SERVICE: 0, CASH: 500 }, agentDiscountMaxBp: discount, agentMarkupMaxBp: 1500, minPremiumKop: 15_000_00, inspectionAboveRub: 3_000_000, maxVehicleAge: 15, exclusions, settlement: "Ремонт или выплата в течение 15 рабочих дней после получения документов", emergencyPhone: "+7 800 000-00-00 (демо)", commissionBp: 1500, allowedFeesKop: 0 });
  const propRules = (rates: Record<string, number>) => ({ product: "PROPERTY", baseRateBp: rates, riskWeightsBp: { FIRE: 4000, WATER: 4000, THEFT: 1000, NATURAL: 1000 }, coverWeightsBp: { STRUCTURE: 3000, FINISH: 3000, CONTENTS: 2500, LIABILITY: 1500 }, surchargesBp: { oldBuilding: 2000 }, usageBp: { OWN: 0, RENT_OUT: 2500, COMMERCIAL: "DECLINE" }, constructionBp: { BRICK: 0, MONOLITH: 0, PANEL: 500, WOOD: 5000 }, agentDiscountMaxBp: 1000, agentMarkupMaxBp: 1500, minPremiumKop: 3_000_00, exclusions: pexcl, settlement: "Выплата в течение 20 рабочих дней", emergencyPhone: "+7 800 000-00-01 (демо)", commissionBp: 1500, allowedFeesKop: 0 });
  const tariffFrom = new Date(realNow.getTime() - 400 * 86400_000), tariffTo = new Date(realNow.getTime() + 400 * 86400_000);
  const mkProduct = async (code: string, kind: "CLASSIC" | "EVENT", title: string, summary: string, carrierId: string, line: string, rules: any, extraTerms: any = {}, distributorOrgId: string | null = null) => {
    const p = await db.product.create({ data: { code, kind, title, summary, carrierOrgId: carrierId, distributorOrgId, status: "PUBLISHED", instantQuote: kind === "EVENT", auctionAllowed: kind === "CLASSIC",
      versions: { create: { version: 1, status: "PUBLISHED", publishedAt: tariffFrom, terms: { productCode: line, country: "RU", currency: "RUB", ...extraTerms } } } } });
    await db.tariffVersion.create({ data: { productId: p.id, carrierOrgId: carrierId, version: 1, rules, validFrom: tariffFrom, validTo: tariffTo } });
    await db.capacityPool.create({ data: { carrierOrgId: carrierId, productCode: line, limitCount: kind === "EVENT" ? 50 : 200 } }).catch(() => {});
    return p;
  };
  const kSev = await mkProduct("KASKO_SEV", "CLASSIC", "Каско «Северный щит»", "Ущерб, угон, стёкла; ремонт на СТОА или у дилера", sev.id, "KASKO", kaskoRules({ "0": 450, "15000": 380, "30000": 330 }, 1000));
  const kVol = await mkProduct("KASKO_VOL", "CLASSIC", "Каско «Волга Гарант»", "Классическое каско с выбором франшизы", volga.id, "KASKO", kaskoRules({ "0": 440, "15000": 370, "30000": 325 }, 800));
  const pSev = await mkProduct("PROPERTY_SEV", "CLASSIC", "Квартира «Северный щит»", "Конструктив, отделка, имущество и ответственность", sev.id, "PROPERTY", propRules({ "0": 30, "5000": 25, "10000": 22 }));
  const pVol = await mkProduct("PROPERTY_VOL", "CLASSIC", "Дом и квартира «Волга Гарант»", "Страхование жилья с франшизой на выбор", volga.id, "PROPERTY", propRules({ "0": 31, "5000": 26, "10000": 23 }));
  const eventCommon = { territories: ["RU-SPE"], customers: "Совершеннолетние физические лица", docs: ["Подтверждение оплаченного бронирования"], saleRule: `Покупка не позднее чем за ${DEMO_RULES.eventMinDaysBeforeStart} суток до начала`, disputeProcedure: "Возражение через карточку полиса, рассмотрение специалистом страховщика до 10 рабочих дней",
    missingDataRule: "Резервный источник, затем ручное рассмотрение; пропуск ≠ отсутствие события", correctionsRule: "Исправления источника принимаются до окончательного расчёта (72 часа); после выплаты — только через специалиста", authority: "Автоматическое одобрение при выполнении условия по финальным данным (демо-полномочия)" };
  const rain = await mkProduct("RAIN01", "EVENT", "Дождь на мероприятии", "Фиксированная выплата, если за часы мероприятия выпало не менее 5.0 мм осадков", sev.id, "RAIN01", { product: "RAIN01", premiumKop: 500_00, payoutKop: 5000_00, commissionBp: 1500 }, {
    ...eventCommon, exclusions: [{ code: "NO_BOOKING", title: "Нет оплаченного бронирования" }, { code: "CANCELLED", title: "Отменённое мероприятие" }],
    event: { metric: "PRECIP_MM", unit: "мм", aggregation: "SUM_GTE", thresholdX100: 500, intervalMinutes: 60, primary: { source: "DEMO_STATION_SPB_01", stationId: "SPB01", lat: 59.9386, lon: 30.3141 }, backup: { source: "DEMO_STATION_SPB_02", stationId: "SPB02", lat: 59.9711, lon: 30.3256 }, maxDistanceKm: 10, payoutKop: 5000_00, premiumKop: 500_00, conflictToleranceX100: 50, finalizationDelayHours: 2, ruleVersion: "RAIN01-demo-v1" } }, a3.id);
  const wind = await mkProduct("WIND01", "EVENT", "Недостаток ветра на парусном занятии", "Фиксированная выплата, если ветер был слабее 3.0 м/с минимум в трёх часах из четырёх", volga.id, "WIND01", { product: "WIND01", premiumKop: 300_00, payoutKop: 3000_00, commissionBp: 1500 }, {
    ...eventCommon, exclusions: [{ code: "NO_BOOKING", title: "Нет оплаченного занятия" }],
    event: { metric: "WIND_MS", unit: "м/с", aggregation: "COUNT_LT", thresholdX100: 300, minIntervals: 3, intervalMinutes: 60, primary: { source: "DEMO_WIND_01", stationId: "W01", lat: 59.9862, lon: 30.2135 }, backup: { source: "DEMO_WIND_02", stationId: "W02", lat: 59.955, lon: 30.19 }, maxDistanceKm: 10, payoutKop: 3000_00, premiumKop: 300_00, conflictToleranceX100: 50, finalizationDelayHours: 2, ruleVersion: "WIND01-demo-v1",
      measurement: "Средняя скорость за час на высоте 10 м (усреднение 10-минутных значений); порывы не учитываются" } }, a3.id);
  await db.product.create({ data: { code: "PROP-SUNHOTEL", kind: "EVENT", title: "Мало солнца в отеле (предложение агентства)", summary: "Направление развития каталога (P2): требует проверки данных о солнечном сиянии", carrierOrgId: sev.id, proposedByOrgId: a3.id, status: "SUBMITTED_TO_CARRIER", auctionAllowed: false, versions: { create: { version: 1, status: "DRAFT", terms: { productCode: "PROPOSAL_SUN", proposal: true, audience: "Туристы с бронированием отеля" } } } } });

  const mandate = (agencyOrgId: string, productId: string, carrierOrgId: string) => db.mandate.create({ data: { agencyOrgId, productId, carrierOrgId, validFrom: tariffFrom, validTo: yearAhead } });
  await mandate(a1.id, kSev.id, sev.id); await mandate(a1.id, pSev.id, sev.id);
  await mandate(a2.id, kVol.id, volga.id); await mandate(a2.id, pVol.id, volga.id);
  await mandate(a3.id, kSev.id, sev.id); await mandate(a3.id, rain.id, sev.id); await mandate(a3.id, wind.id, volga.id);
  await mandate(a4.id, kSev.id, sev.id); // полномочия есть, но агентство не проверено — подача заблокирована

  // ── Тарифы подписки и подписки ──
  const start = await db.plan.create({ data: { code: "START", title: "Старт", priceKop: 1990_00, maxUsers: 1, maxResponses: 50, features: { autoReply: false, analytics: false, roles: false, assistant: true } } });
  const pro = await db.plan.create({ data: { code: "PRO", title: "Про", priceKop: 5990_00, maxUsers: 2, maxResponses: 300, features: { autoReply: true, analytics: true, roles: false, assistant: true } } });
  const team = await db.plan.create({ data: { code: "TEAM", title: "Команда", priceKop: 14990_00, maxUsers: 5, maxResponses: 2000, features: { autoReply: true, analytics: true, roles: true, assistant: true } } });
  const day = 86400_000;
  const s1 = await db.subscription.create({ data: { organizationId: a1.id, planId: pro.id, status: "ACTIVE", periodStart: new Date(realNow.getTime() - 10 * day), periodEnd: new Date(realNow.getTime() + 20 * day), autoRenew: true, autoRenewConsentAt: new Date(realNow.getTime() - 40 * day) } });
  await db.subscriptionInvoice.create({ data: { subscriptionId: s1.id, organizationId: a1.id, planId: pro.id, periodStart: s1.periodStart, periodEnd: s1.periodEnd, amountKop: pro.priceKop, status: "PAID", paidAt: s1.periodStart, attempts: 1 } });
  await db.subscription.create({ data: { organizationId: a2.id, planId: team.id, status: "TRIAL", periodStart: new Date(realNow.getTime() - 3 * day), periodEnd: new Date(realNow.getTime() + 11 * day) } });
  const s3 = await db.subscription.create({ data: { organizationId: a3.id, planId: start.id, status: "GRACE", periodStart: new Date(realNow.getTime() - 32 * day), periodEnd: new Date(realNow.getTime() - 2 * day), graceUntil: new Date(realNow.getTime() + 5 * day) } });
  await db.subscriptionInvoice.create({ data: { subscriptionId: s3.id, organizationId: a3.id, planId: start.id, periodStart: s3.periodEnd, periodEnd: new Date(s3.periodEnd.getTime() + 30 * day), amountKop: start.priceKop, status: "FAILED", attempts: 1, nextRetryAt: new Date(realNow.getTime() + day) } });
  await db.setting.create({ data: { key: `saas_card:${a3.id}`, value: { behavior: "fail" } } });
  await db.subscription.create({ data: { organizationId: a4.id, planId: start.id, status: "TRIAL", periodStart: realNow, periodEnd: new Date(realNow.getTime() + 14 * day) } });
  await db.promo.create({ data: { code: "START2027", title: "Скидка 500 ₽ на первый месяц подписки", audience: "Новые агентства", fundingSource: "Маркетинговый бюджет платформы", budgetKop: 5000_00, discountKop: 500_00, maxUses: 10, validFrom: tariffFrom, validTo: tariffTo, ownerOrgId: platform.id } });
  await db.promo.create({ data: { code: "PREMIUM-PROMO", title: "Скидка на страховую премию (согласуемый сценарий)", appliesTo: "INSURANCE_PREMIUM", audience: "—", fundingSource: "Требует одобрения страховщика", budgetKop: 0, discountKop: 0, maxUses: 0, validFrom: tariffFrom, validTo: tariffTo, enabled: false } });

  await db.automationRule.create({ data: { organizationId: a1.id, mode: "CONFIRM", productCodes: ["KASKO"], territories: [], manualReasons: ["TAXI_OR_RENTAL", "INSPECTION_REQUIRED"] } });
  await db.automationRule.create({ data: { organizationId: a2.id, mode: "AUTO", productCodes: ["PROPERTY"], territories: [], manualReasons: ["RENT_OUT"] } });
  await db.automationRule.create({ data: { organizationId: a3.id, mode: "MANUAL", productCodes: [], territories: [] } });
  await db.setting.create({ data: { key: "emulators", value: EMU_DEFAULTS as any } });
  await db.setting.create({ data: { key: "feature_flags", value: { showCompetitorMinPrice: false, insurancePremiumPromo: false, clientPaymentFee: false } } });

  await db.savedObject.create({ data: { clientId: anna.id, kind: "CAR", title: "Kia K5, 2022", confirmedAt: realNow, data: { car_make: "Kia", car_model: "K5", car_year: 2022, car_value_rub: 2400000, car_vin: "XWEG4417BN0001234", usage: "PERSONAL", owner_name: "Смирнова Анна Викторовна" } } });
  await db.savedObject.create({ data: { clientId: anna.id, kind: "PROPERTY", title: "Квартира, Санкт-Петербург", confirmedAt: realNow, data: { city: "Санкт-Петербург", address: "ул. Демонстрационная, д. 1, кв. 10", property_type: "APARTMENT", area_m2: 64, construction: "MONOLITH", year_built: 2015, usage: "OWN" } } });
  const fx = await buildFixtures();
  log("Справочные данные созданы");
  if (opts.scenarioData === false) return { anna, igor };

  // ── Сделки через реальные доменные операции ──
  const cAnna = await ctxFor("anna@client.test"), cIgor = await ctxFor("igor@client.test");
  const ag1 = await ctxFor("agent@nadezhny.test"), ag2 = await ctxFor("agent1@most.test"), ag3 = await ctxFor("owner@parus.test", "Парус и погода");
  const repSev = await ctxFor("rep@severshield.test"), repVol = await ctxFor("rep@volgagarant.test");
  const q = (c: Ctx) => ({ orgId: c.org!.orgId, userId: c.user.id, correlationId: "seed", role: "AGENT" });

  const kaskoData = (o: any = {}) => ({ car_make: "Kia", car_model: "K5", car_year: 2022, car_value_rub: 2400000, car_vin: "XWEG4417BN0001234", usage: "PERSONAL", owner_name: "Смирнова Анна Викторовна", drivers_count: 1, min_driver_age: 35, min_experience: 12, claims_3y: 0, risks: ["DAMAGE", "THEFT"], territory: "RU", deductible_rub: "15000", allow_alt_deductible: true, repair_method: "SERVICE", start_date: "", region: "RU-SPE", ...o });
  const propData = (o: any = {}) => ({ city: "Санкт-Петербург", address: "ул. Демонстрационная, д. 1, кв. 10", property_type: "APARTMENT", area_m2: 64, construction: "MONOLITH", year_built: 2015, usage: "OWN", cover_objects: ["STRUCTURE", "FINISH", "CONTENTS", "LIABILITY"], value_rub: 5000000, risks: ["FIRE", "WATER"], deductible_rub: "5000", allow_alt_deductible: false, start_date: "", ...o });
  const tomorrow = async (days = 1) => new Date((await now()).getTime() + days * day).toISOString().slice(0, 10);

  async function fill(ctx: Ctx, productCode: string, data: Record<string, any>, publish = true) {
    const r = await createRequest(ctx, { productCode, freeText: "Создано демо-сидом" });
    let cur = await saveDraft(ctx, r.id, { data, version: r.version });
    const keys = allFields(schemaFor(productCode)).filter((f) => f.keyField && data[f.key] !== undefined && data[f.key] !== "").map((f) => f.key);
    const conf = await confirmFields(ctx, r.id, keys, cur.request.version);
    if (!publish) return conf;
    const pub = await publishRequest(ctx, r.id, conf.version);
    if (!pub.published) throw new Error(`seed publish failed ${JSON.stringify(pub)}`);
    return db.insuranceRequest.findUniqueOrThrow({ where: { id: r.id } });
  }
  async function purchase(ctx: Ctx, requestId: string, quoteId?: string, outcome: "success" | "none" = "success") {
    await db.rateLimit.deleteMany(); // сид выполняет много операций подряд от одного пользователя
    const offers = await offersForClient(ctx, requestId);
    const all = offers.groups.flatMap((g) => g.offers);
    const chosen = quoteId ? all.find((o) => o.id === quoteId)! : all[0];
    const r = await db.insuranceRequest.findUniqueOrThrow({ where: { id: requestId } });
    const sel = await selectQuote(ctx, { requestId, requestVersion: r.currentVersion, quoteId: chosen.id, quoteVersion: chosen.seq });
    await prepareDocuments(ctx, sel.checkout_id);
    const docs = await db.document.findMany({ where: { checkoutId: sel.checkout_id, supersededById: null } });
    for (const d of docs) await acknowledge(ctx, sel.checkout_id, d.id);
    await requestCode(ctx, sel.checkout_id);
    const mail = await db.demoMail.findFirstOrThrow({ where: { userId: ctx.user.id, subject: { contains: "код" } }, orderBy: { createdAt: "desc" } });
    const code = mail.body.match(/Код: (\d{6})/)![1];
    const v = await verifyCode(ctx, sel.checkout_id, code);
    if (!v.ok) throw new Error("seed verify failed");
    if (outcome === "none") return { checkoutId: sel.checkout_id };
    const pay = await createPremiumPayment(ctx, sel.checkout_id, `seed-${sel.checkout_id}`);
    await emulatorPayerAction(pay.confirmationUrl.split("/").pop()!, "success");
    await drainJobs();
    return { checkoutId: sel.checkout_id, policy: await db.policy.findUnique({ where: { checkoutId: sel.checkout_id } }) };
  }
  const kSevId = kSev.id, kVolId = kVol.id, pSevId = pSev.id, pVolId = pVol.id;
  const quoteK = async (c: Ctx, rId: string, productId: string, premiumRub: number, ded?: number) => { const r = await db.insuranceRequest.findUniqueOrThrow({ where: { id: rId } }); return submitQuote(q(c), { requestId: rId, requestVersion: r.currentVersion, productId, premiumKop: premiumRub * 100, deductibleRub: ded, publish: true }); };

  // Прошлые периоды (DemoClock в прошлом): полисы, которые уже действуют/заканчиваются, и прошедшие события.
  await setNow(D("2025-11-20T09:00:00Z"));
  const rOld = await fill(cIgor, "PROPERTY", propData({ address: "пр. Тестовый, д. 5, кв. 3", value_rub: 4000000, start_date: await tomorrow(10) }));
  await drainJobs();
  await quoteK(ag1, rOld.id, pSevId, 8000);
  const oldBuy = await purchase(cIgor, rOld.id);
  const rOld2 = await fill(cIgor, "KASKO", kaskoData({ car_make: "Skoda", car_model: "Octavia", car_year: 2019, car_value_rub: 1500000, car_vin: "TMBJJ7NE0K0001234", owner_name: "Петров Игорь Сергеевич", deductible_rub: "30000", start_date: await tomorrow(2) }));
  await quoteK(ag2, rOld2.id, kVolId, 52000);
  await purchase(cIgor, rOld2.id);
  log("Исторические полисы 2025 года созданы");

  await setNow(D("2026-05-20T09:00:00Z"));
  const eventData = (o: any) => ({ booking_vendor: "Летний сад, шатёр №3", purchase_date: "2026-05-19", booking_cost_rub: 45000, latitude: 59.9386, longitude: 30.3141, timezone: "Europe/Moscow", start_time: "14:00", end_time: "20:00", ...o });
  const rRainPast = await fill(cAnna, "RAIN01", eventData({ booking_ref: "SPB-VENUE-2026-0619-11", event_date: "2026-06-19" }));
  const rainPast = await purchase(cAnna, rRainPast.id);
  const rWindPast = await fill(cIgor, "WIND01", eventData({ booking_ref: "SAIL-2026-0620-05", booking_vendor: "Парусная школа «Бриз»", booking_cost_rub: 7000, event_date: "2026-06-20", start_time: "11:00", end_time: "15:00", latitude: 59.9862, longitude: 30.2135 }));
  const windPast = await purchase(cIgor, rWindPast.id);
  await setNow(D("2026-06-20T15:00:00Z"));
  await setEmu({ weather: { RAIN01: "r52", WIND01: "w_missing", unavailable: [] } });
  await runEventCheck(rainPast.policy!.id); await drainJobs();
  await runEventCheck(windPast.policy!.id); await drainJobs();
  await setEmu({ weather: { RAIN01: "r52", WIND01: "w_met", unavailable: [] } });
  log("Прошедшие события 2026: RAIN01 выплачен, WIND01 — в очереди исключений");

  await setNow(D("2026-09-01T09:00:00Z"));
  const rTerm = await fill(cAnna, "PROPERTY", propData({ city: "Москва", address: "ул. Учебная, д. 7, кв. 2", value_rub: 3000000, start_date: await tomorrow(3) }));
  await quoteK(ag2, rTerm.id, pVolId, 6000);
  await drainJobs();
  const term = await purchase(cAnna, rTerm.id);
  await setNow(D("2026-09-08T09:00:00Z"));
  await terminatePolicy(cAnna, term.policy!.id, { reason: "Продала квартиру", confirm: true });
  await drainJobs();
  log("Прекращённый полис с возвратом и сторно создан");

  // Текущее время.
  await resetClock();
  const rP = await fill(cAnna, "PROPERTY", propData({ start_date: await tomorrow(5) }));
  await drainJobs(); // автоответ «Моста» (AUTO для квартир)
  await quoteK(ag1, rP.id, pSevId, 10000);
  const offersP = await offersForClient(cAnna, rP.id);
  const ag1Offer = offersP.groups.flatMap((g) => g.offers).find((o) => o.agency?.name === "Надёжный курс")!;
  const propBuy = await purchase(cAnna, rP.id, ag1Offer.id);
  const rK = await fill(cAnna, "KASKO", kaskoData({ start_date: await tomorrow(1) }));
  await drainJobs(); // «Надёжный курс» — черновик в режиме с подтверждением
  await quoteK(ag2, rK.id, kVolId, 84500);
  await quoteK(ag3, rK.id, kSevId, 74000, 30000);
  await quoteK(ag1, rK.id, kSevId, 85000);
  const offersK = await offersForClient(cAnna, rK.id);
  const kBuy = await purchase(cAnna, rK.id, offersK.groups.flatMap((g) => g.offers).find((o) => o.agency?.name === "Надёжный курс")!.id);
  const rRain = await fill(cAnna, "RAIN01", eventData({ booking_ref: "SPB-VENUE-2027-0619-77", purchase_date: "2026-11-01", event_date: "2027-06-19" }));
  const rainBuy = await purchase(cAnna, rRain.id);
  const rWind = await fill(cIgor, "WIND01", eventData({ booking_ref: "SAIL-2027-0620-12", booking_vendor: "Парусная школа «Бриз»", booking_cost_rub: 7000, purchase_date: "2026-11-01", event_date: "2027-06-20", start_time: "11:00", end_time: "15:00", latitude: 59.9862, longitude: 30.2135 }));
  const windBuy = await purchase(cIgor, rWind.id);
  log("Текущие полисы созданы");

  // Заявки в разных состояниях.
  const rDraft = await createRequest(cAnna, { productCode: "KASKO", freeText: "Хочу каско на новую машину, пока не знаю цену" });
  await saveDraft(cAnna, rDraft.id, { data: { car_make: "Haval", car_model: "Jolion", car_year: 2025 }, version: rDraft.version });
  const rNeeds = await createRequest(cIgor, { productCode: "PROPERTY", freeText: "Дача под Выборгом" });
  const nd = await saveDraft(cIgor, rNeeds.id, { data: { city: "Выборг", property_type: "HOUSE", construction: "WOOD", area_m2: 90 }, version: rNeeds.version });
  await publishRequest(cIgor, rNeeds.id, nd.request.version);
  const rOpen = await fill(cIgor, "KASKO", kaskoData({ car_make: "Toyota", car_model: "Camry", car_year: 2021, car_value_rub: 2900000, car_vin: "XW7BF4FK00S123456", owner_name: "Петров Игорь Сергеевич", start_date: await tomorrow(7) }));
  await drainJobs();
  await quoteK(ag2, rOpen.id, kVolId, 103000);
  await quoteK(ag3, rOpen.id, kSevId, 95000, 30000);
  const rSel = await fill(cIgor, "PROPERTY", propData({ city: "Санкт-Петербург", address: "ул. Примерная, д. 2, кв. 40", value_rub: 6000000, start_date: await tomorrow(14) }));
  await drainJobs();
  await quoteK(ag1, rSel.id, pSevId, 12000);
  await db.auction.updateMany({ where: { requestId: rSel.id }, data: { closesAt: new Date(Date.now() - 1000) } });
  const auSel = await db.auction.findFirstOrThrow({ where: { requestId: rSel.id } });
  await closeAuctionJob(auSel.id);
  const rCheckout = await fill(cAnna, "KASKO", kaskoData({ car_make: "Kia", car_model: "Sportage", car_year: 2023, car_value_rub: 3200000, car_vin: "XWEPH81ADP0012345", start_date: await tomorrow(3), deductible_rub: "0", allow_alt_deductible: false }));
  await quoteK(ag1, rCheckout.id, kSevId, 140000);
  await purchase(cAnna, rCheckout.id, undefined, "none");
  const rCancel = await fill(cAnna, "KASKO", kaskoData({ car_make: "Lada", car_model: "Vesta", car_year: 2020, car_value_rub: 900000, car_vin: "XTAGFL110LY123456", start_date: await tomorrow(3) }));
  const { cancelRequest } = await import("../domain/requests");
  await cancelRequest(cAnna, rCancel.id);
  log("Заявки в разных состояниях созданы");

  // Обращения.
  const c1 = await createClassicClaim(cIgor, oldBuy.policy!.id, { eventDate: "2026-03-14", description: "Залив от соседей сверху, повреждён потолок в кухне", answers: { source: "Соседи сверху", emergency: "нет" } });
  await submitClaim(cIgor, c1.id);
  await staffClaimAction(repSev, c1.id, "START_REVIEW", { note: "Принято в работу" });
  await staffClaimAction(repSev, c1.id, "PREPARE_APPROVE", { note: "Ущерб подтверждён актом УК" });
  await staffClaimAction(repSev, c1.id, "APPROVE", { note: "Выплата по смете", amountKop: 38000_00 });
  await drainJobs();
  const c2 = await createClassicClaim(cIgor, oldBuy.policy!.id, { eventDate: "2026-08-02", description: "Трещина на стекле балкона", answers: {} });
  await submitClaim(cIgor, c2.id);
  await staffClaimAction(repSev, c2.id, "START_REVIEW", {});
  await staffClaimAction(repSev, c2.id, "PREPARE_REJECT", { note: "Остекление балкона не входит в застрахованные объекты по п. 6.1 правил" });
  await staffClaimAction(repSev, c2.id, "REJECT", { note: "Остекление балкона не входит в застрахованные объекты по п. 6.1 правил" });
  await setNow(new Date(Date.now() + 3 * day));
  const c3 = await createClassicClaim(cAnna, kBuy.policy!.id, { eventDate: (await now()).toISOString().slice(0, 10), description: "Царапина на двери после парковки у ТЦ", answers: { otherParty: "неизвестен" } });
  await submitClaim(cAnna, c3.id);
  await staffClaimAction(ag1, c3.id, "REQUEST_INFO", { note: "Пожалуйста, приложите фото повреждения и справку из полиции" });
  const c4 = await createClassicClaim(cAnna, kBuy.policy!.id, { eventDate: (await now()).toISOString().slice(0, 10), description: "Скол на лобовом стекле", answers: {} });
  await resetClock();
  log("Обращения созданы");

  // Переписка.
  const deal = await db.checkout.findFirstOrThrow({ where: { id: kBuy.checkoutId } });
  const conv = await ensureConversation(db, { contextType: "CHECKOUT", contextId: deal.id, clientId: anna.id, agencyOrgId: deal.agencyOrgId, title: "Сделка: Каско" });
  await sendMessage(cAnna, conv.id, "Здравствуйте! Подскажите, нужен ли осмотр автомобиля?");
  await sendMessage(ag1, conv.id, "Добрый день, Анна! Для вашего автомобиля осмотр не требуется — стоимость ниже 3 млн ₽.");
  await sendMessage(cAnna, conv.id, "Что входит в исключения по договору?", { askAssistant: true });
  const pconv = await db.conversation.findFirstOrThrow({ where: { contextType: "CHECKOUT", contextId: propBuy.checkoutId } });
  await sendMessage(cAnna, pconv.id, "Спасибо, документы получила.");
  await upsertReview(cAnna, { policyId: propBuy.policy!.id, stage: "SALE", rating: 5, text: "Быстро ответили и понятно объяснили условия." });
  await upsertReview(cIgor, { policyId: oldBuy.policy!.id, stage: "SALE", rating: 3, text: "Оформили, но ответа в чате ждал долго." });
  await db.notification.create({ data: { userId: anna.id, type: "marketing.digest", category: "MARKETING", title: "Подборка: защита для летних мероприятий", body: "Рекламное сообщение (отправлено, т.к. есть согласие на маркетинг)." } });
  await db.session.deleteMany({ where: { isDemoSwitch: true, expiresAt: { lt: new Date(Date.now() + 2 * 3600_000) } } });
  log("Сид завершён");
  return { anna, igor, c4: c4.id, rDraft: rDraft.id, fx: Object.keys(fx) };
}

export async function resetDemo(log?: (s: string) => void) {
  await truncateAll();
  return seed({ log });
}

export { totpNow };
