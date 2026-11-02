import { db, type Tx } from "../db";
import { notifyPlatformRole } from "./notify";

export type ExceptionInput = {
  type: "DATA" | "CALCULATION" | "CHECKOUT" | "PAYMENT" | "OBSERVATION" | "PAYOUT" | "AUTOMATION" | "DISPUTE" | "CLAIM";
  priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  entityType: string;
  entityId: string;
  reason: string;
  nextAction: string;
  dueAt: Date;
  dedupeKey?: string;
  organizationId?: string | null;
  assigneeId?: string | null;
};

/** Очередь исключений: перевод в ручную работу не является финальным решением и не теряет срок. */
export async function raiseException(tx: Tx | typeof db, e: ExceptionInput) {
  if (e.dedupeKey) {
    const existing = await tx.exceptionItem.findUnique({ where: { dedupeKey: e.dedupeKey } });
    if (existing) return existing;
  }
  const item = await tx.exceptionItem.create({
    data: { type: e.type, priority: e.priority ?? "NORMAL", entityType: e.entityType, entityId: e.entityId, reason: e.reason, nextAction: e.nextAction, dueAt: e.dueAt, dedupeKey: e.dedupeKey, organizationId: e.organizationId ?? null, assigneeId: e.assigneeId ?? null, actions: [{ at: new Date().toISOString(), by: "SYSTEM", action: "Создано", note: e.reason }] },
  });
  if (!e.organizationId) await notifyPlatformRole(tx, "SUPPORT", { type: "exception.created", title: "Новое исключение в очереди", body: e.reason, link: `/admin/exceptions/${item.id}` });
  return item;
}

export async function addExceptionAction(tx: Tx | typeof db, id: string, by: string, action: string, note?: string) {
  const ex = await tx.exceptionItem.findUniqueOrThrow({ where: { id } });
  const actions = [...((ex.actions as any[]) ?? []), { at: new Date().toISOString(), by, action, note }];
  return tx.exceptionItem.update({ where: { id }, data: { actions, version: { increment: 1 } } });
}
