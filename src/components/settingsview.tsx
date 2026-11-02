import { redirect } from "next/navigation";
import { pageCtx } from "@/server/page";
import { db } from "@/server/db";
import { PURPOSES, TEXT_VERSIONS, currentConsents } from "@/server/domain/consents";
import { Card, PageTitle, fmtDate } from "./ui";
import { ConsentToggle, SessionRevoke, TotpSetup } from "./settings";

export async function SettingsView() {
  const ctx = await pageCtx();
  if (!ctx) redirect("/login");
  const consents = await currentConsents(ctx.user.id);
  const sessions = await db.session.findMany({ where: { userId: ctx.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageTitle title="Настройки и безопасность" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Согласия"><ul>{Object.entries(PURPOSES).map(([k, p]) => <ConsentToggle key={k} purpose={k} title={p.title} text={p.text} required={p.required} version={(TEXT_VERSIONS as any)[k]} granted={!!consents.current[k]?.granted} />)}</ul></Card>
        <div className="space-y-4">
          <Card title="Активные сессии"><ul className="space-y-2 text-sm">{sessions.map((s) => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2"><span>{s.id === ctx.sessionId ? "Текущая · " : ""}с {fmtDate(s.createdAt, true)}{s.userAgent ? ` · ${s.userAgent.slice(0, 40)}` : ""}</span>{s.id !== ctx.sessionId && <SessionRevoke id={s.id} />}</li>)}</ul></Card>
          <Card title="Второй фактор (TOTP)">{ctx.user.totpEnabled ? <p className="text-sm text-ok">✓ Включён</p> : <TotpSetup />}</Card>
          <Card title="Данные аккаунта"><p className="text-sm">{ctx.user.name} · {ctx.user.email}</p><p className="mt-1 text-xs text-muted">Запрос на выгрузку или удаление данных в P0 оформляется через поддержку. Записи договоров и платежей хранятся установленный законом срок.</p></Card>
        </div>
      </div>
    </>
  );
}
