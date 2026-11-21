import { z } from "zod";
import { api } from "@/server/api";
import { rateLimit } from "@/server/auth/ratelimit";
import * as EV from "@/server/ev/service";
import { ownerFrom, withGuestCookie, ip } from "@/server/ev/http";

const S = z.object({ description: z.string().trim().min(5, "Describe the risk in a few words").max(2000) }).strict();

/** Создать черновик риска из свободного текста. Гость — без аккаунта (cookie). Никаких действий кроме извлечения полей. */
export const POST = api({ auth: false, schema: S }, async ({ req, ctx, body }) => {
  await rateLimit(`ev:intent:${ctx?.user.id ?? ip(req)}`, 30, 3600);
  const { owner, newToken } = ownerFrom(req, ctx, { create: true });
  return withGuestCookie(await EV.createIntent(owner, body.description, ctx), req, newToken);
});
export const GET = api({ auth: false }, async ({ req, ctx }) => {
  try { return { items: await EV.listIntents(ownerFrom(req, ctx).owner) }; } catch { return { items: [] }; }
});
