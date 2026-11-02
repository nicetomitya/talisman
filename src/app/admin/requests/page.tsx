import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { PageTitle, Status, fmtDate } from "@/components/ui";
import { isCarrier } from "@/components/adminctx";

export default async function AdminRequests() {
  const ctx = await requireAdminPage();
  if (isCarrier(ctx)) redirect("/admin");
  const list = await db.insuranceRequest.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true, status: true, currentVersion: true, territory: true, updatedAt: true, productCode: true } });
  const auctions = await db.auction.findMany({ where: { requestId: { in: list.map((r) => r.id) } } });
  const quotes = await db.quote.groupBy({ by: ["requestId"], where: { requestId: { in: list.map((r) => r.id) } }, _count: true });
  return (<><PageTitle title="Заявки" subtitle="Минимальный вид без персональных данных клиента. Полный доступ к документам — только через временный доступ поддержки с причиной." />
    <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Заявка</th><th>Статус</th><th>Версия</th><th>Подбор</th><th>Предложений</th><th>Обновлена</th></tr></thead><tbody>
      {list.map((r) => { const a = auctions.filter((x) => x.requestId === r.id).sort((x, y) => y.requestVersion - x.requestVersion)[0]; return <tr key={r.id}><td data-label="Заявка">{r.title} <span className="text-xs text-muted">{r.id.slice(0, 8)} · {r.territory ?? ""}</span></td><td data-label="Статус"><Status group="request" value={r.status} /></td><td data-label="Версия">{r.currentVersion}</td><td data-label="Подбор">{a ? <><Status group="auction" value={a.status} />{a.extensionTotalSec ? ` +${a.extensionTotalSec} с` : ""}</> : "—"}</td><td data-label="Предложений" className="num">{quotes.find((q) => q.requestId === r.id)?._count ?? 0}</td><td data-label="Обновлена">{fmtDate(r.updatedAt, true)}</td></tr>; })}
    </tbody></table></div></>);
}
