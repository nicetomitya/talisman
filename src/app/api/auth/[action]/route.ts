import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/server/api";
import { err } from "@/server/errors";
import { actor } from "@/server/access";
import * as auth from "@/server/domain/auth";
import { cookieOptions, SESSION_COOKIE } from "@/server/auth/session";
import { db } from "@/server/db";
import { audit } from "@/server/audit";

const S = {
  register: z.object({ email: z.string().email().max(200), name: z.string().min(2).max(120), password: z.string().min(1).max(200), consentPd: z.boolean(), consentTerms: z.boolean(), consentMarketing: z.boolean().default(false) }).strict(),
  login: z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200), totp: z.string().max(10).optional() }).strict(),
  verify: z.object({ token: z.string().min(10).max(200) }).strict(),
  "reset-request": z.object({ email: z.string().email().max(200) }).strict(),
  reset: z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(200) }).strict(),
  "totp-confirm": z.object({ code: z.string().min(6).max(8) }).strict(),
  stepup: z.object({ code: z.string().min(6).max(8) }).strict(),
  "switch-org": z.object({ orgId: z.string().uuid() }).strict(),
  "revoke-session": z.object({ sessionId: z.string().uuid() }).strict(),
  "demo-switch": z.object({ email: z.string().email() }).strict(),
};

const ip = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
const secure = (req: Request) => new URL(req.url).protocol === "https:";

export const POST = api({ auth: false, schema: z.any() }, async ({ req, ctx, body, params }) => {
  const action = params.action as keyof typeof S | "logout" | "totp-setup";
  const schema = (S as any)[action];
  const data = schema ? schema.safeParse(body) : { success: true, data: body };
  if (!data.success) throw err("VALIDATION", "Проверьте поля формы", { fields: data.error.issues.map((i: any) => ({ path: i.path.join("."), message: i.message })) });
  const b = data.data;
  switch (action) {
    case "register": return auth.register({ ...b, ip: ip(req) });
    case "verify": await auth.verifyEmail(b.token); return { ok: true };
    case "login": {
      const r = await auth.login({ ...b, ip: ip(req), ua: req.headers.get("user-agent") });
      if ("needTotp" in r) return { needTotp: true };
      const res = NextResponse.json({ ok: true, kind: r.user.kind, home: "/go" });
      res.cookies.set(SESSION_COOKIE, r.token, cookieOptions(secure(req)));
      return res;
    }
    case "logout": {
      if (ctx) await auth.logout(ctx.sessionId);
      const res = NextResponse.json({ ok: true });
      res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(secure(req)), maxAge: 0 });
      return res;
    }
    case "reset-request": await auth.requestReset(b.email, ip(req)); return { ok: true, note: "Если аккаунт существует, письмо отправлено" };
    case "reset": await auth.resetPassword(b.token, b.password); return { ok: true };
    case "totp-setup": if (!ctx) throw err("UNAUTHENTICATED", "Войдите"); return auth.startTotpSetup(ctx.user.id);
    case "totp-confirm": if (!ctx) throw err("UNAUTHENTICATED", "Войдите"); await auth.confirmTotpSetup(ctx.user.id, ctx.sessionId, b.code); return { ok: true };
    case "stepup": if (!ctx) throw err("UNAUTHENTICATED", "Войдите"); await auth.stepUp(ctx.user.id, ctx.sessionId, b.code); return { ok: true };
    case "switch-org": if (!ctx) throw err("UNAUTHENTICATED", "Войдите"); await auth.switchOrg({ ...actor(ctx), userId: ctx.user.id }, ctx.sessionId, b.orgId); return { ok: true };
    case "revoke-session": {
      if (!ctx) throw err("UNAUTHENTICATED", "Войдите");
      const r = await db.session.updateMany({ where: { id: b.sessionId, userId: ctx.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!r.count) throw err("NOT_FOUND", "Сессия не найдена");
      await audit(db, actor(ctx), "auth.session_revoked", "Session", b.sessionId);
      return { ok: true };
    }
    case "demo-switch": {
      const r = await auth.demoSwitch(b.email);
      if (ctx) await auth.logout(ctx.sessionId);
      const res = NextResponse.json({ ok: true, home: "/go" });
      res.cookies.set(SESSION_COOKIE, r.token, cookieOptions(secure(req)));
      return res;
    }
    default: throw err("NOT_FOUND", "Неизвестное действие");
  }
});
