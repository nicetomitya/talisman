import { db } from "../db";
import { randomToken, sha256 } from "./crypto";
import { DEMO_RULES } from "../config";

export const SESSION_COOKIE = "tsid";
export const CSRF_COOKIE = "tcsrf";

export async function createSession(userId: string, opts: { activeOrgId?: string | null; mfa?: boolean; ip?: string | null; ua?: string | null; demoSwitch?: boolean } = {}) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + DEMO_RULES.sessionDays * 86400_000);
  const session = await db.session.create({
    data: { tokenHash: sha256(token), userId, activeOrgId: opts.activeOrgId ?? null, mfaVerifiedAt: opts.mfa ? new Date() : null, ip: opts.ip ?? null, userAgent: opts.ua?.slice(0, 200) ?? null, expiresAt, isDemoSwitch: !!opts.demoSwitch },
  });
  return { token, session };
}

export async function findSession(token: string | undefined | null) {
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { memberships: { where: { status: "ACTIVE" }, include: { organization: true } } } } } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.user.status !== "ACTIVE") return null;
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return s;
}

export function cookieOptions(secure: boolean, httpOnly = true) {
  return { httpOnly, sameSite: "lax" as const, secure, path: "/", maxAge: DEMO_RULES.sessionDays * 86400 };
}
