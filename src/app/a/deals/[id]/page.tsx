import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { schemaFor } from "@/server/domain/catalog";
import { allFields, dealView, formatValue } from "@/server/domain/forms";
import { DOC_KINDS } from "@/server/domain/labels";
import { Card, KV, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { DocLink } from "@/components/client";
import { Chat } from "@/components/chat";

export default async function Deal({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAgencyPage();
  const { id } = await params;
  const c = await db.checkout.findFirst({ where: { id, agencyOrgId: ctx.org.orgId } });
  if (!c) notFound();
  const [req, client, policy, conv, shares] = await Promise.all([
    db.insuranceRequest.findUniqueOrThrow({ where: { id: c.requestId } }),
    db.user.findUniqueOrThrow({ where: { id: c.clientId }, select: { name: true } }),
    db.policy.findUnique({ where: { checkoutId: c.id } }),
    db.conversation.findFirst({ where: { contextType: "CHECKOUT", contextId: c.id } }),
    db.documentShare.findMany({ where: { agencyOrgId: ctx.org.orgId } }),
  ]);
  const schema = schemaFor(req.productCode);
  const s = c.snapshot as any;
  const data = c.status === "CANCELLED" ? {} : dealView(schema, s.requestData ?? {});
  const fields = allFields(schema);
  const docs = await db.document.findMany({ where: { id: { in: shares.map((x) => x.documentId) }, requestId: c.requestId } });
  const pc = policy ? await db.commission.findMany({ where: { policyId: policy.id, recipientOrgId: ctx.org.orgId } }) : [];
  return (
    <>
      <PageTitle title={`Сделка: ${req.title}`} subtitle={<>Оформление: <Status group="checkout" value={c.status} />{policy && <> · полис {policy.number} <Status group="contract" value={policy.contractStatus} /></>}</>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Клиент и данные">
          <KV items={[["Клиент", c.status === "CANCELLED" ? "скрыто после отмены" : `${client.name} · связь только через чат платформы`], ["Итог", <Money key="t" kop={s.quote.totalKop} />], ["Резерв до", fmtDate(c.reservationExpiresAt, true)]]} />
          <dl className="mt-3 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">{Object.entries(data).map(([k, v]) => { const f = fields.find((x) => x.key === k); return <div key={k} className="contents"><dt className="text-muted">{f?.label ?? k}</dt><dd className="break-words">{formatValue(f, v)}</dd></div>; })}</dl>
          <p className="mt-2 text-xs text-muted">Данные, видимые только страховщику (например, собственник), агентству не передаются. Доступ к документам — по передаче клиента, каждое скачивание фиксируется.</p>
        </Card>
        <Card title="Документы клиента">{docs.length === 0 ? <p className="text-sm text-muted">Нет переданных документов.</p> : <ul className="space-y-1 text-sm">{docs.map((d) => <li key={d.id}><DocLink id={d.id} title={d.title} /> <span className="text-xs text-muted">· {DOC_KINDS[d.kind] ?? d.kind}</span></li>)}</ul>}
          {pc.length > 0 && <div className="mt-3 border-t border-line pt-3 text-sm"><p className="font-medium">Вознаграждение по полису</p>{pc.map((x) => <p key={x.id}>{x.kind === "REVERSAL" ? "Сторно" : "Начислено"}: <Money kop={x.amountKop} /> · {x.status}</p>)}</div>}
        </Card>
        {conv && <div className="lg:col-span-2"><h2 className="mb-2 font-semibold">Переписка с клиентом</h2><Chat id={conv.id} me={ctx.user.id} allowAssistant={false} /></div>}
      </div>
    </>
  );
}
