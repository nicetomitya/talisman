import { db } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, type Ctx } from "../access";

/**
 * Отзыв только по подтверждённой сделке (заключённый полис клиента), один на этап с обновлением.
 * Рейтинг — только по опубликованным отзывам; тариф агентства на него не влияет (AC27).
 */
export async function upsertReview(ctx: Ctx, i: { policyId: string; stage: "SALE" | "CLAIM"; rating: number; text: string }) {
  if (ctx.user.kind !== "CLIENT") throw err("FORBIDDEN", "Отзыв оставляет клиент");
  const p = await db.policy.findFirst({ where: { id: i.policyId, clientId: ctx.user.id } });
  if (!p || !p.agencyOrgId) throw err("FORBIDDEN", "Отзыв возможен только по подтверждённой сделке");
  if (!["CONCLUDED", "EXPIRED", "TERMINATED"].includes(p.contractStatus)) throw err("FORBIDDEN", "Сделка ещё не подтверждена");
  if (i.stage === "CLAIM" && !(await db.claim.count({ where: { policyId: p.id, status: { in: ["PAID", "CLOSED", "REJECTED"] } } }))) throw err("FORBIDDEN", "Отзыв об урегулировании — после завершения обращения");
  const selfMember = await db.membership.count({ where: { userId: ctx.user.id, organizationId: p.agencyOrgId } });
  if (selfMember) throw err("FORBIDDEN", "Саморейтинг запрещён");
  const r = await db.review.upsert({ where: { authorId_policyId_stage: { authorId: ctx.user.id, policyId: p.id, stage: i.stage } }, update: { rating: i.rating, text: i.text.slice(0, 2000) }, create: { authorId: ctx.user.id, agencyOrgId: p.agencyOrgId, policyId: p.id, stage: i.stage, rating: i.rating, text: i.text.slice(0, 2000) } });
  await audit(db, actor(ctx), "review.upsert", "Review", r.id, { after: { rating: i.rating } });
  return r;
}

export async function replyReview(ctx: Ctx & { orgId: string }, id: string, reply: string) {
  const r = await db.review.findFirst({ where: { id, agencyOrgId: ctx.orgId } });
  if (!r) throw err("NOT_FOUND", "Отзыв не найден");
  return db.review.update({ where: { id }, data: { agentReply: reply.slice(0, 1000) } });
}

export const MODERATION_REASONS = { PERSONAL_DATA: "Содержит персональные данные", OFFENSIVE: "Оскорбления", NOT_ABOUT_SERVICE: "Не относится к обслуживанию" } as const;

/** Модерация не удаляет отзыв только из-за низкой оценки: требуется допустимое основание. */
export async function moderateReview(ctx: Ctx, id: string, reason: keyof typeof MODERATION_REASONS) {
  if (!MODERATION_REASONS[reason]) throw err("VALIDATION", "Недопустимое основание модерации (низкая оценка основанием не является)");
  const r = await db.review.update({ where: { id }, data: { status: "HIDDEN", moderationNote: MODERATION_REASONS[reason] } });
  await audit(db, actor(ctx), "review.hidden", "Review", id, { reason });
  return r;
}

export async function agencyRating(orgId: string) {
  const a = await db.review.aggregate({ where: { agencyOrgId: orgId, status: "PUBLISHED" }, _avg: { rating: true }, _count: true });
  return { avg: a._avg.rating ? Math.round(a._avg.rating * 10) / 10 : null, count: a._count };
}
