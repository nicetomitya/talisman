import { z } from "zod";
import { api, idemKey } from "@/server/api";
import { asAgency, actor } from "@/server/access";
import { err } from "@/server/errors";
import { calculator, submitQuote, withdrawQuote, publishDraftQuote } from "@/server/domain/auction";
import { saveRule, RuleSchema } from "@/server/domain/automation";
import { replyReview } from "@/server/domain/reviews";
import { proposeProduct, transitionProduct } from "@/server/domain/admin";
import { withIdempotency } from "@/server/idempotency";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { hashPassword, randomToken } from "@/server/auth/crypto";
import { adapters } from "@/server/adapters";
import { planAllows } from "@/server/domain/subscriptions";
import { exceptionAction } from "@/server/domain/admin";

const S: Record<string, z.ZodTypeAny> = {
  calc: z.object({ requestId: z.string().uuid(), productId: z.string().uuid(), deductibleRub: z.number().int().optional() }).strict(),
  // Массовое присваивание исключено: нельзя передать комиссию, статус, страховщика или итог.
  quote: z.object({ requestId: z.string().uuid(), requestVersion: z.number().int(), productId: z.string().uuid(), premiumKop: z.number().int().positive(), deductibleRub: z.number().int().optional(), discountKop: z.number().int().min(0).optional(), discountPayer: z.enum(["AGENCY_COMMISSION"]).nullable().optional(), feesKop: z.number().int().min(0).optional(), publish: z.boolean(), idempotency_key: idemKey }).strict(),
  withdraw: z.object({ quoteId: z.string().uuid(), reason: z.string().min(3).max(300) }).strict(),
  "publish-draft": z.object({ quoteId: z.string().uuid() }).strict(),
  automation: RuleSchema,
  invite: z.object({ email: z.string().email(), name: z.string().min(2).max(120), role: z.enum(["AGENT", "AGENCY_OWNER"]) }).strict(),
  assign: z.object({ clientId: z.string().uuid(), agentUserId: z.string().uuid(), reason: z.string().max(200).default("Перераспределение") }).strict(),
  "task-done": z.object({ taskId: z.string().uuid() }).strict(),
  "review-reply": z.object({ reviewId: z.string().uuid(), reply: z.string().min(2).max(1000) }).strict(),
  propose: z.object({ title: z.string().min(3).max(120), summary: z.string().min(10).max(500), carrierOrgId: z.string().uuid(), audience: z.string().min(3).max(200), baseProductCode: z.enum(["RAIN01", "WIND01", "KASKO", "PROPERTY"]) }).strict(),
  "submit-product": z.object({ productId: z.string().uuid() }).strict(),
  profile: z.object({ description: z.string().max(1000), specialization: z.string().max(200), territory: z.string().max(200), languages: z.string().max(100), responseMode: z.string().max(100) }).strict(),
  exception: z.object({ id: z.string().uuid(), action: z.enum(["ASSIGN_ME", "NOTE", "RESOLVE"]), note: z.string().max(1000).default("") }).strict(),
};

