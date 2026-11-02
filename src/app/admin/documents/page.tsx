import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { DOC_KINDS } from "@/server/domain/labels";
import { Card, PageTitle, Status, fmtDate } from "@/components/ui";
import { ApiForm, DocLink } from "@/components/client";
import { isCarrier, isSupport } from "@/components/adminctx";

export default async function AdminDocuments() {
  const ctx = await requireAdminPage();
  if (isCarrier(ctx)) redirect("/admin");
  const support = isSupport(ctx);
  const [docs, logs, grants] = await Promise.all([
    db.document.findMany({ orderBy: { createdAt: "desc" }, take: 60, select: { id: true, title: true, kind: true, status: true, version: true, createdAt: true, sha256: true, scanNote: true } }),
    db.documentAccessLog.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    db.supportAccessGrant.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: logs.map((l) => l.userId) } }, select: { id: true, name: true } });
  return (
    <>
      <PageTitle title="Документы" subtitle={support ? "Поддержка открывает документы только по временному доступу с основанием. Каждое открытие журналируется." : "Доступ администратора журналируется как привилегированный."} />
      <div className="grid gap-4 lg:grid-cols-2">
        {support && <Card title="Запросить временный доступ"><ApiForm url="/api/admin/support-access" submit="Получить доступ" successText="Доступ выдан и записан в журнал" fields={[{ name: "targetType", label: "Объект", type: "select", options: [{ value: "Document", label: "Документ" }, { value: "Client", label: "Все документы клиента" }] }, { name: "targetId", label: "Идентификатор", required: true }, { name: "reason", label: "Основание (номер обращения и причина)", required: true }, { name: "minutes", label: "Срок, минут (до 60)", type: "number", defaultValue: 15 }]} />
          <ul className="mt-3 space-y-1 text-xs text-muted">{grants.map((g) => <li key={g.id}>{g.targetType} {g.targetId.slice(0, 8)} · до {fmtDate(g.expiresAt, true)} · {g.reason}</li>)}</ul></Card>}
        <Card title="Журнал доступа"><ul className="space-y-1 text-xs">{logs.map((l) => <li key={l.id}>{fmtDate(l.createdAt, true)} · {users.find((u) => u.id === l.userId)?.name} · {l.action} · {l.documentId.slice(0, 8)} · основание: {l.reason}</li>)}</ul></Card>
        <Card title="Последние документы" className="lg:col-span-2"><div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Документ</th><th>Вид</th><th>Статус</th><th>SHA-256</th><th>Дата</th></tr></thead><tbody>
          {docs.map((d) => <tr key={d.id}><td data-label="Документ">{["CLEAN", "GENERATED"].includes(d.status) ? <DocLink id={d.id} title={d.title} /> : d.title} <span className="text-xs text-muted">{d.id.slice(0, 8)} v{d.version}</span></td><td data-label="Вид">{DOC_KINDS[d.kind] ?? d.kind}</td><td data-label="Статус"><Status group="doc" value={d.status} />{d.scanNote ? <span className="text-xs text-muted"> {d.scanNote}</span> : null}</td><td data-label="SHA-256" className="break-all text-xs">{d.sha256.slice(0, 16)}…</td><td data-label="Дата">{fmtDate(d.createdAt, true)}</td></tr>)}
        </tbody></table></div></Card>
      </div>
    </>
  );
}
