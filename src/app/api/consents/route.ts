import { z } from "zod";
import { api } from "@/server/api";
import { err } from "@/server/errors";
import { setConsent } from "@/server/domain/consents";
import { actor } from "@/server/access";

export const POST = api({ schema: z.object({ purpose: z.enum(["MARKETING", "COOKIES_ANALYTICS", "PD_PROCESSING", "TERMS"]), granted: z.boolean() }).strict() }, async ({ ctx, body }) => {
  if (!ctx) throw err("UNAUTHENTICATED", "Войдите");
  const c = await setConsent({ ...actor(ctx), userId: ctx.user.id }, body.purpose, body.granted, "settings");
  return { id: c.id, granted: c.granted };
});
