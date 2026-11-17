/**
 * CRM агентства (дополнение ТЗ от 16.11.2026, разделы 6, 9, 10).
 *
 * Принципы:
 * * CrmContact ≠ User. Карточка существует без аккаунта; от имени контакта аккаунт не создаётся.
 * * Tenant isolation: каждый запрос — с organizationId текущего агентства; агент (не владелец) видит
 *   только карточки, где он ответственный, и неназначенные.
 * * Приглашение — персональная ссылка и подготовленный текст; агент отправляет его сам (WhatsApp/Telegram/почта).
 *   Платформа ничего не рассылает автоматически.
 * * Связывание с аккаунтом — только действием клиента и при совпадении подтверждённого канала связи;
 *   при совпадении по телефону/почте нет автоматического слияния.
 * * Внутренние заметки и история взаимодействий агентства никогда не попадают клиенту и другим агентствам.
 */
import { randomUUID } from "node:crypto";
import { db, txRetry, type Tx } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, machineRole, type Ctx } from "../access";
import { now } from "../clock";
import { assertTransition } from "../state/machines";
import { DEMO_RULES } from "../config";
import { randomToken, sha256 } from "../auth/crypto";
import { notify, notifyOrg } from "./notify";
import { rateLimit } from "../auth/ratelimit";

type AgencyCtx = Ctx & { orgId: string; role: string };
const DAY = 86400_000;

export const LEGAL_BASES = {
  EXISTING_CONTRACT: "Действующий или прежний договор с клиентом",
  CLIENT_CONSENT: "Согласие клиента на обработку данных агентством",
  OTHER_DOCUMENTED: "Иное документированное основание",
} as const;
export type LegalBasis = keyof typeof LEGAL_BASES;

export const CATEGORIES: Record<string, string> = { KASKO: "Каско", OSAGO: "ОСАГО", PROPERTY: "Квартира или дом", TRAVEL: "Путешествие", HEALTH: "Здоровье", EVENT: "Мероприятие", OTHER: "Другое" };
export const CHANNELS = { WHATSAPP: "WhatsApp", TELEGRAM: "Telegram", EMAIL: "Почта", SMS: "SMS", PHONE: "Звонок", OTHER: "Другое" } as const;

// ───────────── Нормализация и разбор ─────────────

