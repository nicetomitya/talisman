import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { label } from "@/server/domain/labels";
import { Card, Money, PageTitle, Status, fmtDate } from "@/components/ui";

export default async function Earnings() {
  const ctx = await requireAgencyPage();
  const list = await db.commission.findMany({ where: { recipientOrgId: ctx.org.orgId, recipientType: "AGENCY" }, orderBy: { createdAt: "desc" } });
  const pol = await db.policy.findMany({ where: { id: { in: list.map((c) => c.policyId) } }, select: { id: true, number: true } });
  const sum = (s: string[]) => list.filter((c) => s.includes(c.status)).reduce((a, c) => a + c.amountKop, 0);
  const net = list.reduce((a, c) => a + c.amountKop, 0);
  return (<><PageTitle title="Вознаграждение" subtitle="Вознаграждение агентства по условиям распределения страховщика. Сторно при прекращении договора — отдельными записями." />
    <div className="mb-4 grid gap-3 sm:grid-cols-3"><Card><p className="text-xs text-muted">Начислено</p><p className="text-lg font-semibold"><Money kop={sum(["ACCRUED"])} /></p></Card><Card><p className="text-xs text-muted">Подтверждено или получено</p><p className="text-lg font-semibold"><Money kop={sum(["CONFIRMED", "RECEIVED"])} /></p></Card><Card><p className="text-xs text-muted">Итого с учётом сторно</p><p className="text-lg font-semibold"><Money kop={net} /></p></Card></div>
    <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Полис</th><th>Вид</th><th>База</th><th>Ставка</th><th>Сумма</th><th>Статус</th><th>Дата</th></tr></thead><tbody>
      {list.map((c) => <tr key={c.id}><td data-label="Полис">{pol.find((p) => p.id === c.policyId)?.number}</td><td data-label="Вид">{c.kind === "REVERSAL" ? "Сторно" : "Начисление"}</td><td data-label="База"><Money kop={c.baseKop} /></td><td data-label="Ставка">{(c.rateBp / 100).toFixed(1)} %</td><td data-label="Сумма"><Money kop={c.amountKop} /></td><td data-label="Статус"><Status group="commission" value={c.status} /></td><td data-label="Дата">{fmtDate(c.createdAt)}</td></tr>)}
    </tbody></table></div></>);
}
