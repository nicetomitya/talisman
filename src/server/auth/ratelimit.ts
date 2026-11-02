import { db } from "../db";
import { err } from "../errors";

/** Ограничение частоты: фиксированное окно в PostgreSQL (переживает рестарт). */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / (windowSec * 1000)) * windowSec * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" = ${windowStart} THEN "RateLimit"."count" + 1 ELSE 1 END,
      "windowStart" = ${windowStart}
    RETURNING "count"`;
  if ((rows[0]?.count ?? 0) > limit) throw err("RATE_LIMITED", "Слишком много запросов", { retryAfterSec: windowSec });
}
