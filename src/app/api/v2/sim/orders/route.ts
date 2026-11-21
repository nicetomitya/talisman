import { z } from "zod";
import { api, idemKey } from "@/server/api";
import { asClient } from "@/server/access";
import * as EV from "@/server/ev/service";
import { usdToCents, uuid } from "@/server/ev/http";

/**
 * Бумажная позиция против симулированного стакана. Строгая схема: нельзя передать режим live, контрагента,
 * цену или исполнение — только то, что подтвердил человек. Реальных ордеров в этой сборке нет вовсе.
 */
const S = z.object({
  marketId: uuid, side: z.enum(["YES", "NO"]), targetPayoutUsd: usdToCents, quoteSnapshotId: uuid, termsHash: z.string().min(8).max(64),
  riskIntentId: uuid.nullable().optional(), allowPartial: z.boolean().default(false),
  confirm: z.literal(true, { errorMap: () => ({ message: "Confirm that you understand this is a simulated position" }) }),
  idempotencyKey: idemKey,
}).strict();

export const POST = api({ schema: S }, async ({ ctx, body }) => {
  const c = asClient(ctx);
  const { targetPayoutUsd, ...rest } = body;
  const r = await EV.placeSimOrder(c, { ...rest, targetPayoutCents: targetPayoutUsd });
  return { ...r.result, replayed: r.replayed };
});
