import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { Card, PageTitle, Status, fmtDate } from "@/components/ui";
import { ApiForm } from "@/components/client";
import { isAdmin } from "@/components/adminctx";

const A: Record<string, string> = { TARIFF_CHANGE: "Изменение тарифа", FINANCIAL_ADJUSTMENT: "Финансовая корректировка", PAYOUT_RULE_CHANGE: "Изменение правила выплаты" };
export default async function Approvals() {
  const ctx = await requireAdminPage();
  if (!isAdmin(ctx)) redirect("/admin");
  const list = await db.adminApproval.findMany({ orderBy: { createdAt: "desc" } });
  const users = await db.user.findMany({ where: { id: { in: list.flatMap((a) => [a.requestedBy, a.approvedBy]).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const n = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";
  return (
    <>
      <PageTitle title="Согласования двух администраторов" subtitle="Критичные изменения применяются только после подтверждения вторым администратором. Инициатор не может подтвердить свой запрос." />
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Card title="Новый запрос"><ApiForm url="/api/admin/request-approval" submit="Запросить согласование" transform={undefined} fields={[{ name: "action", label: "Действие", type: "select", options: Object.entries(A).map(([value, label]) => ({ value, label })) }, { name: "reason", label: "Обоснование (не короче 10 символов)", type: "textarea", required: true }]} extra={{ payload: { note: "Демо-изменение: параметры задаются в P1" } }} /></Card>
        <div className="space-y-3">{list.map((a) => <Card key={a.id}><p className="text-sm"><strong>{A[a.action]}</strong> · <Status value={a.status} /> · запросил {n(a.requestedBy)} {fmtDate(a.createdAt, true)}</p><p className="mt-1 text-sm">{a.reason}</p><pre className="mt-1 overflow-x-auto rounded bg-bg p-2 text-xs">{JSON.stringify(a.payload)}</pre>
          {a.approvedBy && <p className="text-sm text-muted">Решение: {n(a.approvedBy)}, {a.approvalReason}</p>}
          {a.status === "PENDING" && a.requestedBy !== ctx.user.id && <div className="mt-2 grid gap-2 sm:grid-cols-2"><ApiForm url="/api/admin/decide-approval" submit="Подтвердить" extra={{ id: a.id, approve: true }} fields={[{ name: "reason", label: "Комментарий", required: true }]} /><ApiForm url="/api/admin/decide-approval" submit="Отклонить" extra={{ id: a.id, approve: false }} fields={[{ name: "reason", label: "Причина", required: true }]} /></div>}
          {a.status === "PENDING" && a.requestedBy === ctx.user.id && <p className="mt-2 text-xs text-muted">Ожидает второго администратора.</p>}</Card>)}</div>
      </div>
    </>
  );
}
