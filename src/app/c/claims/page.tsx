import Link from "next/link";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { Empty, PageTitle, Status, fmtDate } from "@/components/ui";

export default async function Claims() {
  const ctx = await requireClientPage();
  const list = await db.claim.findMany({ where: { clientId: ctx.user.id }, orderBy: { createdAt: "desc" } });
  const pol = await db.policy.findMany({ where: { id: { in: list.map((c) => c.policyId) } }, select: { id: true, number: true, objectTitle: true } });
  return (<><PageTitle title="Обращения" subtitle="Классические обращения подаются из полиса. По событийным продуктам обращение создаётся автоматически." />
    {list.length === 0 ? <Empty title="Обращений нет" /> : <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Номер</th><th>Полис</th><th>Тип</th><th>Статус</th><th>Срок ответа</th></tr></thead><tbody>
      {list.map((c) => { const p = pol.find((x) => x.id === c.policyId); return <tr key={c.id}><td data-label="Номер"><Link href={`/c/claims/${c.id}`}>{c.number}</Link></td><td data-label="Полис">{p?.number} · {p?.objectTitle}</td><td data-label="Тип">{c.type === "PARAMETRIC" ? "По событию" : "Классическое"}</td><td data-label="Статус"><Status group="claim" value={c.status} /></td><td data-label="Срок ответа">{fmtDate(c.slaDueAt, true)}</td></tr>; })}
    </tbody></table></div>}</>);
}
