import { z } from "zod";
import { api, idemKey } from "@/server/api";
import { asClient } from "@/server/access";
import { selectQuote } from "@/server/domain/checkout";
import { withIdempotency } from "@/server/idempotency";

/** Выбор предложения: request_id, request_version, quote_id, quote_version, idempotency_key → checkout_id, reservation_expires_at, status. */
export const POST = api({ schema: z.object({ request_id: z.string().uuid(), request_version: z.number().int(), quote_id: z.string().uuid(), quote_version: z.number().int(), idempotency_key: idemKey, reason: z.string().max(300).optional() }).strict() }, async ({ ctx, body }) => {
  const c = asClient(ctx);
  const { idempotency_key, ...rest } = body;
  const { result } = await withIdempotency(c.user.id, "checkout.select", idempotency_key, rest, () => selectQuote(c, { requestId: body.request_id, requestVersion: body.request_version, quoteId: body.quote_id, quoteVersion: body.quote_version, reason: body.reason }));
  return result;
});
