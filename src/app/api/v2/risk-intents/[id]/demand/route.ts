import { z } from "zod";
import { api } from "@/server/api";
import * as EV from "@/server/ev/service";
import { ownerFrom } from "@/server/ev/http";

const S = z.object({ kind: z.enum(["WATCH", "WAITLIST", "SUGGEST_SPEC"]), note: z.string().max(1000).optional() }).strict();
/** Интерес к рынку, которого нет: не оплата и не оферта (ТЗ v2, п. 6.2, 8.2). */
export const POST = api({ auth: false, schema: S }, async ({ req, ctx, params, body }) => EV.addDemand(ownerFrom(req, ctx).owner, params.id, body.kind, body.note));
