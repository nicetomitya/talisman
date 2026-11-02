import { db, type Tx } from "./db";

/** Постановка задания в той же транзакции, что и бизнес-изменение (transactional outbox). uniqueKey делает постановку идемпотентной. */
export async function enqueue(tx: Tx | typeof db, type: string, payload: Record<string, unknown>, opts: { runAt?: Date; uniqueKey?: string; maxAttempts?: number } = {}) {
  const runAt = opts.runAt ?? new Date(0);
  if (opts.uniqueKey) {
    const existing = await tx.job.findUnique({ where: { uniqueKey: opts.uniqueKey } });
    if (existing) {
      if (existing.status === "PENDING" && opts.runAt && existing.runAt.getTime() !== runAt.getTime()) {
        await tx.job.update({ where: { id: existing.id }, data: { runAt } });
      }
      return existing;
    }
  }
  return tx.job.create({ data: { type, payload: payload as any, runAt, uniqueKey: opts.uniqueKey, maxAttempts: opts.maxAttempts ?? 5 } });
}

export async function outbox(tx: Tx, topic: string, payload: Record<string, unknown>) {
  await tx.outbox.create({ data: { topic, payload: payload as any } });
}
