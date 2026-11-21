import { z } from "zod";
import { api } from "@/server/api";
import { asClient } from "@/server/access";
import * as EV from "@/server/ev/service";

const S = z.object({ reason: z.string().trim().min(10, "Explain what looks wrong (at least 10 characters)").max(2000) }).strict();
export const POST = api({ schema: S }, async ({ ctx, params, body }) => { const r = await EV.disputeResolution(asClient(ctx), params.id, body.reason); return { status: r.status }; });
