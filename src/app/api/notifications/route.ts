import { z } from "zod";
import { api } from "@/server/api";
import { db } from "@/server/db";
import { err } from "@/server/errors";

export const POST = api({ schema: z.object({ ids: z.array(z.string().uuid()).max(200).optional(), all: z.boolean().optional() }).strict() }, async ({ ctx, body }) => {
  if (!ctx) throw err("UNAUTHENTICATED", "Войдите");
  const r = await db.notification.updateMany({ where: { userId: ctx.user.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) }, data: { readAt: new Date() } });
  return { updated: r.count };
});
