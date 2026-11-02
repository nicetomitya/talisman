import { createHash } from "node:crypto";
import { db } from "./db";
import { AppError, err } from "./errors";

export function hashBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body ?? null)).digest("hex");
}
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + stableStringify((v as any)[k])).join(",") + "}";
}

/**
 * Идемпотентное выполнение команды. Повтор с тем же ключом и телом возвращает сохранённый результат;
 * тот же ключ с другим телом — CONFLICT. Ошибки не сохраняются (отклонённая операция может быть повторена).
 */
export async function withIdempotency<T>(userId: string, scope: string, key: string | undefined | null, body: unknown, fn: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
  if (!key || key.length < 8 || key.length > 200) throw err("VALIDATION", "Нужен idempotency_key (8–200 символов)");
  const bodyHash = hashBody(body);
  const existing = await db.idempotencyRecord.findUnique({ where: { userId_scope_key: { userId, scope, key } } });
  if (existing) {
    if (existing.bodyHash !== bodyHash) throw err("CONFLICT", "Этот ключ идемпотентности уже использован с другими данными");
    return { result: existing.response as T, replayed: true };
  }
  const result = await fn();
  try {
    await db.idempotencyRecord.create({ data: { userId, scope, key, bodyHash, status: 200, response: (result ?? null) as any } });
  } catch (e: any) {
    if (e?.code !== "P2002") throw e;
    const again = await db.idempotencyRecord.findUnique({ where: { userId_scope_key: { userId, scope, key } } });
    if (again && again.bodyHash !== bodyHash) throw err("CONFLICT", "Ключ идемпотентности использован с другими данными");
    return { result: again!.response as T, replayed: true };
  }
  return { result, replayed: false };
}

export { AppError };
