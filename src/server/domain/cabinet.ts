/**
 * Единый страховой кабинет клиента (дополнение ТЗ от 16.11.2026, разделы 5, 5.1):
 * полисы, оформленные вне платформы, проверка рынка по действующему полису,
 * страховой случай как отдельный вход — свободным текстом.
 */
import { db } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, type Ctx } from "../access";
import { now } from "../clock";
import { notify } from "./notify";
import { CATEGORIES, categoryOf, parseDate } from "./crm";
import { createRequest } from "./requests";
import { REQUIRED_DOCS } from "./claims";

const DAY = 86400_000;

export type ExternalPolicyInput = { category: string; insurerName: string; number?: string | null; objectTitle: string; startsAt?: string | null; endsAt: string; premiumKop?: number | null };

/** Полис, оформленный вне платформы. Источник — клиент, статус проверки — «не проверен»; начислений не создаёт. */
export async function addExternalPolicy(ctx: Ctx, i: ExternalPolicyInput) {
  const startsAt = i.startsAt ? parseDate(i.startsAt) : null, endsAt = parseDate(i.endsAt);
  if (!endsAt) throw err("VALIDATION", "Дата окончания не распознана", { fields: [{ path: "endsAt", message: "ГГГГ-ММ-ДД" }] });
  if (i.startsAt && !startsAt) throw err("VALIDATION", "Дата начала не распознана", { fields: [{ path: "startsAt", message: "ГГГГ-ММ-ДД" }] });
  if (startsAt && endsAt <= startsAt) throw err("VALIDATION", "Окончание раньше начала", { fields: [{ path: "endsAt", message: "Позже даты начала" }] });
  const p = await db.externalPolicy.create({ data: { clientId: ctx.user.id, source: "CLIENT_MANUAL", verification: "UNVERIFIED", category: categoryOf(i.category), insurerName: i.insurerName.trim(), number: i.number?.trim() || null, objectTitle: i.objectTitle.trim(), startsAt, endsAt, premiumKop: i.premiumKop ?? null } });
  await audit(db, actor(ctx), "external_policy.add", "ExternalPolicy", p.id, { after: { category: p.category, source: p.source } });
  return p;
}

export async function archiveExternalPolicy(ctx: Ctx, id: string) {
  const r = await db.externalPolicy.updateMany({ where: { id, clientId: ctx.user.id, archivedAt: null }, data: { archivedAt: await now() } });
  if (!r.count) throw err("NOT_FOUND", "Полис не найден");
  await audit(db, actor(ctx), "external_policy.archive", "ExternalPolicy", id);
  return { ok: true };
}

export function externalPolicies(ctx: Ctx) {
  return db.externalPolicy.findMany({ where: { clientId: ctx.user.id, archivedAt: null }, orderBy: { endsAt: "asc" } });
}

const MARKET_PRODUCT: Record<string, string> = { KASKO: "KASKO", PROPERTY: "PROPERTY" };

/**
 * «Сравнить с рынком» по полису вне платформы: новая независимая заявка всем подходящим агентствам.
 * Агентство, передавшее полис, может участвовать на равных, но не получает заявку эксклюзивно.
 */
export async function marketCheck(ctx: Ctx, externalPolicyId: string) {
  const p = await db.externalPolicy.findFirst({ where: { id: externalPolicyId, clientId: ctx.user.id } });
  if (!p) throw err("NOT_FOUND", "Полис не найден");
  const productCode = MARKET_PRODUCT[p.category];
  if (!productCode) throw err("VALIDATION", `Подбор по категории «${CATEGORIES[p.category] ?? p.category}» пока недоступен: в первой версии — каско и квартира/дом`);
  const r = await createRequest(ctx, { productCode, freeText: `Проверка рынка: полис ${p.insurerName}${p.number ? ` № ${p.number}` : ""}, ${p.objectTitle}`, sourceDetail: `market-check:external:${p.id}` });
  if (p.endsAt) await db.insuranceRequest.update({ where: { id: r.id }, data: { data: { start_date: p.endsAt.toISOString().slice(0, 10) } as any } });
  await audit(db, actor(ctx), "external_policy.market_check", "ExternalPolicy", p.id, { after: { requestId: r.id } });
  return r;
}

/** Напоминания об окончании полисов вне платформы (сервисные). */
export async function tickExternalPolicies() {
  const t = await now();
  const soon = await db.externalPolicy.findMany({ where: { archivedAt: null, reminderSentAt: null, endsAt: { gt: t, lte: new Date(t.getTime() + 30 * DAY) } } });
  for (const p of soon) {
    await db.$transaction(async (tx) => {
      await notify(tx, p.clientId, { type: "external_policy.ending", title: "Полис скоро закончится", body: `${CATEGORIES[p.category] ?? p.category}, ${p.insurerName}: действует до ${p.endsAt!.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}. Можно продлить у прежнего агента или сравнить предложения на рынке.`, link: "/c/policies", dedupeKey: `ext-ending:${p.id}` });
      await tx.externalPolicy.update({ where: { id: p.id }, data: { reminderSentAt: t } });
    });
  }
  return { reminded: soon.length };
}

// ───────────── Страховой случай свободным текстом ─────────────

export { looksLikeIncident } from "@/lib/intent";

export function incidentCategory(text: string): "PROPERTY" | "KASKO" | "EVENT" | null {
  const t = text.toLowerCase();
  if (/(дтп|авари|машин|авто|угон|угнал|врезал|столкн|парков|стекл|капот|бампер|дверь машины)/.test(t)) return "KASKO";
  if (/(затоп|залил|залив|протеч|сосед|квартир|дом|пожар|возгоран|потолок|ремонт|труб)/.test(t)) return "PROPERTY";
  if (/(дожд|ветер|ветр|мероприят|свадьб|регат)/.test(t)) return "EVENT";
  return null;
}

