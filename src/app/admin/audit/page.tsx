import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { PageTitle, fmtDate } from "@/components/ui";
import { isCarrier } from "@/components/adminctx";

export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; entity?: string }> }) {
  const ctx = await requireAdminPage();
  if (isCarrier(ctx)) redirect("/admin");
  const sp = await searchParams;
  const list = await db.auditLog.findMany({ where: { ...(sp.q ? { action: { contains: sp.q } } : {}), ...(sp.entity ? { entityId: sp.entity } : {}) }, orderBy: { at: "desc" }, take: 200 });
  const users = await db.user.findMany({ where: { id: { in: list.map((l) => l.actorUserId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return (<><PageTitle title="Журнал аудита" subtitle="Кто, когда, что изменил, значение до и после, причина. Секреты и коды в журнал не попадают." />
    <form className="mb-3 flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="aq">Действие</label><input id="aq" name="q" defaultValue={sp.q} placeholder="Действие, например payment" className="field sm:max-w-xs" /><label className="sr-only" htmlFor="ae">Объект</label><input id="ae" name="entity" defaultValue={sp.entity} placeholder="ID объекта" className="field sm:max-w-xs" /><button className="btn btn-secondary">Найти</button></form>
    <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Время</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Изменение</th></tr></thead><tbody>
      {list.map((l) => <tr key={l.id}><td data-label="Время">{fmtDate(l.at, true)}</td><td data-label="Кто">{users.find((u) => u.id === l.actorUserId)?.name ?? l.actorRole ?? "система"}{l.actorRole ? ` (${l.actorRole})` : ""}</td><td data-label="Действие">{l.action}</td><td data-label="Объект" className="text-xs">{l.entityType} {l.entityId?.slice(0, 8)}</td><td data-label="Изменение" className="max-w-md break-all text-xs">{l.before ? `до: ${JSON.stringify(l.before).slice(0, 120)} ` : ""}{l.after ? `после: ${JSON.stringify(l.after).slice(0, 160)}` : ""}{l.reason ? ` · причина: ${l.reason}` : ""}</td></tr>)}
    </tbody></table></div></>);
}
