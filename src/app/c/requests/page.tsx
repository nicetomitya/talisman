import Link from "next/link";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { Empty, PageTitle, Status, fmtDate } from "@/components/ui";

export default async function Requests() {
  const ctx = await requireClientPage();
  const list = await db.insuranceRequest.findMany({ where: { clientId: ctx.user.id }, orderBy: { updatedAt: "desc" } });
  const counts = await db.quote.groupBy({ by: ["requestId"], where: { requestId: { in: list.map((r) => r.id) }, status: { in: ["PUBLISHED", "SELECTED"] } }, _count: true });
  return (
    <>
      <PageTitle title="Заявки" actions={<Link className="btn btn-primary no-underline" href="/c/requests/new">Новая заявка</Link>} />
      {list.length === 0 ? <Empty title="Заявок нет" action={<Link href="/c/requests/new">Создать первую</Link>} /> :
        <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Заявка</th><th>Статус</th><th>Предложений</th><th>Обновлена</th></tr></thead><tbody>
          {list.map((r) => <tr key={r.id}><td data-label="Заявка"><Link href={`/c/requests/${r.id}`}>{r.title}</Link>{r.currentVersion > 1 && <span className="text-xs text-muted"> · версия {r.currentVersion}</span>}</td><td data-label="Статус"><Status group="request" value={r.status} /></td><td data-label="Предложений" className="num">{counts.find((c) => c.requestId === r.id)?._count ?? 0}</td><td data-label="Обновлена">{fmtDate(r.updatedAt, true)}</td></tr>)}
        </tbody></table></div>}
    </>
  );
}