const FIRST_STEPS: Record<string, string[]> = {
  PROPERTY: [
    "Если есть угроза жизни, пожар или риск поражения током — позвоните 112.",
    "Перекройте воду или электричество в повреждённой зоне, если это безопасно.",
    "Сообщите в управляющую компанию и попросите составить акт о заливе с указанием причины.",
    "Не выбрасывайте повреждённые вещи и не начинайте ремонт до осмотра или фотофиксации.",
  ],
  KASKO: [
    "Если есть пострадавшие — позвоните 112. Включите аварийную сигнализацию и выставьте знак.",
    "Не перемещайте автомобиль до фотофиксации, если это не создаёт опасности.",
    "Оформите европротокол или вызовите ГИБДД — в зависимости от обстоятельств.",
    "При угоне сразу обратитесь в полицию и сохраните талон-уведомление.",
  ],
  EVENT: ["По событийным полисам проверка условия идёт автоматически по данным метеостанций; обращение создаётся само, если условие выполнено."],
  GENERIC: ["Если есть угроза жизни или здоровью — позвоните 112.", "Сфотографируйте повреждения и сохраните документы о происшествии."],
};
const EVIDENCE: Record<string, string[]> = {
  PROPERTY: [...REQUIRED_DOCS.PROPERTY, "Фото источника протечки или очага", "Контакты соседей или виновника, если известен", "Чеки на повреждённое имущество, если есть"],
  KASKO: [...REQUIRED_DOCS.KASKO, "Фото места происшествия с общим планом", "Данные второго участника, если есть"],
  EVENT: [],
  GENERIC: ["Фото повреждений", "Документы о происшествии"],
};

/**
 * Разбор сообщения о страховом случае (ИИ-эмулятор, детерминированно).
 * Находит потенциально подходящие действующие полисы, даёт безопасный чек-лист, перечень доказательств и контакт.
 * Не обещает покрытие или выплату: решение принимает страховщик по условиям договора.
 */
export async function triageIncident(ctx: Ctx, text: string) {
  const t = await now();
  const cat = incidentCategory(text);
  const productCodes = cat === "KASKO" ? ["KASKO"] : cat === "PROPERTY" ? ["PROPERTY"] : cat === "EVENT" ? ["RAIN01", "WIND01"] : ["KASKO", "PROPERTY"];
  const policies = await db.policy.findMany({ where: { clientId: ctx.user.id, contractStatus: "CONCLUDED", productCode: { in: productCodes }, endsAt: { gte: new Date(t.getTime() - 7 * DAY) } } });
  const orgs = await db.organization.findMany({ where: { id: { in: [...policies.flatMap((p) => [p.agencyOrgId, p.carrierOrgId])].filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const orgName = (id: string | null) => orgs.find((o) => o.id === id)?.name ?? null;
  const ext = await db.externalPolicy.findMany({ where: { clientId: ctx.user.id, archivedAt: null, category: cat === "EVENT" ? "EVENT" : cat ?? { in: ["KASKO", "PROPERTY", "OSAGO"] }, OR: [{ endsAt: null }, { endsAt: { gte: new Date(t.getTime() - 7 * DAY) } }] } });
  const key = cat ?? "GENERIC";
  const candidates = [
    ...policies.map((p) => ({ kind: "PLATFORM" as const, id: p.id, title: `${p.objectTitle} · полис ${p.number}`, insurer: orgName(p.carrierOrgId), agency: orgName(p.agencyOrgId), endsAt: p.endsAt, canCreateClaim: !["RAIN01", "WIND01"].includes(p.productCode) && p.startsAt <= t, why: p.startsAt > t ? `Защита начинается ${p.startsAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}: событие до этой даты договором не покрывается` : `Вид страхования совпадает с описанием; полис действует до ${p.endsAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}` })),
    ...ext.map((p) => ({ kind: "EXTERNAL" as const, id: p.id, title: `${p.objectTitle}${p.number ? ` · полис ${p.number}` : ""}`, insurer: p.insurerName, agency: null as string | null, endsAt: p.endsAt, canCreateClaim: false, why: `${CATEGORIES[p.category] ?? p.category}: полис добавлен ${p.source === "AGENT_CRM" ? "со слов агента" : "вами"}, условия платформа не проверяла` })),
  ];
  await audit(db, actor(ctx), "incident.triage", "User", ctx.user.id, { after: { category: cat, candidates: candidates.length } });
  return {
    category: cat,
    candidates,
    firstSteps: FIRST_STEPS[key],
    evidence: EVIDENCE[key],
    deadlines: "Срок уведомления страховщика указан в правилах страхования вашего полиса. Сообщите о случае как можно раньше: опоздание может осложнить рассмотрение.",
    nextStep: candidates.some((c) => c.canCreateClaim)
      ? "Выберите полис и создайте обращение — агентство и страховщик увидят его в одном окне с перепиской и документами."
      : candidates.length ? "Полис оформлен вне платформы: сообщите о случае страховщику по контактам из договора. Здесь сохраните фото и документы, чтобы ничего не потерять." : "Подходящих действующих полисов не найдено. Если полис есть, добавьте его в разделе «Полисы» или обратитесь к страховщику напрямую.",
    disclaimer: "Это подсказка, а не решение о выплате. Покрытие и размер выплаты определяет страховщик по условиям договора после проверки документов. Можно задать вопрос человеку: агенту в чате обращения или в поддержку.",
  };
}
