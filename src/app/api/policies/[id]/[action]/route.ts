import { z } from "zod";
import { api } from "@/server/api";
import { asClient } from "@/server/access";
import { err } from "@/server/errors";
import { terminationPreview, terminatePolicy, requestChange, startRenewal, reportBookingChange } from "@/server/domain/policies";
import { createClassicClaim, openDispute } from "@/server/domain/claims";
import { upsertReview } from "@/server/domain/reviews";

const S: Record<string, z.ZodTypeAny> = {
  "termination-preview": z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
  terminate: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reason: z.string().min(3).max(500), confirm: z.boolean() }).strict(),
  change: z.object({ description: z.string().min(5).max(1000) }).strict(),
  renew: z.object({}).strict(),
  "booking-change": z.object({ kind: z.enum(["CANCELLED", "DATE_CHANGED", "VENUE_CHANGED"]) }).strict(),
  claim: z.object({ eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string().min(10).max(4000), answers: z.record(z.string().max(300)).default({}) }).strict(),
  dispute: z.object({ reason: z.string().min(10).max(2000) }).strict(),
  review: z.object({ stage: z.enum(["SALE", "CLAIM"]), rating: z.number().int().min(1).max(5), text: z.string().min(3).max(2000) }).strict(),
};

export const POST = api({}, async ({ req, ctx, params }) => {
  const c = asClient(ctx);
  const schema = S[params.action];
  if (!schema) throw err("NOT_FOUND", "Неизвестное действие");
  const p = schema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) throw err("VALIDATION", "Проверьте поля", { fields: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const b: any = p.data;
  switch (params.action) {
    case "termination-preview": return terminationPreview(c, params.id, b.date);
    case "terminate": return terminatePolicy(c, params.id, b);
    case "change": return requestChange(c, params.id, b.description);
    case "renew": { const r = await startRenewal(c, params.id); return { requestId: r.id }; }
    case "booking-change": return reportBookingChange(c, params.id, b.kind);
    case "claim": { const r = await createClassicClaim(c, params.id, b); return { claimId: r.id }; }
    case "dispute": { const r = await openDispute(c, { policyId: params.id, reason: b.reason }); return { claimId: r.id }; }
    case "review": { const r = await upsertReview(c, { policyId: params.id, ...b }); return { id: r.id }; }
  }
});
