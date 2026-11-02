import { z } from "zod";
import { api, idemKey } from "@/server/api";
import { asClient } from "@/server/access";
import { err } from "@/server/errors";
import { prepareDocuments, acknowledge, requestCode, verifyCode, createPremiumPayment, cancelCheckout, getOwnCheckout } from "@/server/domain/checkout";
import { withIdempotency } from "@/server/idempotency";
import { db } from "@/server/db";

const S: Record<string, z.ZodTypeAny> = {
  prepare: z.object({}).strict(),
  ack: z.object({ documentId: z.string().uuid() }).strict(),
  code: z.object({}).strict(),
  verify: z.object({ code: z.string().regex(/^\d{6}$/, "6 цифр") }).strict(),
  pay: z.object({ idempotency_key: idemKey }).strict(),
  cancel: z.object({ reason: z.string().max(300).default("") }).strict(),
};

export const GET = api({}, async ({ ctx, params }) => {
  const c = asClient(ctx);
  if (params.action !== "status") throw err("NOT_FOUND", "Нет ресурса");
  const ch = await getOwnCheckout(db, c, params.id);
  const payments = await db.payment.findMany({ where: { checkoutId: ch.id }, orderBy: { createdAt: "asc" }, select: { id: true, status: true, amountKop: true, createdAt: true } });
  const policy = await db.policy.findUnique({ where: { checkoutId: ch.id }, select: { id: true, number: true, contractStatus: true, startsAt: true } });
  return { status: ch.status, reservationExpiresAt: ch.reservationExpiresAt, payments, policy };
});

export const POST = api({}, async ({ req, ctx, params }) => {
  const c = asClient(ctx);
  const schema = S[params.action];
  if (!schema) throw err("NOT_FOUND", "Неизвестное действие");
  const p = schema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) throw err("VALIDATION", "Проверьте поля", { fields: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const b: any = p.data;
  switch (params.action) {
    case "prepare": return prepareDocuments(c, params.id);
    case "ack": return { acknowledgements: await acknowledge(c, params.id, b.documentId) };
    case "code": return requestCode(c, params.id);
    case "verify": return verifyCode(c, params.id, b.code);
    case "pay": return (await withIdempotency(c.user.id, `checkout.pay:${params.id}`, b.idempotency_key, {}, () => createPremiumPayment(c, params.id, b.idempotency_key))).result;
    case "cancel": return cancelCheckout(c, params.id, b.reason);
  }
});
