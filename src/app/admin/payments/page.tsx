import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { Card, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action } from "@/components/client";
import { isCarrier } from "@/components/adminctx";

export default async function AdminPayments() {
  const ctx = await requireAdminPage();
  if (isCarrier(ctx)) redirect("/admin");
  const [pays, hooks, refunds, payouts] = await Promise.all([
    db.payment.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.webhookInbox.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.refund.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.payoutItem.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return (
    <>
      <PageTitle title="Платежи" subtitle="Премии — потоком страховщика, подписки — отдельным потоком платформы. Статус оплаты меняется только проверенным вебхуком или сверкой." actions={<Action url="/api/admin/reconcile" label="Запустить сверку" successText="Сверка выполнена" />} />
      <div className="space-y-4">
        <Card title="Оплаты"><div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Дата</th><th>Назначение</th><th>Получатель</th><th>Сумма</th><th>Статус</th><th>Операция</th></tr></thead><tbody>
          {pays.map((p) => <tr key={p.id}><td data-label="Дата">{fmtDate(p.createdAt, true)}</td><td data-label="Назначение">{p.purpose === "PREMIUM" ? "Премия" : "Подписка"}</td><td data-label="Получатель">{p.recipientLabel}</td><td data-label="Сумма"><Money kop={p.amountKop} /></td><td data-label="Статус"><Status group="payment" value={p.status} />{p.failureReason ? <span className="text-xs text-muted"> {p.failureReason}</span> : null}</td><td data-label="Операция" className="break-all text-xs">{p.externalId}</td></tr>)}
        </tbody></table></div></Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Входящие вебхуки"><ul className="space-y-1 text-xs">{hooks.map((h) => <li key={h.id}>{fmtDate(h.createdAt, true)} · {h.provider} · {h.externalEventId.slice(0, 24)} · подпись {h.signatureValid ? "✓" : "✕"} · получено {h.receivedCount} раз · {h.result ?? (h.processedAt ? "обработан" : "в очереди")}</li>)}</ul></Card>
          <Card title="Возвраты и выплаты"><ul className="space-y-1 text-sm">{refunds.map((r) => <li key={r.id}>Возврат <Money kop={r.amountKop} /> · {r.status} · {r.reason}</li>)}{payouts.map((x) => <li key={x.id}>Выплата <Money kop={x.amountKop} /> · {x.status} · {x.beneficiary}</li>)}</ul></Card>
        </div>
      </div>
    </>
  );
}
