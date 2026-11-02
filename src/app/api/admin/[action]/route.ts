import { z } from "zod";
import { api } from "@/server/api";
import { asAdmin, actor } from "@/server/access";
import { err } from "@/server/errors";
import * as A from "@/server/domain/admin";
import { reconcile } from "@/server/domain/payments";
import { specialistRecollect } from "@/server/domain/events";
import { moderateReview } from "@/server/domain/reviews";
import { db } from "@/server/db";
import { audit } from "@/server/audit";

type Def = { schema: z.ZodTypeAny; carrier?: boolean; support?: boolean; run: (ctx: any, b: any) => Promise<unknown> };
const D: Record<string, Def> = {
  "verify-org": { schema: z.object({ orgId: z.string().uuid(), decision: z.enum(["VERIFIED", "REJECTED"]), validDays: z.number().int().min(1).max(730).default(365), note: z.string().min(3).max(500) }).strict(), run: (c, b) => A.verifyOrganization(c, b.orgId, b.decision, b.validDays, b.note) },
  "block-org": { schema: z.object({ orgId: z.string().uuid(), reason: z.string().min(5).max(500) }).strict(), run: (c, b) => A.blockOrganization(c, b.orgId, b.reason) },
  "unblock-org": { schema: z.object({ orgId: z.string().uuid() }).strict(), run: (c, b) => A.unblockOrganization(c, b.orgId) },
  "create-mandate": { carrier: true, schema: z.object({ agencyOrgId: z.string().uuid(), productId: z.string().uuid(), validDays: z.number().int().min(1).max(730) }).strict(), run: (c, b) => A.createMandate(c, b) },
  "revoke-mandate": { carrier: true, schema: z.object({ mandateId: z.string().uuid(), reason: z.string().min(3).max(300) }).strict(), run: (c, b) => A.revokeMandate(c, b.mandateId, b.reason) },
  "product-transition": { carrier: true, schema: z.object({ productId: z.string().uuid(), to: z.string().max(40), note: z.string().max(300).default("") }).strict(), run: (c, b) => A.transitionProduct(c, b.productId, b.to, b.note) },
  "request-approval": { schema: z.object({ action: z.enum(["TARIFF_CHANGE", "FINANCIAL_ADJUSTMENT", "PAYOUT_RULE_CHANGE"]), payload: z.record(z.any()), reason: z.string().min(10).max(500) }).strict(), run: (c, b) => A.requestApproval(c, b.action, b.payload, b.reason) },
  "decide-approval": { schema: z.object({ id: z.string().uuid(), approve: z.boolean(), reason: z.string().min(5).max(500) }).strict(), run: (c, b) => A.decideApproval(c, b.id, b.approve, b.reason) },
  suspend: { carrier: true, schema: z.object({ scope: z.enum(["CARRIER", "PRODUCT", "TERRITORY", "DATA_SOURCE"]), target: z.string().min(1).max(100), reason: z.string().min(5).max(300) }).strict(), run: (c, b) => A.setSuspension(c, b) },
  "lift-suspension": { schema: z.object({ id: z.string().uuid() }).strict(), run: (c, b) => A.liftSuspension(c, b.id) },
  exception: { support: true, carrier: true, schema: z.object({ id: z.string().uuid(), action: z.enum(["ASSIGN_ME", "NOTE", "WAITING_INFO", "RESOLVE"]), note: z.string().max(1000).default("") }).strict(), run: (c, b) => A.exceptionAction(c, b.id, b.action, b.note) },
  recollect: { support: true, carrier: true, schema: z.object({ eventCheckId: z.string().uuid(), reason: z.string().min(3).max(300) }).strict(), run: (c, b) => specialistRecollect(c, b.eventCheckId, b.reason) },
  reconcile: { support: true, schema: z.object({}).strict(), run: () => reconcile() },
  "support-access": { support: true, schema: z.object({ targetType: z.enum(["Document", "Client"]), targetId: z.string().uuid(), reason: z.string().min(10).max(300), minutes: z.number().int().min(5).max(60) }).strict(), run: (c, b) => A.grantSupportAccess(c, b) },
  "hide-review": { schema: z.object({ id: z.string().uuid(), reason: z.enum(["PERSONAL_DATA", "OFFENSIVE", "NOT_ABOUT_SERVICE"]) }).strict(), run: (c, b) => moderateReview(c, b.id, b.reason) },
  "commission-status": { schema: z.object({ id: z.string().uuid(), status: z.enum(["CONFIRMED", "RECEIVED"]) }).strict(), run: async (c, b) => { const r = await db.commission.update({ where: { id: b.id }, data: { status: b.status } }); await audit(db, actor(c), "commission.status", "Commission", b.id, { after: { status: b.status } }); return r; } },
};

export const POST = api({}, async ({ req, ctx, params }) => {
  const d = D[params.action];
  if (!d) throw err("NOT_FOUND", "Неизвестное действие");
  const a = asAdmin(ctx, { mutation: true, allowCarrier: d.carrier, allowSupport: d.support });
  const p = d.schema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) throw err("VALIDATION", "Проверьте поля", { fields: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  return (await d.run(a, p.data)) ?? { ok: true };
});
