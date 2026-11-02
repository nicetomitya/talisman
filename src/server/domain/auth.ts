import { db } from "../db";
import { err } from "../errors";
import { hashPassword, verifyPassword, randomToken, sha256 } from "../auth/crypto";
import { createSession } from "../auth/session";
import { rateLimit } from "../auth/ratelimit";
import { newTotpSecret, verifyTotp, totpUri } from "../auth/totp";
import { DEMO_RULES, isDemo } from "../config";
import { audit, type Actor } from "../audit";
import { adapters } from "../adapters";
import { TEXT_VERSIONS } from "./consents";

const genericLoginError = () => err("UNAUTHENTICATED", "Неверный email или пароль");

export function validatePassword(p: string) {
  if (p.length < 10) throw err("VALIDATION", "Пароль — не короче 10 символов", { fields: [{ path: "password", message: "Минимум 10 символов" }] });
  if (!/[a-zа-я]/i.test(p) || !/\d/.test(p)) throw err("VALIDATION", "Пароль должен содержать буквы и цифры", { fields: [{ path: "password", message: "Буквы и цифры" }] });
}

export async function register(i: { email: string; name: string; password: string; consentPd: boolean; consentTerms: boolean; consentMarketing: boolean; ip?: string | null }) {
  await rateLimit(`register:${i.ip ?? "?"}`, 10, 3600);
  if (!i.consentPd || !i.consentTerms) throw err("VALIDATION", "Нужны согласие на обработку данных и принятие условий (раздельно)", { fields: [{ path: "consentPd", message: "Обязательно" }] });
  validatePassword(i.password);
  const email = i.email.trim().toLowerCase();
  const exists = await db.user.findUnique({ where: { email } });
  if (exists) throw err("CONFLICT", "Пользователь с таким email уже зарегистрирован");
  const passwordHash = await hashPassword(i.password);
  const token = randomToken();
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email, name: i.name.trim(), kind: "CLIENT", passwordHash, isDemo: email.endsWith(".test") } });
    await tx.consent.createMany({ data: [
      { userId: u.id, purpose: "PD_PROCESSING", textVersion: TEXT_VERSIONS.PD_PROCESSING, granted: true, method: "checkbox:register" },
      { userId: u.id, purpose: "TERMS", textVersion: TEXT_VERSIONS.TERMS, granted: true, method: "checkbox:register" },
      { userId: u.id, purpose: "MARKETING", textVersion: TEXT_VERSIONS.MARKETING, granted: !!i.consentMarketing, method: "checkbox:register" },
    ] });
    await tx.oneTimeToken.create({ data: { type: "VERIFY_EMAIL", tokenHash: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + 24 * 3600_000) } });
    await adapters.messaging.email(tx, { userId: u.id, to: email, subject: "Подтвердите email", body: `Ссылка для подтверждения (действует 24 часа, одноразовая): /verify?token=${token}`, category: "SERVICE" });
    await audit(tx, { userId: u.id, role: "CLIENT" }, "user.register", "User", u.id, { after: { email } });
    return u;
  });
  return { userId: user.id };
}

export async function consumeToken(type: "VERIFY_EMAIL" | "RESET_PASSWORD", token: string) {
  const t = await db.oneTimeToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!t || t.type !== type) throw err("NOT_FOUND", "Ссылка недействительна");
  if (t.usedAt) throw err("ALREADY_DONE", "Ссылка уже использована");
  if (t.expiresAt < new Date()) throw err("QUOTE_EXPIRED", "Срок действия ссылки истёк");
  const upd = await db.oneTimeToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  if (upd.count !== 1) throw err("ALREADY_DONE", "Ссылка уже использована");
  return t;
}

export async function verifyEmail(token: string) {
  const t = await consumeToken("VERIFY_EMAIL", token);
  await db.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: new Date() } });
}