export const POST = api({}, async ({ req, ctx, params }) => {
  const a = asAgency(ctx);
  const schema = S[params.action];
  if (!schema) throw err("NOT_FOUND", "Неизвестное действие");
  const p = schema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) throw err("VALIDATION", "Проверьте поля", { fields: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const b: any = p.data;
  switch (params.action) {
    case "calc": return calculator(a, b.requestId, b.productId, b.deductibleRub);
    case "quote": {
      const { idempotency_key, ...rest } = b;
      const r = await withIdempotency(a.user.id, "quote.submit", idempotency_key, rest, () => submitQuote({ orgId: a.orgId, userId: a.user.id, correlationId: a.correlationId, role: a.role === "AGENCY_OWNER" ? "OWNER" : "AGENT" }, { ...rest, via: "MANUAL" }).then((x) => ({ quoteId: x.quote.id, status: x.quote.status, totalKop: x.quote.totalKop, extended: x.extended, draftReason: x.draftReason })));
      return r.result;
    }
    case "withdraw": return withdrawQuote(a, b.quoteId, b.reason);
    case "publish-draft": { const r = await publishDraftQuote(a, b.quoteId); return { quoteId: r.quote.id, status: r.quote.status }; }
    case "automation": return saveRule(a, b);
    case "invite": {
      if (a.role !== "AGENCY_OWNER") throw err("FORBIDDEN", "Команду управляет владелец");
      const sub = await db.subscription.findUniqueOrThrow({ where: { organizationId: a.orgId } });
      const plan = await db.plan.findUniqueOrThrow({ where: { id: sub.planId } });
      const count = await db.membership.count({ where: { organizationId: a.orgId, status: "ACTIVE" } });
      if (count >= plan.maxUsers) throw err("LIMIT_EXCEEDED", `Тариф «${plan.title}» допускает ${plan.maxUsers} польз.`);
      if (b.role === "AGENCY_OWNER" && !(await planAllows(db, a.orgId, "roles"))) throw err("FORBIDDEN", "Роли доступны на тарифе «Команда»");
      let u = await db.user.findUnique({ where: { email: b.email.toLowerCase() } });
      if (u && u.kind === "CLIENT") throw err("CONFLICT", "Этот email принадлежит клиенту");
      const tmp = randomToken(9);
      if (!u) u = await db.user.create({ data: { email: b.email.toLowerCase(), name: b.name, kind: "STAFF", passwordHash: await hashPassword(tmp), emailVerifiedAt: new Date() } });
      await db.membership.create({ data: { userId: u.id, organizationId: a.orgId, role: b.role } });
      await adapters.messaging.email(db, { userId: u.id, to: u.email, subject: "Приглашение в команду агентства", body: `Вас добавили в агентство. Временный пароль: ${tmp} (смените через «Восстановить пароль»).`, category: "SERVICE" });
      await audit(db, actor(a), "team.invite", "Membership", u.id, { after: { email: b.email, role: b.role } });
      return { ok: true };
    }
    case "assign": {
      const m = await db.membership.findFirst({ where: { userId: b.agentUserId, organizationId: a.orgId, status: "ACTIVE" } });
      if (!m) throw err("NOT_FOUND", "Сотрудник не найден");
      const has = await db.policy.count({ where: { clientId: b.clientId, agencyOrgId: a.orgId } }) + await db.checkout.count({ where: { clientId: b.clientId, agencyOrgId: a.orgId } });
      if (!has) throw err("NOT_FOUND", "Клиент не найден");
      await db.$transaction([
        db.clientAssignment.updateMany({ where: { agencyOrgId: a.orgId, clientId: b.clientId, toAt: null }, data: { toAt: new Date() } }),
        db.clientAssignment.create({ data: { agencyOrgId: a.orgId, clientId: b.clientId, agentUserId: b.agentUserId, reason: b.reason } }),
        db.policy.updateMany({ where: { clientId: b.clientId, agencyOrgId: a.orgId }, data: { servicingAgentId: b.agentUserId } }),
      ]);
      await audit(db, actor(a), "client.assigned", "User", b.clientId, { after: { agent: b.agentUserId }, reason: b.reason });
      return { ok: true };
    }
    case "task-done": { const r = await db.task.updateMany({ where: { id: b.taskId, organizationId: a.orgId }, data: { status: "DONE" } }); if (!r.count) throw err("NOT_FOUND", "Задача не найдена"); return { ok: true }; }
    case "review-reply": return replyReview(a, b.reviewId, b.reply);
    case "propose": return proposeProduct(a, b);
    case "submit-product": return transitionProduct(a, b.productId, "SUBMITTED_TO_CARRIER", "Агентство направило продукт страховщику");
    case "profile": {
      if (a.role !== "AGENCY_OWNER") throw err("FORBIDDEN", "Профиль меняет владелец");
      await db.organization.update({ where: { id: a.orgId }, data: b });
      await audit(db, actor(a), "org.profile", "Organization", a.orgId, { after: b });
      return { ok: true };
    }
    case "exception": return exceptionAction(a, b.id, b.action, b.note);
  }
});