/** Телефон → E.164 для России (+7XXXXXXXXXX) или «+цифры»; null, если похоже не на телефон. */
export function normPhone(v: string | null | undefined): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  if (d.length < 10 || d.length > 15) return null;
  return "+" + d;
}
export function normEmail(v: string | null | undefined): string | null {
  if (!v) return null;
  const e = v.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
export function categoryOf(v: string | null | undefined): string {
  const t = (v ?? "").toLowerCase();
  if (/каско|kasko/.test(t)) return "KASKO";
  if (/осаго|osago/.test(t)) return "OSAGO";
  if (/кварт|дом|имущ|property|недвиж/.test(t)) return "PROPERTY";
  if (/путеш|travel|выезд/.test(t)) return "TRAVEL";
  if (/дмс|здоров|health|медиц/.test(t)) return "HEALTH";
  if (/мероп|свадьб|event|дожд/.test(t)) return "EVENT";
  return CATEGORIES[v?.toUpperCase() ?? ""] ? v!.toUpperCase() : "OTHER";
}
/** Дата из «ГГГГ-ММ-ДД» или «ДД.ММ.ГГГГ» (полдень по Москве, чтобы не съезжал день). */
export function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) { const r = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/); if (r) m = [r[0], r[3], r[2], r[1]] as any; }
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+03:00`);
  return isNaN(d.getTime()) ? null : d;
}
/** Рубли строкой («12 500», «12500,50») → копейки целым числом, без float. */
export function rubToKop(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = v.replace(/[\s ₽]|руб\.?/g, "").match(/^(\d{1,9})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
}

/** CSV (RFC 4180): кавычки, экранирование "", разделитель ; , или табуляция — определяется по заголовку. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const head = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].map((d) => [d, head.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "имя", "фио", "клиент"],
  phone: ["phone", "телефон", "тел", "мобильный"],
  email: ["email", "e-mail", "почта", "эл. почта", "электронная почта"],
  category: ["category", "вид", "вид страхования", "категория", "продукт"],
  insurer: ["insurer", "страховщик", "страховая", "страховая компания"],
  policyNumber: ["policy", "policy_number", "полис", "номер полиса"],
  object: ["object", "объект", "объект страхования"],
  startsAt: ["starts_at", "start", "начало", "дата начала"],
  endsAt: ["ends_at", "end", "окончание", "дата окончания", "действует до"],
  premium: ["premium", "премия", "премия, руб", "премия руб"],
  note: ["note", "notes", "заметка", "примечание", "комментарий"],
  responsible: ["responsible", "ответственный"],
};
function mapHeader(h: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  h.forEach((raw, i) => {
    const k = raw.trim().toLowerCase();
    for (const [field, al] of Object.entries(HEADER_ALIASES)) if (al.includes(k) && out[field] === undefined) out[field] = i;
  });
  return out;
}

// ───────────── Доступ ─────────────

/** Условие видимости карточек: владелец видит все карточки агентства, агент — свои и неназначенные. */
export function contactScope(ctx: AgencyCtx) {
  return ctx.role === "AGENCY_OWNER" ? { organizationId: ctx.orgId } : { organizationId: ctx.orgId, OR: [{ responsibleUserId: ctx.user.id }, { responsibleUserId: null }] };
}
export async function getContactForAgency(tx: Tx | typeof db, ctx: AgencyCtx, id: string) {
  const c = await tx.crmContact.findFirst({ where: { id, ...contactScope(ctx) } });
  if (!c) throw err("NOT_FOUND", "Контакт не найден");
  return c;
}
async function assertMember(tx: Tx | typeof db, orgId: string, userId: string | null | undefined) {
  if (!userId) return;
  const m = await tx.membership.findFirst({ where: { organizationId: orgId, userId, status: "ACTIVE" } });
  if (!m) throw err("VALIDATION", "Ответственный не состоит в агентстве", { fields: [{ path: "responsibleUserId", message: "Выберите сотрудника агентства" }] });
}
const role = (ctx: Ctx) => machineRole(ctx);

// ───────────── Контакты ─────────────

export type ContactInput = { name: string; phone?: string | null; email?: string | null; legalBasis: LegalBasis; notes?: string | null; responsibleUserId?: string | null };

export async function createContact(ctx: AgencyCtx, i: ContactInput) {
  const phoneNorm = normPhone(i.phone), emailNorm = normEmail(i.email);
  if (i.phone && !phoneNorm) throw err("VALIDATION", "Телефон не распознан", { fields: [{ path: "phone", message: "Например, +7 900 000-00-00" }] });
  if (i.email && !emailNorm) throw err("VALIDATION", "Email не распознан", { fields: [{ path: "email", message: "Проверьте адрес" }] });
  await assertMember(db, ctx.orgId, i.responsibleUserId);
  const dup = await findDuplicate(db, ctx.orgId, phoneNorm, emailNorm);
  if (dup) throw err("CONFLICT", "В CRM агентства уже есть контакт с таким телефоном или email", { contactId: dup.id });
  return db.$transaction(async (tx) => {
    const c = await tx.crmContact.create({ data: { organizationId: ctx.orgId, name: i.name.trim(), phone: i.phone?.trim() || null, email: i.email?.trim() || null, phoneNorm, emailNorm, legalBasis: i.legalBasis, notes: i.notes?.trim() || null, responsibleUserId: i.responsibleUserId ?? (ctx.role === "AGENCY_OWNER" ? null : ctx.user.id), provenance: "MANUAL" } });
    await tx.crmInteraction.create({ data: { organizationId: ctx.orgId, contactId: c.id, authorUserId: ctx.user.id, kind: "SYSTEM", text: "Карточка создана вручную" } });
    await audit(tx, actor(ctx), "crm.contact_create", "CrmContact", c.id, { after: { provenance: "MANUAL", legalBasis: i.legalBasis } });
    return c;
  });
}

async function findDuplicate(tx: Tx | typeof db, orgId: string, phoneNorm: string | null, emailNorm: string | null) {
  const or = [...(phoneNorm ? [{ phoneNorm }] : []), ...(emailNorm ? [{ emailNorm }] : [])];
  if (!or.length) return null;
  return tx.crmContact.findFirst({ where: { organizationId: orgId, OR: or } });
}

export async function updateContact(ctx: AgencyCtx, id: string, i: Partial<ContactInput> & { version: number }) {
  return txRetry(async (tx) => {
    const c = await getContactForAgency(tx, ctx, id);
    if (c.version !== i.version) throw err("VERSION_CHANGED", "Карточку изменили — обновите страницу");
    const data: Record<string, unknown> = {};
    if (i.name !== undefined) data.name = i.name.trim();
    if (i.notes !== undefined) data.notes = i.notes?.trim() || null;
    if (i.legalBasis !== undefined) data.legalBasis = i.legalBasis;
    if (i.responsibleUserId !== undefined) {
      if (ctx.role !== "AGENCY_OWNER") throw err("FORBIDDEN", "Ответственного назначает владелец агентства");
      await assertMember(tx, ctx.orgId, i.responsibleUserId);
      data.responsibleUserId = i.responsibleUserId;
    }
    if (i.phone !== undefined) { const n = normPhone(i.phone); if (i.phone && !n) throw err("VALIDATION", "Телефон не распознан"); data.phone = i.phone || null; data.phoneNorm = n; }
    if (i.email !== undefined) { const n = normEmail(i.email); if (i.email && !n) throw err("VALIDATION", "Email не распознан"); data.email = i.email || null; data.emailNorm = n; }
    const upd = await tx.crmContact.update({ where: { id: c.id, version: c.version }, data: { ...data, version: { increment: 1 } } });
    await audit(tx, actor(ctx), "crm.contact_update", "CrmContact", c.id, { before: { responsibleUserId: c.responsibleUserId }, after: { fields: Object.keys(data), responsibleUserId: upd.responsibleUserId } });
    return upd;
  });
}

export async function listContacts(ctx: AgencyCtx, f: { q?: string; state?: string; registered?: "yes" | "no" } = {}) {
  const where: any = { ...contactScope(ctx) };
  if (f.state) where.linkState = f.state;
  if (f.registered === "yes") where.linkState = { in: ["REGISTERED", "VERIFIED_LINKED"] };
  if (f.registered === "no") where.linkState = { in: ["NOT_INVITED", "PREPARED", "SENT", "REVOKED"] };
  if (f.q) {
    const q = f.q.trim();
    const p = normPhone(q);
    where.AND = [{ OR: [{ name: { contains: q, mode: "insensitive" } }, { emailNorm: { contains: q.toLowerCase() } }, ...(p ? [{ phoneNorm: p }] : [])] }];
  }
  return db.crmContact.findMany({ where, orderBy: [{ updatedAt: "desc" }], take: 500, include: { policies: { orderBy: { endsAt: "asc" } } } });
}

/** Карточка для агентства: свои записи + полисы, оформленные этим агентством на платформе для связанного клиента. */
export async function contactCard(ctx: AgencyCtx, id: string) {
  const c = await getContactForAgency(db, ctx, id);
  const [policies, interactions, tasks] = await Promise.all([
    db.crmPolicy.findMany({ where: { contactId: c.id, organizationId: ctx.orgId }, orderBy: { endsAt: "asc" } }),
    db.crmInteraction.findMany({ where: { contactId: c.id, organizationId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.task.findMany({ where: { organizationId: ctx.orgId, relatedType: "CrmContact", relatedId: c.id }, orderBy: [{ status: "asc" }, { dueAt: "asc" }] }),
  ]);
  const platformPolicies = c.linkState === "VERIFIED_LINKED" && c.linkedUserId
    ? await db.policy.findMany({ where: { clientId: c.linkedUserId, agencyOrgId: ctx.orgId }, orderBy: { startsAt: "desc" } })
    : [];
  return { contact: c, policies, interactions, tasks, platformPolicies };
}

// ───────────── Полисы, задачи, взаимодействия ─────────────

export type CrmPolicyInput = { category: string; insurerName: string; number?: string | null; objectTitle: string; startsAt?: string | null; endsAt?: string | null; premiumKop?: number | null };

async function renewalTask(tx: Tx, orgId: string, contact: { id: string; name: string; responsibleUserId: string | null }, p: { category: string; insurerName: string; endsAt: Date | null }, t: Date) {
  if (!p.endsAt || p.endsAt <= t) return null;
  const due = new Date(Math.max(t.getTime(), p.endsAt.getTime() - DEMO_RULES.crmRenewalLeadDays * DAY));
  return { id: randomUUID(), organizationId: orgId, assigneeId: contact.responsibleUserId, title: `Продление: ${CATEGORIES[p.category] ?? p.category}, ${p.insurerName} — ${contact.name}`, note: `Полис заканчивается ${p.endsAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}. Клиент может сравнить предложения на рынке — это его право.`, relatedType: "CrmContact", relatedId: contact.id, dueAt: due };
}

export async function addCrmPolicy(ctx: AgencyCtx, contactId: string, i: CrmPolicyInput) {
  const t = await now();
  return db.$transaction(async (tx) => {
    const c = await getContactForAgency(tx, ctx, contactId);
    const startsAt = i.startsAt ? parseDate(i.startsAt) : null, endsAt = i.endsAt ? parseDate(i.endsAt) : null;
    if (i.startsAt && !startsAt) throw err("VALIDATION", "Дата начала не распознана", { fields: [{ path: "startsAt", message: "ГГГГ-ММ-ДД" }] });
    if (i.endsAt && !endsAt) throw err("VALIDATION", "Дата окончания не распознана", { fields: [{ path: "endsAt", message: "ГГГГ-ММ-ДД" }] });
    if (startsAt && endsAt && endsAt <= startsAt) throw err("VALIDATION", "Окончание раньше начала", { fields: [{ path: "endsAt", message: "Позже даты начала" }] });
    const p = await tx.crmPolicy.create({ data: { organizationId: ctx.orgId, contactId: c.id, category: categoryOf(i.category), insurerName: i.insurerName.trim(), number: i.number?.trim() || null, objectTitle: i.objectTitle.trim(), startsAt, endsAt, premiumKop: i.premiumKop ?? null } });
    const task = await renewalTask(tx, ctx.orgId, c, p, t);
    if (task) await tx.task.create({ data: task });
    await tx.crmInteraction.create({ data: { organizationId: ctx.orgId, contactId: c.id, authorUserId: ctx.user.id, kind: "SYSTEM", text: `Добавлен полис: ${CATEGORIES[p.category]}, ${p.insurerName}${p.number ? ` № ${p.number}` : ""}` } });
    await audit(tx, actor(ctx), "crm.policy_add", "CrmContact", c.id, { after: { category: p.category } });
    return p;
  });
}

export async function addInteraction(ctx: AgencyCtx, contactId: string, i: { kind: "NOTE" | "CALL" | "MESSAGE_SENT_MANUAL"; text: string; channel?: keyof typeof CHANNELS }) {
  const c = await getContactForAgency(db, ctx, contactId);
  const text = i.kind === "MESSAGE_SENT_MANUAL" && i.channel ? `[${CHANNELS[i.channel]}] ${i.text}` : i.text;
  return db.crmInteraction.create({ data: { organizationId: ctx.orgId, contactId: c.id, authorUserId: ctx.user.id, kind: i.kind, text: text.slice(0, 4000) } });
}

export async function addTask(ctx: AgencyCtx, contactId: string, i: { title: string; dueAt?: string | null; note?: string | null }) {
  const c = await getContactForAgency(db, ctx, contactId);
  const due = i.dueAt ? parseDate(i.dueAt) : null;
  if (i.dueAt && !due) throw err("VALIDATION", "Срок не распознан", { fields: [{ path: "dueAt", message: "ГГГГ-ММ-ДД" }] });
  return db.task.create({ data: { organizationId: ctx.orgId, assigneeId: c.responsibleUserId ?? ctx.user.id, title: i.title, note: i.note ?? null, relatedType: "CrmContact", relatedId: c.id, dueAt: due } });
}

// ───────────── Импорт ─────────────

export type ImportResult = { batchId: string; total: number; created: number; duplicates: number; rejected: number; policies: number; tasks: number; errors: { row: number; message: string }[] };

/**
 * Импорт CSV собственной базы агентства. Не создаёт аккаунтов и ничего не отправляет контактам.
 * Дубли (по нормализованному телефону/email) внутри файла и среди карточек агентства пропускаются.
 * Обязательно: имя и хотя бы один канал связи; основание обработки данных указывается для всей загрузки.
 */
export async function importContacts(ctx: AgencyCtx, i: { fileName: string; csv: string; legalBasis: LegalBasis; responsibleUserId?: string | null }): Promise<ImportResult> {
  await rateLimit(`crm:import:${ctx.orgId}`, 20, 3600);
  if (i.csv.length > 2_000_000) throw err("LIMIT_EXCEEDED", "Файл больше 2 МБ — разделите его на части");
  await assertMember(db, ctx.orgId, i.responsibleUserId);
  const rows = parseCsv(i.csv);
  if (rows.length < 2) throw err("VALIDATION", "В файле нет строк с данными: первая строка — заголовки, далее контакты");
  const h = mapHeader(rows[0]);
  if (h.name === undefined || (h.phone === undefined && h.email === undefined)) throw err("VALIDATION", "Нужны колонки «Имя» и «Телефон» или «Email»");
  const data = rows.slice(1);
  if (data.length > DEMO_RULES.crmImportMaxRows) throw err("LIMIT_EXCEEDED", `Не больше ${DEMO_RULES.crmImportMaxRows} строк за одну загрузку`);
  const t = await now();
  const members = await db.membership.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, include: { user: true } });
  const byEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.userId]));
  const existing = await db.crmContact.findMany({ where: { organizationId: ctx.orgId }, select: { phoneNorm: true, emailNorm: true } });
  const seenP = new Set(existing.map((e) => e.phoneNorm).filter(Boolean) as string[]);
  const seenE = new Set(existing.map((e) => e.emailNorm).filter(Boolean) as string[]);
  const get = (r: string[], k: string) => (h[k] === undefined ? "" : (r[h[k]] ?? "").trim());
  const errors: ImportResult["errors"] = [];
  const contacts: any[] = [], policies: any[] = [], tasks: any[] = [];
  let duplicates = 0;
  const batchId = randomUUID();
  const defaultResp = i.responsibleUserId ?? (ctx.role === "AGENCY_OWNER" ? null : ctx.user.id);
  data.forEach((r, idx) => {
    const line = idx + 2;
    const name = get(r, "name");
    const phoneRaw = get(r, "phone"), emailRaw = get(r, "email");
    const phoneNorm = normPhone(phoneRaw), emailNorm = normEmail(emailRaw);
    if (!name) return void errors.push({ row: line, message: "Нет имени" });
    if (!phoneNorm && !emailNorm) return void errors.push({ row: line, message: "Нет распознаваемого телефона или email" });
    if ((phoneNorm && seenP.has(phoneNorm)) || (emailNorm && seenE.has(emailNorm))) { duplicates++; return; }
    if (phoneNorm) seenP.add(phoneNorm);
    if (emailNorm) seenE.add(emailNorm);
    const respEmail = get(r, "responsible").toLowerCase();
    const responsibleUserId = respEmail && byEmail.has(respEmail) ? byEmail.get(respEmail)! : defaultResp;
    const contact = { id: randomUUID(), organizationId: ctx.orgId, name: name.slice(0, 200), phone: phoneRaw || null, email: emailRaw || null, phoneNorm, emailNorm, provenance: "IMPORT", legalBasis: i.legalBasis, notes: get(r, "note").slice(0, 2000) || null, importBatchId: batchId, responsibleUserId };
    contacts.push(contact);
    const insurer = get(r, "insurer"), endsRaw = get(r, "endsAt");
    if (insurer || endsRaw || get(r, "policyNumber")) {
      const endsAt = parseDate(endsRaw), startsAt = parseDate(get(r, "startsAt"));
      if (endsRaw && !endsAt) errors.push({ row: line, message: "Дата окончания полиса не распознана — полис добавлен без даты" });
      const p = { id: randomUUID(), organizationId: ctx.orgId, contactId: contact.id, category: categoryOf(get(r, "category")), insurerName: (insurer || "Не указан").slice(0, 200), number: get(r, "policyNumber") || null, objectTitle: (get(r, "object") || CATEGORIES[categoryOf(get(r, "category"))]).slice(0, 200), startsAt, endsAt, premiumKop: rubToKop(get(r, "premium")) };
      policies.push(p);
      if (endsAt && endsAt > t) {
        const due = new Date(Math.max(t.getTime(), endsAt.getTime() - DEMO_RULES.crmRenewalLeadDays * DAY));
        tasks.push({ id: randomUUID(), organizationId: ctx.orgId, assigneeId: responsibleUserId, title: `Продление: ${CATEGORIES[p.category]}, ${p.insurerName} — ${contact.name}`, note: `Полис заканчивается ${endsAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}.`, relatedType: "CrmContact", relatedId: contact.id, dueAt: due });
      }
    }
  });
  const rejected = new Set(errors.filter((e) => /^Нет/.test(e.message)).map((e) => e.row)).size;
  await db.$transaction(async (tx) => {
    await tx.crmImportBatch.create({ data: { id: batchId, organizationId: ctx.orgId, userId: ctx.user.id, fileName: i.fileName.slice(0, 200), legalBasis: i.legalBasis, total: data.length, created: contacts.length, duplicates, rejected, errors: errors.slice(0, 200) } });
    if (contacts.length) await tx.crmContact.createMany({ data: contacts });
    if (policies.length) await tx.crmPolicy.createMany({ data: policies });
    if (tasks.length) await tx.task.createMany({ data: tasks });
    if (contacts.length) await tx.crmInteraction.createMany({ data: contacts.map((c) => ({ organizationId: ctx.orgId, contactId: c.id, authorUserId: ctx.user.id, kind: "SYSTEM", text: `Импортирован из файла «${i.fileName.slice(0, 100)}»` })) });
    await audit(tx, actor(ctx), "crm.import", "CrmImportBatch", batchId, { after: { total: data.length, created: contacts.length, duplicates, rejected, legalBasis: i.legalBasis } });
  }, { timeout: 60_000 });
  return { batchId, total: data.length, created: contacts.length, duplicates, rejected, policies: policies.length, tasks: tasks.length, errors: errors.slice(0, 50) };
}

// ───────────── Подготовка сообщений (ИИ-эмулятор: только текст, без отправки) ─────────────

function inviteText(o: { name: string; agent: string; org: string; link: string; until: Date }) {
  const first = o.name.split(/\s+/)[0];
  return [
    `Здравствуйте, ${first}! Это ${o.agent}, агентство «${o.org}».`,
    `Я продолжаю обслуживать ваши полисы как раньше. Если удобно, их можно держать в личном кабинете Talisman: напоминания о продлении, документы и помощь при страховом случае в одном месте.`,
    `Регистрация бесплатная и необязательная. При регистрации вы сами решаете, какие сведения подтвердить и кому дать доступ.`,
    `Персональная ссылка (действует до ${o.until.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}): ${o.link}`,
  ].join("\n\n");
}

export async function draftMessage(ctx: AgencyCtx, contactId: string, purpose: "RENEWAL" | "CHECKIN") {
  const c = await getContactForAgency(db, ctx, contactId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const t = await now();
  const first = c.name.split(/\s+/)[0];
  let text: string;
  if (purpose === "RENEWAL") {
    const p = await db.crmPolicy.findFirst({ where: { contactId: c.id, organizationId: ctx.orgId, endsAt: { gt: t } }, orderBy: { endsAt: "asc" } });
    if (!p) throw err("NOT_FOUND", "У контакта нет полиса с будущей датой окончания");
    text = `Здравствуйте, ${first}! Это ${ctx.user.name}, агентство «${org.name}». Ваш полис «${CATEGORIES[p.category]}» (${p.insurerName}) действует до ${p.endsAt!.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}. Могу подготовить варианты продления — подскажите, изменилось ли что-то в объекте или водителях? Решение о продлении остаётся за вами.`;
  } else {
    text = `Здравствуйте, ${first}! Это ${ctx.user.name}, агентство «${org.name}». Хотел уточнить, всё ли в порядке с вашей страховкой и не появилось ли новых задач — поездка, ремонт, новая машина. Если появится вопрос, напишите.`;
  }
  await db.crmInteraction.create({ data: { organizationId: ctx.orgId, contactId: c.id, authorUserId: ctx.user.id, kind: "MESSAGE_DRAFT", text } });
  return { text, note: "Текст подготовлен помощником. Отправьте его сами в удобном канале — платформа ничего не отправляет автоматически." };
}

// ───────────── Приглашение и связывание ─────────────

/** Подготовить персональную ссылку и текст приглашения. Прежняя ссылка перестаёт действовать. */
export async function prepareInvitation(ctx: AgencyCtx, contactId: string) {
  const t = await now();
  const token = randomToken(24);
  const until = new Date(t.getTime() + DEMO_RULES.crmInviteDays * DAY);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const r = await txRetry(async (tx) => {
    const c = await getContactForAgency(tx, ctx, contactId);
    assertTransition("crmLink", c.linkState, "PREPARED", role(ctx));
    if (!c.emailNorm && !c.phoneNorm) throw err("VALIDATION", "Укажите телефон или email контакта — по ним клиент подтвердит, что карточка его");
    const upd = await tx.crmContact.update({ where: { id: c.id, version: c.version }, data: { linkState: "PREPARED", inviteTokenHash: sha256(token), inviteExpiresAt: until, invitePreparedAt: t, version: { increment: 1 } } });
    await audit(tx, actor(ctx), "crm.invite_prepared", "CrmContact", c.id, { before: { linkState: c.linkState }, after: { linkState: "PREPARED", until } });
    return upd;
  });
  const link = `${process.env.APP_URL ?? ""}/invite/${token}`;
  const text = inviteText({ name: r.name, agent: ctx.user.name, org: org.name, link, until });
  await db.crmInteraction.create({ data: { organizationId: ctx.orgId, contactId: r.id, authorUserId: ctx.user.id, kind: "MESSAGE_DRAFT", text: text.replace(link, "[персональная ссылка]") } });
  return { link, text, expiresAt: until, note: "Скопируйте текст и отправьте контакту сами. После отправки отметьте канал — это нужно для истории." };
}

export async function markInvitationSent(ctx: AgencyCtx, contactId: string, channel: keyof typeof CHANNELS) {
  return txRetry(async (tx) => {
    const c = await getContactForAgency(tx, ctx, contactId);
    assertTransition("crmLink", c.linkState, "SENT", role(ctx));
    const t = await now();
    if (c.inviteExpiresAt && c.inviteExpiresAt < t) throw err("QUOTE_EXPIRED", "Срок ссылки истёк — подготовьте новое приглашение");
    const upd = await tx.crmContact.update({ where: { id: c.id, version: c.version }, data: { linkState: "SENT", inviteSentAt: t, inviteChannel: channel, version: { increment: 1 } } });
    await tx.crmInteraction.create({ data: { organizationId: ctx.orgId, contactId: c.id, authorUserId: ctx.user.id, kind: "MESSAGE_SENT_MANUAL", text: `Приглашение отправлено агентом вручную: ${CHANNELS[channel]}` } });
    await audit(tx, actor(ctx), "crm.invite_sent", "CrmContact", c.id, { after: { channel } });
    return upd;
  });
}

async function contactByToken(tx: Tx | typeof db, token: string) {
  const c = await tx.crmContact.findUnique({ where: { inviteTokenHash: sha256(token) } });
  if (!c) throw err("NOT_FOUND", "Приглашение не найдено или уже использовано");
  if (c.inviteExpiresAt && c.inviteExpiresAt < (await now())) throw err("QUOTE_EXPIRED", "Срок приглашения истёк — попросите агента прислать новое");
  return c;
}

/** Публичный просмотр приглашения: только название агентства, без данных контакта. */
export async function invitationPreview(token: string) {
  const c = await contactByToken(db, token);
  const org = await db.organization.findUniqueOrThrow({ where: { id: c.organizationId } });
  return { orgName: org.name, expiresAt: c.inviteExpiresAt };
}

const channelsMatch = (c: { emailNorm: string | null; phoneNorm: string | null }, u: { email: string; emailVerifiedAt: Date | null; phone: string | null }) =>
  (!!c.emailNorm && !!u.emailVerifiedAt && c.emailNorm === u.email.toLowerCase()) || (!!c.phoneNorm && normPhone(u.phone) === c.phoneNorm);

/**
 * Клиент открыл ссылку и вошёл: карточка становится «зарегистрирован, не подтверждён».
 * Ссылка одноразовая. Источник аккаунта (IMPORTED_BY_AGENT) записывается только для нового клиента без заявок и полисов.
 */
export async function acceptInvitation(ctx: Ctx, token: string) {
  if (ctx.user.kind !== "CLIENT") throw err("FORBIDDEN", "Приглашение принимает клиент");
  return txRetry(async (tx) => {
    const c = await contactByToken(tx, token);
    assertTransition("crmLink", c.linkState, "REGISTERED", "CLIENT");
    const other = await tx.crmContact.findFirst({ where: { organizationId: c.organizationId, linkedUserId: ctx.user.id } });
    if (other) throw err("CONFLICT", "Ваш аккаунт уже связан с карточкой этого агентства");
    const t = await now();
    const upd = await tx.crmContact.update({ where: { id: c.id, version: c.version }, data: { linkState: "REGISTERED", linkedUserId: ctx.user.id, registeredAt: t, inviteTokenHash: null, version: { increment: 1 } } });
    const u = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!u.acquisitionSource) {
      const history = (await tx.insuranceRequest.count({ where: { clientId: u.id } })) + (await tx.policy.count({ where: { clientId: u.id } }));
      await tx.user.update({ where: { id: u.id }, data: history === 0 ? { acquisitionSource: "IMPORTED_BY_AGENT", acquisitionOrgId: c.organizationId } : { acquisitionSource: "ORGANIC" } });
    }
    await audit(tx, { userId: ctx.user.id, role: "CLIENT", correlationId: ctx.correlationId }, "crm.invite_accepted", "CrmContact", c.id, { before: { linkState: c.linkState }, after: { linkState: "REGISTERED" } });
    await notifyOrg(tx, c.organizationId, { type: "crm.registered", title: "Контакт открыл приглашение", body: `${c.name} зарегистрировался по вашей ссылке. Связь станет активной после подтверждения клиентом.`, link: `/a/crm/${c.id}` });
    return { contactId: upd.id, channelsMatch: channelsMatch(c, u) };
  });
}

/**
 * Подтверждение связи клиентом. Нужна проверка владения каналом: подтверждённый email аккаунта или телефон профиля
 * должны совпадать с каналом в карточке агентства. Автоматического слияния нет.
 * sharePolicies — клиент сам решает, переносить ли в кабинет полисы, которые знает агентство.
 */
export async function confirmLink(ctx: Ctx, contactId: string, i: { sharePolicies: boolean }) {
  if (ctx.user.kind !== "CLIENT") throw err("FORBIDDEN", "Подтверждает клиент");
  return txRetry(async (tx) => {
    const c = await tx.crmContact.findFirst({ where: { id: contactId, linkedUserId: ctx.user.id } });
    if (!c) throw err("NOT_FOUND", "Приглашение не найдено");
    assertTransition("crmLink", c.linkState, "VERIFIED_LINKED", "CLIENT");
    const u = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!channelsMatch(c, u)) throw err("FORBIDDEN", "Контакты в карточке агентства не совпадают с подтверждёнными данными вашего аккаунта", { nextAction: "Попросите агента исправить телефон или email в карточке либо отклоните приглашение" });
    const t = await now();
    await tx.crmContact.update({ where: { id: c.id, version: c.version }, data: { linkState: "VERIFIED_LINKED", linkedAt: t, version: { increment: 1 } } });
    await tx.consent.create({ data: { userId: u.id, purpose: "AGENT_LINK", textVersion: "agent-link-2026-11-v1", granted: true, method: "button:invite", recipients: c.organizationId } });
    let shared = 0;
    if (i.sharePolicies) {
      const ps = await tx.crmPolicy.findMany({ where: { contactId: c.id, organizationId: c.organizationId } });
      for (const p of ps) {
        const ex = await tx.externalPolicy.findUnique({ where: { crmPolicyId: p.id } });
        if (ex) continue;
        await tx.externalPolicy.create({ data: { clientId: u.id, source: "AGENT_CRM", sourceOrgId: c.organizationId, crmPolicyId: p.id, verification: "AGENT_STATED", category: p.category, insurerName: p.insurerName, number: p.number, objectTitle: p.objectTitle, startsAt: p.startsAt, endsAt: p.endsAt, premiumKop: p.premiumKop } });
        await tx.crmPolicy.update({ where: { id: p.id }, data: { sharedAt: t } });
        shared++;
      }
    }
    await audit(tx, { userId: u.id, role: "CLIENT", correlationId: ctx.correlationId }, "crm.link_confirmed", "CrmContact", c.id, { after: { linkState: "VERIFIED_LINKED", sharedPolicies: shared } });
    await notifyOrg(tx, c.organizationId, { type: "crm.linked", title: "Клиент подтвердил связь", body: `${c.name} подтвердил данные${shared ? ` и добавил в кабинет полисов: ${shared}` : ""}.`, link: `/a/crm/${c.id}` });
    return { ok: true, sharedPolicies: shared };
  });
}

/** Отказ от приглашения или отзыв доступа. Карточка агентства остаётся (это его данные), но связь с аккаунтом снимается. */
export async function revokeLink(ctx: Ctx, contactId: string) {
  if (ctx.user.kind !== "CLIENT") throw err("FORBIDDEN", "Отзывает клиент");
  return txRetry(async (tx) => {
    const c = await tx.crmContact.findFirst({ where: { id: contactId, linkedUserId: ctx.user.id } });
    if (!c) throw err("NOT_FOUND", "Связь не найдена");
    assertTransition("crmLink", c.linkState, "REVOKED", "CLIENT");
    const t = await now();
    await tx.crmContact.update({ where: { id: c.id, version: c.version }, data: { linkState: "REVOKED", linkedUserId: null, revokedAt: t, inviteTokenHash: null, version: { increment: 1 } } });
    await tx.consent.updateMany({ where: { userId: ctx.user.id, purpose: "AGENT_LINK", recipients: c.organizationId, revokedAt: null }, data: { revokedAt: t } });
    await audit(tx, { userId: ctx.user.id, role: "CLIENT", correlationId: ctx.correlationId }, "crm.link_revoked", "CrmContact", c.id, { before: { linkState: c.linkState }, after: { linkState: "REVOKED" } });
    await notifyOrg(tx, c.organizationId, { type: "crm.revoked", title: "Клиент отозвал связь с кабинетом", body: `${c.name}: связь с аккаунтом снята. Карточка и договоры, которые вы обслуживаете, сохраняются.`, link: `/a/crm/${c.id}` });
    await notify(tx, ctx.user.id, { type: "crm.revoked", title: "Доступ агентства отозван", body: "Агентство больше не видит связь с вашим кабинетом. Полисы, которые вы добавили, остаются у вас." });
    return { ok: true };
  });
}

/** Для клиента: агентства, связанные с его аккаунтом. Только название агентства, статус и известные агентству полисы — без заметок и истории. */
export async function myAgentLinks(ctx: Ctx) {
  const cs = await db.crmContact.findMany({ where: { linkedUserId: ctx.user.id }, include: { policies: { select: { id: true, category: true, insurerName: true, number: true, objectTitle: true, endsAt: true, sharedAt: true } } }, orderBy: { registeredAt: "desc" } });
  const orgs = await db.organization.findMany({ where: { id: { in: cs.map((c) => c.organizationId) } }, select: { id: true, name: true } });
  const u = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  return cs.map((c) => ({ id: c.id, orgName: orgs.find((o) => o.id === c.organizationId)?.name ?? "Агентство", state: c.linkState, linkedAt: c.linkedAt, channelsMatch: channelsMatch(c, u), policies: c.policies }));
}

// ───────────── Показатели для агентства ─────────────

export async function crmMetrics(ctx: AgencyCtx) {
  const scope = contactScope(ctx);
  const grouped = await db.crmContact.groupBy({ by: ["linkState"], where: scope, _count: { _all: true } });
  const n = (s: string[]) => grouped.filter((g) => s.includes(g.linkState)).reduce((a, g) => a + g._count._all, 0);
  const imported = await db.crmContact.count({ where: { ...scope, provenance: "IMPORT" } });
  const linkedUsers = (await db.crmContact.findMany({ where: { ...scope, linkState: "VERIFIED_LINKED" }, select: { linkedUserId: true } })).map((x) => x.linkedUserId!).filter(Boolean);
  const newSales = linkedUsers.length ? await db.policy.count({ where: { clientId: { in: linkedUsers }, agencyOrgId: ctx.orgId, contractStatus: { in: ["CONCLUDED", "EXPIRED"] } } }) : 0;
  const t = await now();
  const renewals = await db.task.count({ where: { organizationId: ctx.orgId, relatedType: "CrmContact", status: "OPEN", dueAt: { lte: new Date(t.getTime() + 30 * DAY) } } });
  return {
    total: n(["NOT_INVITED", "PREPARED", "SENT", "REGISTERED", "VERIFIED_LINKED", "REVOKED"]),
    imported,
    invited: n(["PREPARED", "SENT", "REGISTERED", "VERIFIED_LINKED"]),
    sent: n(["SENT", "REGISTERED", "VERIFIED_LINKED"]),
    registered: n(["REGISTERED", "VERIFIED_LINKED"]),
    linked: n(["VERIFIED_LINKED"]),
    revoked: n(["REVOKED"]),
    newSales,
    renewalsDue30d: renewals,
  };
}
