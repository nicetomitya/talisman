import { z } from "zod";
import { api } from "@/server/api";
import { asAdmin } from "@/server/access";
import { err } from "@/server/errors";
import * as EV from "@/server/ev/service";
import { decimalX100, uuid } from "@/server/ev/http";

const reason = z.string().trim().min(5, "Give a reason").max(2000);
const S: Record<string, z.ZodTypeAny> = {
  "market-status": z.object({ marketId: uuid, toStatus: z.enum(["OPEN", "SUSPENDED", "CLOSED"]), reason }).strict(),
  "market-terms": z.object({ marketId: uuid, threshold: decimalX100, reason }).strict(),
  observe: z.object({ marketId: uuid }).strict(),
  finalize: z.object({ marketId: uuid, reason, outcome: z.enum(["YES", "NO"]).optional() }).strict(),
  "expert-moderate": z.object({ userId: uuid, to: z.enum(["APPROVED", "REJECTED"]), reason }).strict(),
  "liquidity-provider": z.object({ userId: uuid, status: z.enum(["NONE", "APPROVED"]), reason }).strict(),
  "conflict-restriction": z.object({ declarationId: uuid, restriction: z.enum(["ALLOWED", "MANUAL_REVIEW", "BLOCKED"]), reason }).strict(),
  tier: z.object({ userId: uuid, tier: z.enum(["T1", "T2", "T3"]).nullable(), reason }).strict(),
  outage: z.object({ on: z.boolean() }).strict(),
  "venue-event": z.object({ eventId: z.string().min(4).max(100), type: z.literal("RESOLUTION_CONFIRMED"), marketId: uuid, outcome: z.enum(["YES", "NO"]) }).strict(),
};

export const POST = api({}, async ({ req, ctx, params }) => {
  const a = asAdmin(ctx, { mutation: true });
  const schema = S[params.action];
  if (!schema) throw err("NOT_FOUND", "Unknown action");
  const p = schema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) throw err("VALIDATION", "Check the fields", { fields: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const b: any = p.data;
  switch (params.action) {
    case "market-status": return EV.setMarketStatus(a, b.marketId, b.toStatus, b.reason);
    case "market-terms": return EV.updateMarketTerms(a, b.marketId, { thresholdX100: b.threshold }, b.reason);
    case "observe": { const r = await EV.observeAndPropose(a, b.marketId); return { status: r.status, outcome: r.outcome }; }
    case "finalize": { const r = await EV.finalizeResolution(a, b.marketId, b.reason, b.outcome); return { status: r.resolution.status, settled: r.settled }; }
    case "expert-moderate": await EV.moderateExpert(a, b.userId, b.to, b.reason); return { ok: true };
    case "liquidity-provider": await EV.setLiquidityProvider(a, b.userId, b.status, b.reason); return { ok: true };
    case "conflict-restriction": await EV.setConflictRestriction(a, b.declarationId, b.restriction, b.reason); return { ok: true };
    case "tier": await EV.setTier(a, b.userId, b.tier, b.reason); return { ok: true };
    case "outage": await EV.setVenueOutage(a, b.on); return { ok: true };
    case "venue-event": return EV.ingestVenueEvent(b, a);
  }
});
