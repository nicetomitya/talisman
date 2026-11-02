import { redirect } from "next/navigation";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { label } from "@/server/domain/labels";
import { Card, KV, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, InlineInput } from "@/components/client";

export default async function Subscription() {
  const ctx = await requireAgencyPage();
  if (ctx.org.role !== "AGENCY_OWNER") redirect("/a");
  const sub = await db.subscription.findUnique({ where: { organizationId: ctx.org.orgId } });
  const plans = await db.plan.findMany({ orderBy: { priceKop: "asc" } });
  if (!sub) return <PageTitle title="Подписка" subtitle="Подписки нет" />;
  const plan = plans.find((p) => p.id === sub.planId)!;
  const next = sub.nextPlanId ? plans.find((p) => p.id === sub.nextPlanId) : null;
  const invoices = await db.subscriptionInvoice.findMany({ where: { organizationId: ctx.org.orgId }, orderBy: { createdAt: "desc" } });
  const payments = await db.payment.findMany({ where: { invoiceId: { in: invoices.map((i) => i.id) } } });
  const used = await db.responseUsage.count({ where: { organizationId: ctx.org.orgId, periodStart: sub.periodStart } }).catch(() => 0);
  return (
    <>
      <PageTitle title="Подписка" subtitle="Подписка оплачивается платформе и не связана со страховыми премиями. Оплата демонстрационная." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Тариф «${plan.title}»`}>
          <KV items={[["Статус", <Status key="s" group="subscription" value={sub.status} />], ["Период", `${fmtDate(sub.periodStart)} – ${fmtDate(sub.periodEnd)}`], ["Стоимость", <Money key="p" kop={plan.priceKop} />], ["Ответов использовано", `${used} из ${plan.maxResponses}`], ["Пользователей", `до ${plan.maxUsers}`], ["Льготный период до", fmtDate(sub.graceUntil)], ["Автопродление", sub.autoRenew ? `включено (согласие ${fmtDate(sub.autoRenewConsentAt, true)})` : "выключено"], ...(next ? [["Со следующего периода", next.title] as [string, string]] : [])]} />
          <div className="mt-3 flex flex-wrap gap-2">
            {sub.autoRenew ? <Action url="/api/subscriptions/cancel-renewal" label="Отключить автопродление" successText="Автопродление отключено, доступ сохранится до конца периода" /> :
              <Action url="/api/subscriptions/enable-renewal" body={{ confirm: true }} label="Включить автопродление" confirm={`Согласие на автоматическое списание ${(plan.priceKop / 100).toLocaleString("ru-RU")} ₽ в начале каждого периода. Отключить можно в один клик. Продолжить?`} />}
          </div>
        </Card>
        <Card title="Сменить тариф"><ul className="space-y-2 text-sm">{plans.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2"><span>{p.title} · <Money kop={p.priceKop} /> · до {p.maxUsers} польз., {p.maxResponses} ответов</span>{p.id === plan.id ? <span className="text-xs text-muted">текущий</span> : <Action url="/api/subscriptions/change-plan" body={{ planCode: p.code }} label="Выбрать" />}</li>)}</ul><p className="mt-2 text-xs text-muted">Повышение действует сразу, понижение — со следующего периода.</p></Card>
        <Card title="Счета" className="lg:col-span-2"><div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Период</th><th>Сумма</th><th>Скидка</th><th>Статус</th><th>Платежи</th><th></th></tr></thead><tbody>
          {invoices.map((i) => <tr key={i.id}><td data-label="Период">{fmtDate(i.periodStart)} – {fmtDate(i.periodEnd)}</td><td data-label="Сумма"><Money kop={i.amountKop} /></td><td data-label="Скидка"><Money kop={i.discountKop} /></td><td data-label="Статус">{i.status === "PAID" ? "✓ оплачен" : i.status === "OPEN" ? "ожидает оплаты" : i.status === "FAILED" ? "✕ оплата не прошла" : i.status}</td><td data-label="Платежи">{payments.filter((p) => p.invoiceId === i.id).map((p) => label("payment", p.status)).join(", ") || "—"}</td>
            <td>{["OPEN", "FAILED"].includes(i.status) && <div className="space-y-2"><Action url="/api/subscriptions/pay" body={{ invoiceId: i.id }} idempotent label="Оплатить" variant="primary" redirect="{confirmationUrl}" />{!i.promoId && <InlineInput url="/api/subscriptions/promo" name="code" label="Промокод" submit="Применить" extra={{ invoiceId: i.id }} />}</div>}</td></tr>)}
        </tbody></table></div></Card>
      </div>
    </>
  );
}
