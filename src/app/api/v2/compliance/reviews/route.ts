import { z } from "zod";
import { api } from "@/server/api";
import * as EV from "@/server/ev/service";
import { uuid } from "@/server/ev/http";

const S = z.object({ marketId: uuid, toStatus: z.enum(["SIM_ALLOWED", "RESTRICTED", "RESEARCH_ONLY", "BLOCKED"]), reason: z.string().trim().min(10, "Give the basis for the decision").max(2000) }).strict();
/** Изменение комплаенс-статуса рынка: кто, когда и на каком основании — в ComplianceReview и аудите (крит. 26). */
export const POST = api({ schema: S }, async ({ ctx, body }) => { const r = await EV.setCompliance(ctx!, body.marketId, body.toStatus, body.reason); return { reviewId: r.id }; });
