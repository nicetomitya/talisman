import { db, type Tx } from "../db";
import { adapters } from "../adapters";
import { log } from "../audit";

type N = { type: string; title: string; body: string; link?: string; category?: "SERVICE" | "MARKETING"; email?: boolean; dedupeKey?: string };

/** Есть ли действующее согласие пользователя на цель (последняя запись решает). */
export async function hasConsent(tx: Tx | typeof db, userId: string, purpose: string): Promise<boolean> {
  const c = await tx.consent.findFirst({ where: { userId, purpose }, orderBy: { createdAt: "desc" } });
  return !!c && c.granted && !c.revokedAt;
}

/**
 * Сервисные уведомления отправляются всегда и без рекламных вставок.
 * Маркетинговые — только при действующем отдельном согласии (AC28), иначе не создаются вовсе.
 */
export async function notify(tx: Tx | typeof db, userId: string, n: N): Promise<boolean> {
  const category = n.category ?? "SERVICE";
  if (category === "MARKETING" && !(await hasConsent(tx, userId, "MARKETING"))) {
    log("info", "notify.marketing_skipped_no_consent", { type: n.type });
    return false;
  }
  if (n.dedupeKey) {
    const exists = await tx.notification.findUnique({ where: { dedupeKey: n.dedupeKey } });
    if (exists) return false;
  }
  await tx.notification.create({ data: { userId, type: n.type, category, title: n.title, body: n.body, link: n.link, dedupeKey: n.dedupeKey } });
  if (n.email) {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (u) await adapters.messaging.email(tx, { userId, to: u.email, subject: n.title, body: n.body + (n.link ? `\n\nСсылка: ${n.link}` : ""), category });
  }
  return true;
}

export async function notifyOrg(tx: Tx | typeof db, orgId: string, n: N) {
  const members = await tx.membership.findMany({ where: { organizationId: orgId, status: "ACTIVE" } });
  for (const m of members) await notify(tx, m.userId, { ...n, dedupeKey: n.dedupeKey ? `${n.dedupeKey}:${m.userId}` : undefined });
}

export async function notifyPlatformRole(tx: Tx | typeof db, role: "ADMIN" | "SUPPORT", n: N) {
  const members = await tx.membership.findMany({ where: { role, status: "ACTIVE", organization: { type: "PLATFORM" } } });
  for (const m of members) await notify(tx, m.userId, { ...n, dedupeKey: n.dedupeKey ? `${n.dedupeKey}:${m.userId}` : undefined });
}