export async function login(i: { email: string; password: string; totp?: string; ip?: string | null; ua?: string | null }) {
  const email = i.email.trim().toLowerCase();
  await rateLimit(`login:ip:${i.ip ?? "?"}`, 30, 300);
  await rateLimit(`login:email:${email}`, 10, 300);
  const user = await db.user.findUnique({ where: { email }, include: { memberships: { where: { status: "ACTIVE" } } } });
  if (!user) { await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$Zm9vYmFyYmF6", i.password); throw genericLoginError(); }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw err("RATE_LIMITED", "Вход временно заблокирован после нескольких неудачных попыток");
  if (user.status !== "ACTIVE") throw genericLoginError();
  const ok = await verifyPassword(user.passwordHash, i.password);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await db.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= DEMO_RULES.loginMaxFailures ? new Date(Date.now() + DEMO_RULES.loginLockMin * 60_000) : null } });
    await audit(db, { userId: user.id }, "auth.login_failed", "User", user.id);
    throw genericLoginError();
  }
  if (!user.emailVerifiedAt) throw err("FORBIDDEN", "Подтвердите email по ссылке из письма (в демо — во вкладке «Демопочта» на странице входа)");
  let mfa = false;
  if (user.totpEnabled && user.totpSecret) {
    if (!i.totp) return { needTotp: true as const };
    if (!verifyTotp(user.totpSecret, i.totp)) throw err("UNAUTHENTICATED", "Неверный код второго фактора");
    mfa = true;
  }
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  const { token, session } = await createSession(user.id, { activeOrgId: user.memberships[0]?.organizationId ?? null, mfa, ip: i.ip, ua: i.ua });
  await audit(db, { userId: user.id }, "auth.login", "Session", session.id, { after: { mfa } });
  return { token, user };
}

export async function logout(sessionId: string) {
  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export async function requestReset(email: string, ip?: string | null) {
  await rateLimit(`reset:${ip ?? "?"}`, 10, 3600);
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return; // не раскрываем наличие аккаунта
  const token = randomToken();
  await db.$transaction(async (tx) => {
    await tx.oneTimeToken.create({ data: { type: "RESET_PASSWORD", tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    await adapters.messaging.email(tx, { userId: user.id, to: user.email, subject: "Восстановление пароля", body: `Одноразовая ссылка (действует 1 час): /reset?token=${token}`, category: "SERVICE" });
  });
}

export async function resetPassword(token: string, password: string) {
  validatePassword(password);
  const t = await consumeToken("RESET_PASSWORD", token);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
    await tx.session.updateMany({ where: { userId: t.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { userId: t.userId }, "auth.password_reset", "User", t.userId);
  });
}

export async function startTotpSetup(userId: string) {
  const secret = newTotpSecret();
  await db.setting.upsert({ where: { key: `totp_pending:${userId}` }, update: { value: { secret } }, create: { key: `totp_pending:${userId}`, value: { secret } } });
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return { secret, uri: totpUri(secret, u.email) };
}

export async function confirmTotpSetup(userId: string, sessionId: string, code: string) {
  const s = await db.setting.findUnique({ where: { key: `totp_pending:${userId}` } });
  const secret = (s?.value as any)?.secret;
  if (!secret) throw err("NOT_FOUND", "Сначала начните настройку");
  if (!verifyTotp(secret, code)) throw err("VALIDATION", "Неверный код", { fields: [{ path: "code", message: "Неверный код" }] });
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { totpSecret: secret, totpEnabled: true } }),
    db.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: new Date() } }),
    db.setting.delete({ where: { key: `totp_pending:${userId}` } }),
  ]);
  await audit(db, { userId }, "auth.totp_enabled", "User", userId);
}

/** Повторная проверка второго фактора внутри текущей сессии (step-up). */
export async function stepUp(userId: string, sessionId: string, code: string) {
  await rateLimit(`stepup:${userId}`, 10, 300);
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!u.totpEnabled || !u.totpSecret || !verifyTotp(u.totpSecret, code)) throw err("UNAUTHENTICATED", "Неверный код");
  await db.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: new Date() } });
}

export async function switchOrg(actor: Actor & { userId: string }, sessionId: string, orgId: string) {
  const m = await db.membership.findFirst({ where: { userId: actor.userId, organizationId: orgId, status: "ACTIVE" } });
  if (!m) throw err("FORBIDDEN", "Вы не состоите в этой организации");
  await db.session.update({ where: { id: sessionId }, data: { activeOrgId: orgId } });
  await audit(db, actor, "auth.switch_org", "Session", sessionId, { after: { orgId } });
}

/** Переключение деморолей — только APP_MODE=demo и только для демо-аккаунтов (*.test). */
export async function demoSwitch(email: string) {
  if (!isDemo()) throw err("FORBIDDEN", "Переключение ролей недоступно в боевом режиме");
  const user = await db.user.findUnique({ where: { email }, include: { memberships: { where: { status: "ACTIVE" } } } });
  if (!user || !user.isDemo || !email.endsWith(".test")) throw err("NOT_FOUND", "Демо-аккаунт не найден");
  const { token, session } = await createSession(user.id, { activeOrgId: user.memberships[0]?.organizationId ?? null, mfa: true, demoSwitch: true });
  await audit(db, { userId: user.id, role: "DEMO" }, "demo.role_switch", "Session", session.id);
  return { token, user };
}
