import { redirect } from "next/navigation";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { Card, PageTitle, fmtDate } from "@/components/ui";
import { Action, ApiForm } from "@/components/client";

export default async function Team() {
  const ctx = await requireAgencyPage();
  if (ctx.org.role !== "AGENCY_OWNER") redirect("/a");
  const members = await db.membership.findMany({ where: { organizationId: ctx.org.orgId }, include: { user: { select: { id: true, name: true, email: true } } } });
  const clientIds = [...new Set((await db.policy.findMany({ where: { agencyOrgId: ctx.org.orgId }, select: { clientId: true } })).map((p) => p.clientId))];
  const clients = await db.user.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } });
  const assigns = await db.clientAssignment.findMany({ where: { agencyOrgId: ctx.org.orgId, toAt: null } });
  const tasks = await db.task.findMany({ where: { organizationId: ctx.org.orgId }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 50 });
  const agentOpts = members.filter((m) => m.status === "ACTIVE").map((m) => ({ value: m.user.id, label: m.user.name }));
  return (
    <>
      <PageTitle title="Команда" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Сотрудники"><ul className="space-y-1 text-sm">{members.map((m) => <li key={m.id}>{m.user.name} · {m.user.email} · {m.role === "AGENCY_OWNER" ? "владелец" : "агент"}{m.status !== "ACTIVE" ? " (неактивен)" : ""}</li>)}</ul>
          <div className="mt-4 border-t border-line pt-3"><ApiForm url="/api/agency/invite" submit="Пригласить" successText="Приглашение отправлено в демопочту" resetOnSuccess fields={[{ name: "name", label: "Имя", required: true }, { name: "email", label: "Email (.test)", type: "email", required: true }, { name: "role", label: "Роль", type: "select", options: [{ value: "AGENT", label: "Агент" }, { value: "AGENCY_OWNER", label: "Владелец" }], defaultValue: "AGENT" }]} /></div></Card>
        <Card title="Закрепление клиентов">{clients.length === 0 ? <p className="text-sm text-muted">Клиентов пока нет.</p> : <ul className="space-y-3 text-sm">{clients.map((c) => { const a = assigns.find((x) => x.clientId === c.id); return <li key={c.id}><p>{c.name}: {a ? `ведёт ${members.find((m) => m.user.id === a.agentUserId)?.user.name ?? "—"} с ${fmtDate(a.fromAt)}` : "не закреплён"}</p><ApiForm url="/api/agency/assign" submit="Закрепить" extra={{ clientId: c.id, reason: "Перераспределение владельцем" }} fields={[{ name: "agentUserId", label: "Сотрудник", type: "select", options: agentOpts }]} /></li>; })}</ul>}<p className="mt-2 text-xs text-muted">История закреплений сохраняется, переписка и документы переходят вместе с клиентом.</p></Card>
        <Card title="Задачи" className="lg:col-span-2">{tasks.length === 0 ? <p className="text-sm text-muted">Задач нет.</p> : <ul className="space-y-2 text-sm">{tasks.map((t) => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2"><span>{t.status === "DONE" ? "✓ " : ""}{t.title}{t.note ? ` · ${t.note}` : ""}{t.dueAt ? ` · до ${fmtDate(t.dueAt, true)}` : ""}</span>{t.status === "OPEN" && <Action url="/api/agency/task-done" body={{ taskId: t.id }} label="Выполнено" />}</li>)}</ul>}</Card>
      </div>
    </>
  );
}
