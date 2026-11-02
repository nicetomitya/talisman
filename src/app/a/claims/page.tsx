import Link from "next/link";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { Empty, PageTitle, Status, fmtDate } from "@/components/ui";

export default async function AgencyClaims() {
  const ctx = await requireAgencyPage();
  const list = await db.claim.findMany({ where: { agencyOrgId: ctx.org.orgId }, orderBy: { createdAt: "desc" } });
  return (<><PageTitle title="Обращения клиентов" />{list.length === 0 ? <Empty title="Обращений нет" /> : <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Номер</th><th>Тип</th><th>Статус</th><th>SLA</th></tr></thead><tbody>
    {list.map((c) => <tr key={c.id}><td data-label="Номер"><Link href={`/a/claims/${c.id}`}>{c.number}</Link></td><td data-label="Тип">{c.type === "PARAMETRIC" ? "По событию" : "Классическое"}</td><td data-label="Статус"><Status group="claim" value={c.status} /></td><td data-label="SLA">{fmtDate(c.slaDueAt, true)}</td></tr>)}
  </tbody></table></div>}</>);
}
