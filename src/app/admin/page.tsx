import Link from "next/link";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { Card, Money, PageTitle, Status } from "@/components/ui";
import { isCarrier } from "@/components/adminctx";

export default async function AdminHome() {
  const ctx = await requireAdminPage();
  const t = await now();
  const carrier = isCarrier(ctx);
  const pw = carrier ? { carrierOrgId: ctx.org.orgId } : {};
  const [premium, policies, platformComm, subsPaid, claimsOpen, exc, unknownPay, overdue, events] = await Promise.all([
    db.payment.aggregate({ where: { purpose: "PREMIUM", status: "SUCCEEDED", ...(carrier ? { recipientOrgId: ctx.org.orgId } : {}) }, _sum: { amountKop: true }, _count: true }),
    db.policy.count({ where: { ...pw, contractStatus: "CONCLUDED" } }),
    carrier ? null : db.commission.aggregate({ where: { recipientType: "PLATFORM" }, _sum: { amountKop: true } }),
    carrier ? null : db.payment.aggregate({ where: { purpose: "SUBSCRIPTION", status: "SUCCEEDED" }, _sum: { amountKop: true } }),
    db.claim.count({ where: { ...pw, status: { in: ["SUBMITTED", "REVIEWING", "NEEDS_INFO", "DECISION_PREPARED", "DISPUTED"] } } }),
    carrier ? [] : db.exceptionItem.findMany({ where: { status: { not: "RESOLVED" } }, orderBy: [{ priority: "desc" }, { dueAt: "asc" }], take: 8 }),
    carrier ? 0 : db.payment.count({ where: { status: "UNKNOWN" } }),
    carrier ? 0 : db.exceptionItem.count({ where: { status: { not: "RESOLVED" }, dueAt: { lt: t } } }),
    db.eventCheck.groupBy({ by: ["status"], _count: true }),
  ]);
  return (
    <>
      <PageTitle title={carrier ? `Страховщик «${ctx.org.orgName}»` : "Обзор платформы"} subtitle="Все показатели по демонстрационным данным." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!carrier && <Card><p className="text-xs text-muted">Выручка платформы</p><p className="text-lg font-semibold"><Money kop={(platformComm?._sum.amountKop ?? 0) + (subsPaid?._sum.amountKop ?? 0)} /></p><p className="text-xs text-muted">доля вознаграждения <Money kop={platformComm?._sum.amountKop ?? 0} /> + подписки <Money kop={subsPaid?._sum.amountKop ?? 0} /></p></Card>}
        <Card><p className="text-xs text-muted">Объём премий страховщикам</p><p className="text-lg font-semibold"><Money kop={premium._sum.amountKop ?? 0} /></p><p className="text-xs text-muted">{premium._count} оплат. Это не выручка платформы: премия идёт страховщику напрямую.</p></Card>
        <Card><p className="text-xs text-muted">Действующих договоров</p><p className="text-lg font-semibold num">{policies}</p></Card>
        <Card><p className="text-xs text-muted">Обращений в работе</p><p className="text-lg font-semibold num">{claimsOpen}</p></Card>
      </div>
      {!carrier && <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Исключения" actions={<Link href="/admin/exceptions" className="text-sm">Вся очередь</Link>}>
          <p className="mb-2 text-sm">Просрочено: <strong className="num">{overdue}</strong> · платежей с неизвестным результатом: <strong className="num">{unknownPay}</strong></p>
          <ul className="space-y-1 text-sm">{(exc as any[]).map((e) => <li key={e.id}><Status value={e.priority} /> {e.type}: {e.reason}</li>)}</ul>
        </Card>
        <Card title="Проверки событий"><ul className="space-y-1 text-sm">{events.map((e) => <li key={e.status}><Status group="eventCheck" value={e.status} /> <span className="num">{e._count}</span></li>)}</ul></Card>
      </div>}
    </>
  );
}
