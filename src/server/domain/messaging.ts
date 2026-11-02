import { db, type Tx } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, type Ctx } from "../access";
import { notify, notifyOrg } from "./notify";
import { adapters } from "../adapters";
import { rateLimit } from "../auth/ratelimit";
import type { ClauseRef } from "../adapters/ai";

export async function ensureConversation(tx: Tx | typeof db, i: { contextType: string; contextId: string; clientId: string; agencyOrgId: string | null; title: string }) {
  const existing = await tx.conversation.findFirst({ where: { contextType: i.contextType, contextId: i.contextId, agencyOrgId: i.agencyOrgId } });
  if (existing) return existing;
  return tx.conversation.create({ data: { ...i, slaMinutes: 60 } });
}

/** Доступ к переписке: клиент-владелец или агентство-участник. Остальным — «не найдено» (AC29). */
export async function getConversation(ctx: Ctx, id: string) {
  const c = await db.conversation.findUnique({ where: { id } });
  if (!c) throw err("NOT_FOUND", "Переписка не найдена");
  if (ctx.user.kind === "CLIENT" && c.clientId === ctx.user.id) return { conv: c, side: "CLIENT" as const };
  if (ctx.org?.orgType === "AGENCY" && c.agencyOrgId === ctx.org.orgId) return { conv: c, side: "AGENT" as const };
  if (ctx.org?.orgType === "PLATFORM" && ctx.org.role === "ADMIN") return { conv: c, side: "SUPPORT" as const };
  throw err("NOT_FOUND", "Переписка не найдена");
}

export async function listConversations(ctx: Ctx) {
  const where = ctx.user.kind === "CLIENT" ? { clientId: ctx.user.id } : ctx.org?.orgType === "AGENCY" ? { agencyOrgId: ctx.org.orgId } : { id: "00000000-0000-0000-0000-000000000000" };
  return db.conversation.findMany({ where, orderBy: { updatedAt: "desc" }, include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } } });
}

export async function sendMessage(ctx: Ctx, conversationId: string, body: string, opts: { askAssistant?: boolean } = {}) {
  await rateLimit(`msg:${ctx.user.id}`, 40, 300);
  const text = body.trim();
  if (!text || text.length > 4000) throw err("VALIDATION", "Сообщение пустое или слишком длинное");
  const { conv, side } = await getConversation(ctx, conversationId);
  const msg = await db.$transaction(async (tx) => {
    const m = await tx.message.create({ data: { conversationId: conv.id, authorId: ctx.user.id, authorRole: side, body: text, readByClientAt: side === "CLIENT" ? new Date() : null, readByAgencyAt: side === "AGENT" ? new Date() : null } });
    await tx.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
    if (side === "CLIENT" && conv.agencyOrgId && !opts.askAssistant) await notifyOrg(tx, conv.agencyOrgId, { type: "message.new", title: "Новое сообщение клиента", body: text.slice(0, 140), link: `/a/messages/${conv.id}` });
    if (side !== "CLIENT") await notify(tx, conv.clientId, { type: "message.new", title: "Ответ в чате", body: text.slice(0, 140), link: `/c/messages/${conv.id}` });
    return m;
  });
  let ai = null;
  if (side === "CLIENT" && opts.askAssistant) ai = await assistantReply(ctx, conv, text);
  return { message: msg, assistant: ai };
}

/** Документы контекста разговора, по которым помощник может отвечать. */
async function contextClauses(conv: { contextType: string; contextId: string; clientId: string }): Promise<ClauseRef[]> {
  let where: any = null;
  if (conv.contextType === "CHECKOUT") where = { checkoutId: conv.contextId };
  if (conv.contextType === "POLICY") where = { policyId: conv.contextId };
  if (conv.contextType === "CLAIM") { const c = await db.claim.findUnique({ where: { id: conv.contextId } }); if (c) where = { policyId: c.policyId }; }
  if (!where) return [];
  const docs = (await db.document.findMany({ where: { ...where, supersededById: null } })).filter((d) => Array.isArray(d.clauses));
  return docs.flatMap((d) => ((d.clauses as any[]) ?? []).map((c) => ({ documentId: d.id, documentTitle: d.title, clauseId: c.id, clauseTitle: c.title, text: c.text })));
}

/**
 * Ответ помощника: только со ссылкой на документ и пункт, существующие в документах этого полиса (AC22).
 * Нет сведений или просьба о действии — передача специалисту с сохранением контекста.
 */
async function assistantReply(ctx: Ctx, conv: { id: string; contextType: string; contextId: string; clientId: string; agencyOrgId: string | null; slaMinutes: number }, question: string) {
  await rateLimit(`ai:${ctx.user.id}`, 20, 600);
  const clauses = await contextClauses(conv);
  const a = await adapters.ai.answer(question, clauses);
  let body = a.text;
  let citations: any = null;
  let handoff = a.kind !== "ANSWER";
  if (a.kind === "ANSWER") {
    const valid = a.citations.every((c) => clauses.some((x) => x.documentId === c.documentId && x.clauseId === c.clauseId));
    if (!valid) { handoff = true; body = "Не удалось подтвердить ссылку на пункт документа. Передаю вопрос специалисту."; }
    else { citations = a.citations.map((c) => ({ ...c, documentTitle: clauses.find((x) => x.documentId === c.documentId)!.documentTitle })); body += "\n\nОтвет помощника не изменяет договор."; }
  }
  if (handoff) body += ` Ожидаемое время ответа специалиста — до ${conv.slaMinutes} минут.`;
  const m = await db.$transaction(async (tx) => {
    const m = await tx.message.create({ data: { conversationId: conv.id, authorId: null, authorRole: "AI", body, citations, handoff } });
    if (handoff && conv.agencyOrgId) await notifyOrg(tx, conv.agencyOrgId, { type: "message.handoff", title: "Помощник передал вопрос клиента", body: question.slice(0, 140), link: `/a/messages/${conv.id}` });
    await audit(tx, actor(ctx), "ai.answer", "Conversation", conv.id, { after: { kind: a.kind, handoff, citations } });
    return m;
  });
  return m;
}

export async function markRead(ctx: Ctx, conversationId: string) {
  const { conv, side } = await getConversation(ctx, conversationId);
  if (side === "CLIENT") await db.message.updateMany({ where: { conversationId: conv.id, readByClientAt: null }, data: { readByClientAt: new Date() } });
  if (side === "AGENT") await db.message.updateMany({ where: { conversationId: conv.id, readByAgencyAt: null }, data: { readByAgencyAt: new Date() } });
}
