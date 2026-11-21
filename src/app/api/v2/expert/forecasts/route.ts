import { z } from "zod";
import { api } from "@/server/api";
import { asClient } from "@/server/access";
import { err } from "@/server/errors";
import * as EV from "@/server/ev/service";
import { uuid } from "@/server/ev/http";

const S = z.object({ marketId: uuid, probabilityPct: z.number().int().min(0).max(100), method: z.string().trim().min(10).max(1000), note: z.string().max(2000).optional() }).strict();
/** Прогноз — новая неизменяемая версия; правка задним числом невозможна. */
export const POST = api({ schema: S }, async ({ ctx, body }) => { const { probabilityPct, ...rest } = body; const r = await EV.publishForecast(asClient(ctx), { ...rest, probabilityBp: probabilityPct * 100 }); return { id: r.id, version: r.version }; });
export const GET = api({ auth: false }, async ({ query }) => { const id = query.get("marketId"); if (!id) throw err("VALIDATION", "marketId is required"); return { items: await EV.publicForecasts(id) }; });
