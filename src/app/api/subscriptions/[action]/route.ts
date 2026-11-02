import { z } from "zod";
import { api, idemKey } from "@/server/api";
import { asAgency } from "@/server/access";
import { err } from "@/server/errors";
import { payInvoice, cancelAutoRenew, enableAutoRenew, changePlan, applyPromo } from "@/server/domain/subscriptions";
import { withIdempotency } from "@/server/idempotency";

const S: Record<string, z.ZodTypeAny> = {
  pay: z.object({ invoiceId: z.string().uuid(), idempotency_key: idemKey }).strict(),
  "cancel-renewal": z.object({}).strict(),
  "enable-renewal": z.object({ confirm: z.boolean() }).strict(),
  "change-plan": z.object({ planCode: z.enum(["START", "PRO", "TEAM"]) }).strict(),
  promo: z.object({ invoiceId: z.string().uuid(), code: z.string().min(3).max(40) }).strict(),
};

export const POST = api({}, async ({ req, ctx, params }) => {
  const a = asAgency(ctx, { owner: true });
  const schema = S[params.action];
  if (!schema) throw err("NOT_FOUND", "Неизвестное действие");
  const p = schema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) throw err("VALIDATION", "Проверьте поля");
  const b: any = p.data;
  switch (params.action) {
    case "pay": return (await withIdempotency(a.user.id, "subscription.pay", b.idempotency_key, { invoiceId: b.invoiceId }, () => payInvoice(a, b.invoiceId, b.idempotency_key))).result;
    case "cancel-renewal": return cancelAutoRenew(a);
    case "enable-renewal": return enableAutoRenew(a, b.confirm);
    case "change-plan": return changePlan(a, b.planCode);
    case "promo": return applyPromo(a, b.invoiceId, b.code);
  }
});
