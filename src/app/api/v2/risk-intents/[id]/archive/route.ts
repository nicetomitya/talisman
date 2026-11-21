import { z } from "zod";
import { api } from "@/server/api";
import * as EV from "@/server/ev/service";
import { ownerFrom } from "@/server/ev/http";

export const POST = api({ auth: false, schema: z.object({}).strict() }, async ({ req, ctx, params }) => { await EV.archiveIntent(ownerFrom(req, ctx).owner, params.id, ctx); return { ok: true }; });
