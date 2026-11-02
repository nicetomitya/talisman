import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { DOC_KINDS } from "@/server/domain/labels";
import { Empty, PageTitle, Status, fmtDate } from "@/components/ui";
import { DocLink } from "@/components/client";

export default async function Documents() {
  const ctx = await requireClientPage();
  const docs = await db.document.findMany({ where: { ownerUserId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 200 });
  return (<><PageTitle title="Документы" subtitle="Сформированные документы демонстрационные. Ссылки на скачивание короткоживущие и проверяют права." />
    {docs.length === 0 ? <Empty title="Документов нет" /> : <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Документ</th><th>Вид</th><th>Версия</th><th>Статус</th><th>Дата</th></tr></thead><tbody>
      {docs.map((d) => <tr key={d.id}><td data-label="Документ">{["CLEAN", "GENERATED"].includes(d.status) ? <DocLink id={d.id} title={d.title} /> : d.title}{d.supersededById && <span className="text-xs text-muted"> (заменён новой версией)</span>}</td><td data-label="Вид">{DOC_KINDS[d.kind] ?? d.kind}</td><td data-label="Версия">{d.version}</td><td data-label="Статус"><Status group="doc" value={d.status} /></td><td data-label="Дата">{fmtDate(d.createdAt, true)}</td></tr>)}
    </tbody></table></div>}</>);
}
