import { PrismaClient, Prisma } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient };
export const db: PrismaClient = g.__prisma ?? new PrismaClient({ log: ["error"] });
if (process.env.NODE_ENV !== "production") g.__prisma = db;

export type Tx = Prisma.TransactionClient;
export { Prisma };

/** Транзакция Serializable с ограниченными повторами при конфликте (P2034 / 40001). */
export async function txRetry<T>(fn: (tx: Tx) => Promise<T>, opts: { retries?: number; isolation?: Prisma.TransactionIsolationLevel } = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  let attempt = 0;
  for (;;) {
    try {
      return await db.$transaction(fn, { isolationLevel: opts.isolation ?? Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000, maxWait: 10000 });
    } catch (e: any) {
      const code = e?.code ?? e?.meta?.code;
      const retriable = code === "P2034" || code === "40001" || code === "40P01" || /could not serialize|deadlock/i.test(String(e?.message));
      if (!retriable || attempt >= retries) throw e;
      attempt++;
      await new Promise((r) => setTimeout(r, 20 * 2 ** attempt + Math.random() * 20));
    }
  }
}
