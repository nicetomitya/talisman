import Link from "next/link";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { coverageState } from "@/server/domain/policies";
import { Empty, Money, PageTitle, Status, fmtDate } from "@/components/ui";

export default async function Policies() {
  const ctx = await requireClientPage();
  const t = await now();
  const list = await db.policy.findMany({ where: { clientId: ctx.user.id }, orderBy: { createdAt: "desc" } });
  return (<><PageTitle title="Полисы" subtitle="Все полисы демонстрационные и не являются действующими договорами страхования." />
    {list.length === 0 ? <Empty title="Полисов нет" /> : <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Номер</th><th>Объект</th><th>Договор</th><th>Защита</th><th>Период</th><th>Премия</th></tr></thead><tbody>
      {list.map((p) => <tr key={p.id}><td data-label="Номер"><Link href={`/c/policies/${p.id}`}>{p.number}</Link></td><td data-label="Объект">{p.objectTitle}</td><td data-label="Договор"><Status group="contract" value={p.contractStatus} /></td><td data-label="Защита"><Status group="coverage" value={coverageState(p, t)} /></td><td data-label="Период">{fmtDate(p.startsAt)} – {fmtDate(p.endsAt)}</td><td data-label="Премия"><Money kop={p.premiumKop} /></td></tr>)}
    </tbody></table></div>}</>);
}
