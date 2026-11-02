import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { Card, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action } from "@/components/client";
import { isCarrier } from "@/components/adminctx";

export default async function Billing() {
  const ctx = await requireAdminPage();
  if (isCarrier(ctx)) redirect("/admin");
  const [subs, plans, orgs, comm, invoices, promos] = await Promise.all([db.subscription.findMany(), db.plan.findMany(), db.organization.findMany({ where: { type: "AGENCY" } }), db.commission.findMany({ orderBy: { createdAt: "desc" }, take: 100 }), db.subscriptionInvoice.findMany({ orderBy: { createdAt: "desc" }, take: 50 }), db.promo.findMany()]);
  const policies = await db.policy.findMany({ where: { id: { in: comm.map((c) => c.policyId) } }, select: { id: true, number: true } });
  const name = (id: string | null) => orgs.find((o) => o.id === id)?.name ?? (id ? id.slice(0, 8) : "Платформа");
  const platform = comm.filter((c) => c.recipientType === "PLATFORM").reduce((a, c) => a + c.amountKop, 0);
  const saas = invoices.filter((i) => i.status === "PAID").reduce((a, i) => a + i.amountKop - i.discountKop, 0);
  return (
    <>
      <PageTitle title="Доходы и подписки" subtitle="Выручка платформы: доля вознаграждения и подписки. Объём премий страховщиков сюда не входит." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3"><Card><p className="text-xs text-muted">Доля платформы в вознаграждении (с учётом сторно)</p><p className="text-lg font-semibold"><Money kop={platform} /></p></Card><Card><p className="text-xs text-muted">Оплаченные подписки</p><p className="text-lg font-semibold"><Money kop={saas} /></p></Card><Card><p className="text-xs text-muted">Итого выручка (демо)</p><p className="text-lg font-semibold"><Money kop={platform + saas} /></p></Card></div>
      <div className="space-y-4">
        <Card title="Подписки"><div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Агентство</th><th>Тариф</th><th>Статус</th><th>Период</th><th>Автопродление</th></tr></thead><tbody>
          {subs.map((s) => <tr key={s.id}><td data-label="Агентство">{name(s.organizationId)}</td><td data-label="Тариф">{plans.find((p) => p.id === s.planId)?.title}</td><td data-label="Статус"><Status group="subscription" value={s.status} />{s.graceUntil ? ` до ${fmtDate(s.graceUntil)}` : ""}</td><td data-label="Период">{fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)}</td><td data-label="Автопродление">{s.autoRenew ? "да" : "нет"}</td></tr>)}
        </tbody></table></div></Card>
        <Card title="Вознаграждение по полисам"><div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Полис</th><th>Получатель</th><th>Вид</th><th>Сумма</th><th>Статус</th><th></th></tr></thead><tbody>
          {comm.map((c) => <tr key={c.id}><td data-label="Полис">{policies.find((p) => p.id === c.policyId)?.number}</td><td data-label="Получатель">{c.recipientType === "PLATFORM" ? "Платформа" : name(c.recipientOrgId)}</td><td data-label="Вид">{c.kind === "REVERSAL" ? "Сторно" : "Начисление"} · {(c.rateBp / 100).toFixed(1)} % от <Money kop={c.baseKop} /></td><td data-label="Сумма"><Money kop={c.amountKop} /></td><td data-label="Статус"><Status group="commission" value={c.status} /></td><td>{c.status === "ACCRUED" && c.kind !== "REVERSAL" && <Action url="/api/admin/commission-status" body={{ id: c.id, status: "CONFIRMED" }} label="Подтвердить" />}</td></tr>)}
        </tbody></table></div></Card>
        <Card title="Промокоды"><ul className="text-sm">{promos.map((p: any) => <li key={p.id}>{p.code} · использовано бюджета <Money kop={p.usedKop ?? 0} /> из <Money kop={p.budgetKop ?? 0} /></li>)}</ul></Card>
      </div>
    </>
  );
}
