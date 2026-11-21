import { z } from "zod";
import { api } from "@/server/api";
import { asClient } from "@/server/access";
import * as EV from "@/server/ev/service";

// Строгая схема: статус модерации и статус поставщика ликвидности назначить себе нельзя (крит. 17).
const S = z.object({ displayName: z.string().trim().min(3).max(120), tags: z.array(z.string().trim().min(2).max(40)).max(10), credentials: z.string().trim().min(10).max(2000), disclosures: z.string().trim().min(10).max(2000), conflicts: z.string().max(2000).optional() }).strict();
export const POST = api({ schema: S }, async ({ ctx, body }) => { const p = await EV.upsertExpertProfile(asClient(ctx), body); return { id: p.id, moderationStatus: p.moderationStatus }; });
export const GET = api({}, async ({ ctx }) => EV.expertDashboard(asClient(ctx)));
