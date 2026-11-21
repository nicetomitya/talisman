import { z } from "zod";
import { api } from "@/server/api";
import * as EV from "@/server/ev/service";
import { ownerFrom } from "@/server/ev/http";

const S = z.object({ version: z.number().int(), confirm: z.literal(true, { errorMap: () => ({ message: "Confirm that the summary is correct" }) }) }).strict();
/** Подтверждение человеком сводки условий → неизменяемое EventDefinition. Это не покупка и не листинг. */
export const POST = api({ auth: false, schema: S }, async ({ req, ctx, params, body }) => EV.confirmIntent(ownerFrom(req, ctx).owner, params.id, body.version, ctx));
