import { z } from "zod";
import { api } from "@/server/api";
import { asClient } from "@/server/access";
import { saveDraft, getOwnRequest } from "@/server/domain/requests";
import { db } from "@/server/db";

export const GET = api({}, async ({ ctx, params }) => {
  const c = asClient(ctx);
  const r = await getOwnRequest(db, c, params.id);
  return { id: r.id, status: r.status, version: r.version, data: r.data, confirmed: r.confirmed, currentVersion: r.currentVersion };
});

/** Автосохранение черновика: только поля схемы; version — оптимистическая блокировка. */
export const PATCH = api({ schema: z.object({ data: z.record(z.any()), version: z.number().int() }).strict() }, async ({ ctx, params, body }) => {
  const c = asClient(ctx);
  const r = await saveDraft(c, params.id, body);
  return { version: r.request.version, status: r.request.status, issues: r.issues, invalidatedQuotes: r.invalidatedQuotes, requiresRepublish: r.requiresRepublish, confirmed: r.request.confirmed };
});
