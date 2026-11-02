import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { Card, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, ApiForm } from "@/components/client";
import { isCarrier } from "@/components/adminctx";

export default async function Orgs() {
  const ctx = await requireAdminPage();
  if (isCarrier(ctx)) redirect("/admin");
  const orgs = await db.organization.findMany({ where: { type: { in: ["AGENCY", "CARRIER"] } }, orderBy: [{ type: "asc" }, { name: "asc" }], include: { verifications: { orderBy: { createdAt: "desc" }, take: 3 } } });
  const subs = await db.subscription.findMany();
  const plans = await db.plan.findMany();
  return (
    <>
      <PageTitle title="Организации" subtitle="Проверка агентств, блокировка с причиной. Решения журналируются." />
      <div className="space-y-3">{orgs.map((o) => { const s = subs.find((x) => x.organizationId === o.id); return (
        <Card key={o.id} title={<>{o.name} <span className="text-xs font-normal text-muted">· {o.type === "AGENCY" ? "агентство" : "страховщик"} · ИНН {o.inn ?? "—"}</span></>}>
          <div className="flex flex-wrap gap-2 text-sm"><Status group="verification" value={o.verificationStatus} /> {o.verifiedUntil && <span>до {fmtDate(o.verifiedUntil)}</span>} <Status value={o.status} text={o.status === "ACTIVE" ? "Активна" : "Заблокирована"} />{o.blockReason && <span className="text-bad">{o.blockReason}</span>}{s && <span>Подписка: {plans.find((p) => p.id === s.planId)?.title}, <Status group="subscription" value={s.status} /></span>}</div>
          {o.verifications.length > 0 && <p className="mt-1 text-xs text-muted">История проверки: {o.verifications.map((v) => `${v.status} ${fmtDate(v.createdAt)}${v.note ? ` (${v.note})` : ""}`).join("; ")}</p>}
          {o.type === "AGENCY" && <div className="mt-3 grid gap-3 md:grid-cols-2">
            <ApiForm url="/api/admin/verify-org" submit="Сохранить решение о проверке" extra={{ orgId: o.id }} fields={[{ name: "decision", label: "Решение", type: "select", options: [{ value: "VERIFIED", label: "Проверено" }, { value: "REJECTED", label: "Отклонено" }] }, { name: "validDays", label: "Срок действия, дней", type: "number", defaultValue: 365 }, { name: "note", label: "Основание", required: true, hint: "Например: документы и лицензионные сведения проверены (демо)" }]} />
            <div>{o.status === "ACTIVE" ? <ApiForm url="/api/admin/block-org" submit="Заблокировать" extra={{ orgId: o.id }} fields={[{ name: "reason", label: "Причина блокировки", required: true }]} /> : <Action url="/api/admin/unblock-org" body={{ orgId: o.id }} label="Разблокировать" />}</div>
          </div>}
        </Card>); })}</div>
    </>
  );
}
