import { z } from "zod";
import { api } from "@/server/api";
import { err } from "@/server/errors";
import { isDemo } from "@/server/config";
import { advance, setNow, resetClock, now } from "@/server/clock";
import { setEmu } from "@/server/adapters/emu";
import { emulatorPayerAction, replayWebhook } from "@/server/adapters/payment";
import { drainJobs } from "@/server/worker";
import { resetDemo } from "@/server/demo/seed";
import { runEventCheck } from "@/server/domain/events";
import { reconcile } from "@/server/domain/payments";
import { revokeMandate } from "@/server/domain/admin";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { verifyPassword } from "@/server/auth/crypto";
import { rateLimit } from "@/server/auth/ratelimit";

/** Демопанель: только APP_MODE=demo (дополнительно блокируется middleware). Каждое действие журналируется. */
const S: Record<string, z.ZodTypeAny> = {
  reset: z.object({ confirm: z.literal(true) }).strict(),
  "clock-set": z.object({ at: z.string().datetime() }).strict(),
  "clock-advance": z.object({ minutes: z.number().int().min(-525600).max(525600) }).strict(),
  "clock-reset": z.object({}).strict(),
  emulators: z.object({ patch: z.record(z.any()) }).strict(),
  "run-jobs": z.object({}).strict(),
  pay: z.object({ externalId: z.string().max(80), outcome: z.enum(["success", "fail", "lost_webhook", "cancel", "unknown"]) }).strict(),
  "replay-webhook": z.object({ externalId: z.string().max(80) }).strict(),
  "provider-resolve": z.object({ externalId: z.string().max(80), status: z.enum(["SUCCEEDED", "FAILED"]) }).strict(),
  "event-check": z.object({ policyId: z.string().uuid() }).strict(),
  reconcile: z.object({}).strict(),
  "expire-mandate": z.object({ agencyOrgId: z.string().uuid() }).strict(),
  mailbox: z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).strict(),
  "saas-card": z.object({ orgId: z.string().uuid(), behavior: z.enum(["success", "fail"]) }).strict(),
};

export const POST = api({ auth: false }, async ({ req, ctx, params }) => {
  if (!isDemo()) throw err("NOT_FOUND", "Не найдено");
  const schema = S[params.action];
  if (!schema) throw err("NOT_FOUND", "Неизвестное действие");
  const p = schema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) throw err("VALIDATION", "Проверьте поля", { fields: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const b: any = p.data;
  // Оплату на странице эмулятора провайдера может выполнить вошедший пользователь; остальные действия — любой участник демо.
  if (params.action === "mailbox") {
    // Демопочта: письма (ссылки подтверждения, коды) видит только владелец ящика, предъявивший пароль.
    await rateLimit(`mailbox:${b.email}`, 20, 300);
    const u = await db.user.findUnique({ where: { email: String(b.email).toLowerCase() } });
    if (!u || !u.isDemo || !(await verifyPassword(u.passwordHash, b.password))) throw err("UNAUTHENTICATED", "Неверный email или пароль");
    return { mails: await db.demoMail.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 30 }) };
  }
  if (!ctx && params.action !== "pay") throw err("UNAUTHENTICATED", "Войдите в демо-аккаунт");
  await audit(db, { userId: ctx?.user.id, role: "DEMO" }, `demo.${params.action}`, "Demo", null, { after: b });
  switch (params.action) {
    case "reset": await resetDemo(); return { ok: true, note: "Данные сброшены, войдите заново" };
    case "clock-set": await setNow(new Date(b.at)); await drainJobs(); return { now: await now() };
    case "clock-advance": { const t = await advance(b.minutes * 60_000); await drainJobs(); return { now: t }; }
    case "clock-reset": await resetClock(); return { now: await now() };
    case "emulators": return setEmu(b.patch);
    case "run-jobs": return { processed: await drainJobs() };
    case "pay": {
      if (b.outcome === "unknown") { await db.emulatorPayment.updateMany({ where: { externalId: b.externalId, status: "PENDING" }, data: { status: "UNKNOWN", scenario: "unknown" } }); return { status: "UNKNOWN" }; }
      const s = await emulatorPayerAction(b.externalId, b.outcome);
      await drainJobs();
      return { status: s };
    }
    case "replay-webhook": await replayWebhook(b.externalId); return { processed: await drainJobs() };
    case "provider-resolve": await db.emulatorPayment.update({ where: { externalId: b.externalId }, data: { status: b.status } }); return { ok: true };
    case "event-check": { const r = await runEventCheck(b.policyId, { force: true }); await drainJobs(); return r; }
    case "reconcile": { const r = await reconcile(); await drainJobs(); return r; }
    case "expire-mandate": {
      const ms = await db.mandate.findMany({ where: { agencyOrgId: b.agencyOrgId, status: "ACTIVE" } });
      for (const m of ms) await revokeMandate({ ...ctx!, org: null } as any, m.id, "Срок полномочий истёк (демо)", true);
      return { expired: ms.length };
    }
    case "saas-card": await db.setting.upsert({ where: { key: `saas_card:${b.orgId}` }, update: { value: { behavior: b.behavior } }, create: { key: `saas_card:${b.orgId}`, value: { behavior: b.behavior } } }); return { ok: true };
  }
});
