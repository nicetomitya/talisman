import { z } from "zod";
import { api } from "@/server/api";
import { err } from "@/server/errors";
import * as EV from "@/server/ev/service";
import { usdToCents } from "@/server/ev/http";

const Q = z.object({ side: z.enum(["YES", "NO"]).default("YES"), targetPayoutUsd: usdToCents }).strict();
/** Котировка по глубине симулированного стакана; каждая содержит площадку, время и срок актуальности. */
export const GET = api({ auth: false }, async ({ query, params }) => {
  const p = Q.safeParse(Object.fromEntries(query));
  if (!p.success) throw err("VALIDATION", "Check the amount", { fields: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  if (p.data.targetPayoutUsd < 100 || p.data.targetPayoutUsd > 1_000_000_00) throw err("VALIDATION", "Payout must be between $1 and $1,000,000");
  return EV.quote(params.id, p.data.side, p.data.targetPayoutUsd);
});
