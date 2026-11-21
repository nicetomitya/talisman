import { z } from "zod";
import { api } from "@/server/api";
import { asClient } from "@/server/access";
import * as EV from "@/server/ev/service";
import { RELATIONSHIPS } from "@/server/ev/limits";

const S = z.object({ objectKey: z.string().min(3).max(120), relationship: z.enum(RELATIONSHIPS), detail: z.string().max(1000).optional() }).strict();
export const POST = api({ schema: S }, async ({ ctx, body }) => EV.declareConflict(asClient(ctx), body.objectKey, body.relationship, body.detail));
