import { db, type Tx } from "./db";

export type Actor = { userId?: string | null; orgId?: string | null; role?: string | null; correlationId?: string | null };
export const SYSTEM: Actor = { userId: null, role: "SYSTEM" };

const SENSITIVE = /password|code|otp|secret|token|card|cvv|passport/i;
function scrub(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(scrub);
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, SENSITIVE.test(k) ? "[скрыто]" : scrub(val)]));
}

export async function audit(tx: Tx | typeof db, actor: Actor, action: string, entityType: string, entityId: string | null, data: { before?: unknown; after?: unknown; reason?: string } = {}) {
  await tx.auditLog.create({
    data: {
      actorUserId: actor.userId ?? null, actorOrgId: actor.orgId ?? null, actorRole: actor.role ?? null,
      action, entityType, entityId, before: (scrub(data.before) ?? undefined) as any, after: (scrub(data.after) ?? undefined) as any,
      reason: data.reason, correlationId: actor.correlationId ?? null,
    },
  });
}

/** Структурированный журнал без персональных данных. */
export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(scrub(fields) as object) });
  if (level === "error") console.error(line); else if (process.env.LOG_QUIET !== "1") console.log(line);
}
