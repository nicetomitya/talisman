import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { Empty, Money, PageTitle, Status, fmtDate } from "@/components/ui";

export default async function Payments() {
  const ctx = await requireClientPage();
  const pays = await db.payment.findMany({ where: { payerUserId: ctx.user.id }, orderBy: { createdAt: "desc" } });
  const refunds = await db.refund.findMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
  const policies = await db.policy.findMany({ where: { clientId: ctx.user.id }, select: { id: true } });
  const payouts = await db.payoutItem.findMany({ where: { policyId: { in: policies.map((p) => p.id) } }, orderBy: { createdAt: "desc" } });
  return (<><PageTitle title="Платежи и выплаты" subtitle="Все операции демонстрационные, реальные деньги не движутся." />
    {pays.length === 0 ? <Empty title="Платежей нет" /> : <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Дата</th><th>Получатель</th><th>Сумма</th><th>Статус</th><th>Возвраты</th></tr></thead><tbody>
      {pays.map((p) => <tr key={p.id}><td data-label="Дата">{fmtDate(p.createdAt, true)}</td><td data-label="Получатель">{p.recipientLabel}</td><td data-label="Сумма"><Money kop={p.amountKop} /></td><td data-label="Статус"><Status group="payment" value={p.status} /></td><td data-label="Возвраты">{refunds.filter((r) => r.paymentId === p.id).map((r) => `${(r.amountKop / 100).toLocaleString("ru-RU")} ₽ (${r.status})`).join(", ") || "—"}</td></tr>)}
    </tbody></table></div>}
    <h2 className="mb-2 mt-6 font-semibold">Страховые выплаты</h2>
    {payouts.length === 0 ? <Empty title="Выплат нет" /> : <ul className="space-y-1 text-sm">{payouts.map((x) => <li key={x.id} className="card !p-3"><Money kop={x.amountKop} /> · {x.status} · {fmtDate(x.createdAt, true)}</li>)}</ul>}</>);
}
