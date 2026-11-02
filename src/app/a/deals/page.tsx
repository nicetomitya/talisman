import Link from "next/link";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { coverageState } from "@/server/domain/policies";
import { Card, Empty, Money, PageTitle, Status, fmtDate } from "@/components/ui";

export default async function Deals() {
  const ctx = await requireAgencyPage();
  const t = await now();
  const checkouts = await db.checkout.findMany({ where: { agencyOrgId: ctx.org.orgId }, orderBy: { createdAt: "desc" }, take: 100 });
  const policies = await db.policy.findMany({ where: { agencyOrgId: ctx.org.orgId }, orderBy: { createdAt: "desc" } });
  const reqs = await db.insuranceRequest.findMany({ where: { id: { in: checkouts.map((c) => c.requestId) } }, select: { id: true, title: true } });
  return (
    <>
      <PageTitle title="Сделки" />
      <Card title="Оформление">{checkouts.length === 0 ? <Empty title="Сделок нет" /> : <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Заявка</th><th>Статус</th><th>Итог</th><th>Создано</th></tr></thead><tbody>
        {checkouts.map((c) => <tr key={c.id}><td data-label="Заявка"><Link href={`/a/deals/${c.id}`}>{reqs.find((r) => r.id === c.requestId)?.title}</Link></td><td data-label="Статус"><Status group="checkout" value={c.status} /></td><td data-label="Итог"><Money kop={(c.snapshot as any).quote.totalKop} /></td><td data-label="Создано">{fmtDate(c.createdAt, true)}</td></tr>)}
      </tbody></table></div>}</Card>
      <Card title="Полисы" className="mt-4">{policies.length === 0 ? <Empty title="Полисов нет" /> : <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Номер</th><th>Объект</th><th>Договор</th><th>Защита</th><th>Премия</th></tr></thead><tbody>
        {policies.map((p) => <tr key={p.id}><td data-label="Номер">{p.checkoutId ? <Link href={`/a/deals/${p.checkoutId}`}>{p.number}</Link> : p.number}</td><td data-label="Объект">{p.objectTitle}</td><td data-label="Договор"><Status group="contract" value={p.contractStatus} /></td><td data-label="Защита"><Status group="coverage" value={coverageState(p, t)} /></td><td data-label="Премия"><Money kop={p.premiumKop} /></td></tr>)}
      </tbody></table></div>}</Card>
    </>
  );
}
