import { z } from "zod";
import { api } from "@/server/api";
import { asClient, machineRole } from "@/server/access";
import { err } from "@/server/errors";
import { submitClaim, staffClaimAction, openDispute } from "@/server/domain/claims";
import { uploadFile } from "@/server/domain/documents";
import { db } from "@/server/db";

export const POST = api({}, async ({ req, ctx, params }) => {
  if (!ctx) throw err("UNAUTHENTICATED", "Войдите");
  const a = params.action;
  if (a === "upload") {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw err("VALIDATION", "Файл не передан");
    const claim = ctx.user.kind === "CLIENT" ? await db.claim.findFirst({ where: { id: params.id, clientId: ctx.user.id } }) : await db.claim.findFirst({ where: { id: params.id, agencyOrgId: ctx.org?.orgId ?? "00000000-0000-0000-0000-000000000000" } });
    if (!claim) throw err("NOT_FOUND", "Обращение не найдено");
    const d = await uploadFile(ctx, { claimId: claim.id }, { name: f.name, mime: f.type, buf: Buffer.from(await f.arrayBuffer()) }, "UPLOAD");
    return { id: d.id };
  }
  const body = await req.json().catch(() => ({}));
  if (a === "submit") return submitClaim(asClient(ctx), params.id);
  if (a === "dispute") {
    const p = z.object({ reason: z.string().min(10).max(2000) }).strict().safeParse(body);
    if (!p.success) throw err("VALIDATION", "Опишите причину (не короче 10 символов)");
    return openDispute(asClient(ctx), { claimId: params.id, reason: p.data.reason });
  }
  if (a === "staff") {
    const role = machineRole(ctx);
    if (!["AGENT", "OWNER", "CARRIER", "ADMIN"].includes(role)) throw err("FORBIDDEN", "Нет прав");
    if (role === "ADMIN" && !ctx.mfa) throw err("MFA_REQUIRED", "Нужен второй фактор");
    const p = z.object({ action: z.enum(["START_REVIEW", "REQUEST_INFO", "PREPARE_APPROVE", "PREPARE_REJECT", "APPROVE", "REJECT", "CLOSE", "REOPEN"]), note: z.string().max(2000).optional(), amountKop: z.number().int().positive().optional() }).strict().safeParse(body);
    if (!p.success) throw err("VALIDATION", "Проверьте поля");
    return staffClaimAction(ctx, params.id, p.data.action, p.data);
  }
  throw err("NOT_FOUND", "Неизвестное действие");
});
