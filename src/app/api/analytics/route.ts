import { z } from "zod";
import { api } from "@/server/api";
import { db } from "@/server/db";
import { hasConsent } from "@/server/domain/notify";

/** Необязательная аналитика: событие записывается только при согласии (cookie и, для вошедших, запись согласия) (AC28). */
export const POST = api({ auth: false, schema: z.object({ name: z.string().max(60), path: z.string().max(200) }).strict() }, async ({ req, ctx, body }) => {
  const cookieOk = req.cookies.get("tcookie")?.value === "analytics";
  if (!cookieOk) return { recorded: false, reason: "no_cookie_consent" };
  if (ctx && !(await hasConsent(db, ctx.user.id, "COOKIES_ANALYTICS"))) return { recorded: false, reason: "no_consent" };
  await db.analyticsEvent.create({ data: { userId: ctx?.user.id ?? null, name: body.name, props: { path: body.path } } });
  return { recorded: true };
});
