import { z } from "zod";
import { api } from "@/server/api";
import { asClient } from "@/server/access";
import { err } from "@/server/errors";
import { confirmFields, publishRequest, cancelRequest, applySuggestion, repeatRequest } from "@/server/domain/requests";
import { offersForClient } from "@/server/domain/auction";
import { uploadFile } from "@/server/domain/documents";

const S = {
  confirm: z.object({ keys: z.array(z.string().max(60)).min(1).max(40), version: z.number().int() }).strict(),
  publish: z.object({ version: z.number().int() }).strict(),
  cancel: z.object({}).strict(),
  repeat: z.object({ toSameAgency: z.boolean() }).strict(),
  suggestion: z.object({ documentId: z.string().uuid(), key: z.string().max(60), version: z.number().int() }).strict(),
};

export const GET = api({}, async ({ ctx, params }) => {
  const c = asClient(ctx);
  if (params.action !== "offers") throw err("NOT_FOUND", "Нет такого ресурса");
  return offersForClient(c, params.id);
});

export const POST = api({ csrf: true }, async ({ req, ctx, params }) => {
  const c = asClient(ctx);
  if (params.action === "upload") {
    const form = await req.formData().catch(() => { throw err("VALIDATION", "Ожидается multipart/form-data"); });
    const f = form.get("file");
    if (!(f instanceof File)) throw err("VALIDATION", "Файл не передан");
    if (f.size > 15 * 1024 * 1024) throw err("VALIDATION", "Файл больше 15 МБ");
    const { getOwnRequest } = await import("@/server/domain/requests");
    const { db } = await import("@/server/db");
    await getOwnRequest(db, c, params.id);
    const d = await uploadFile(c, { requestId: params.id }, { name: f.name, mime: f.type, buf: Buffer.from(await f.arrayBuffer()) });
    return { id: d.id, status: d.status };
  }
  const schema = (S as any)[params.action];
  if (!schema) throw err("NOT_FOUND", "Неизвестное действие");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw err("VALIDATION", "Проверьте поля", { fields: parsed.error.issues.map((i: any) => ({ path: i.path.join("."), message: i.message })) });
  const b = parsed.data;
  switch (params.action) {
    case "repeat": { const r = await repeatRequest(c, params.id, b); return { id: r.id }; }
    case "confirm": { const r = await confirmFields(c, params.id, b.keys, b.version); return { version: r.version, confirmed: r.confirmed }; }
    case "publish": return publishRequest(c, params.id, b.version);
    case "cancel": { await cancelRequest(c, params.id); return { ok: true }; }
    case "suggestion": { const r = await applySuggestion(c, params.id, b.documentId, b.key, b.version); return { version: r.version, data: r.data, confirmed: r.confirmed }; }
  }
});
