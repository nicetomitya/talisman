import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { requestForAgency } from "@/server/domain/requests";
import { rankForAgency } from "@/server/domain/auction";
import { allFields, formatValue } from "@/server/domain/forms";
import { Card, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, AutoRefresh, Countdown } from "@/components/client";
import { QuoteCalculator } from "@/components/agency";
import { DEMO_RULES } from "@/server/config";
import { analyzeForAgency } from "@/server/domain/assistant";
import { durationRu } from "@/lib/duration";

export default async function AgencyRequest({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAgencyPage();
  const { id } = await params;
  let v;
  try { v = await requestForAgency({ ...ctx, orgId: ctx.org.orgId }, id); } catch { notFound(); }
  const t = await now();
  const r = v.request; const a = v.auction;
  const open = !!a && (a.status === "OPEN" || a.status === "EXTENDED") && a.requestVersion === r.currentVersion && a.closesAt > t;
  const fields = allFields(v.schema);
  const products = await db.product.findMany({ where: { status: "PUBLISHED", kind: "CLASSIC", versions: { some: { status: "PUBLISHED", terms: { path: ["productCode"], equals: r.productCode } } } } });
  const mandates = await db.mandate.findMany({ where: { agencyOrgId: ctx.org.orgId, status: "ACTIVE", validFrom: { lte: t }, validTo: { gte: t } } });
  const myQuotes = await db.quote.findMany({ where: { requestId: r.id, agencyOrgId: ctx.org.orgId }, orderBy: { createdAt: "desc" } });
  const ranks = await rankForAgency(ctx.org.orgId, r.id);
  const carriers = await db.organization.findMany({ where: { id: { in: products.map((p) => p.carrierOrgId) } } });
  const data = v.data as Record<string, any>;
  const ai = r.kind === "CLASSIC" && !v.dealCheckoutId ? await analyzeForAgency({ ...ctx, orgId: ctx.org.orgId }, r.id).catch(() => null) : null;
  return (
    <>
      {open && <AutoRefresh ms={5000} />}
      <PageTitle title={`${r.title} · версия ${r.currentVersion}`} subtitle={<>Статус заявки: <Status group="request" value={r.status} /> {a && <>· подбор: <Status group="auction" value={a.status} /></>}</>} actions={v.dealCheckoutId ? <Link className="btn btn-primary no-underline" href={`/a/deals/${v.dealCheckoutId}`}>Открыть сделку</Link> : null} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={v.dealCheckoutId ? "Данные заявки (после выбора)" : "Данные для расчёта"}>
          {!v.dealCheckoutId && <p className="mb-2 text-xs text-muted">Видны только поля, нужные для расчёта. Имя, контакты, VIN и точный адрес откроются, если клиент выберет ваше предложение.</p>}
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">{Object.entries(data).map(([k, val]) => { const f = fields.find((x) => x.key === k); return <div key={k} className="contents"><dt className="text-muted">{f?.label ?? k}</dt><dd className="break-words">{formatValue(f, val)}</dd></div>; })}</dl>
        </Card>
        <Card title="Подбор">
          {a ? <div className="space-y-1 text-sm">
            {open ? <p><Countdown label="До окончания приёма" deadline={a.closesAt.toISOString()} serverNow={t.toISOString()} /></p> : <p>Приём предложений завершён.</p>}
            {a.extensionTotalSec > 0 && <p className="text-muted">Срок продлевался на {durationRu(a.extensionTotalSec)} (максимум {durationRu(DEMO_RULES.maxExtensionSec)}).</p>}
            <p className="text-muted">После подачи предложение фиксировано: можно только снизить цену при тех же условиях. Отозванное предложение повторно подать нельзя.</p>
            <p className="text-muted">Минимальный шаг улучшения: <Money kop={a.minStepKop} />. Вы видите только своё место среди сопоставимых предложений, без цен и имён конкурентов.</p>
          </div> : <p className="text-sm text-muted">Подбор не проводится.</p>}
          {ranks && ranks.length > 0 && <ul className="mt-3 space-y-1 text-sm">{ranks.map((x) => <li key={x.quoteId}>{x.status === "DRAFT" ? "Черновик" : `Ваше место: ${x.place} из ${x.comparableCount}`}{x.betterExists ? " · есть более выгодное предложение" : ""}</li>)}</ul>}
        </Card>
        {ai && <Card title="Разбор заявки (помощник, демо)" className="lg:col-span-2">
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div><h3 className="font-semibold">Что нужно клиенту</h3><ul className="mt-1 list-disc pl-5">{ai.covered.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div><h3 className="font-semibold">На что обратить внимание</h3>{ai.attention.length ? <ul className="mt-1 list-disc pl-5">{ai.attention.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="mt-1 text-muted">Особых факторов нет.</p>}</div>
            <div><h3 className="font-semibold">Подходящие продукты</h3>{ai.products.length ? <ul className="mt-1 space-y-1">{ai.products.map((p) => <li key={p.productId}>{p.title}: {p.ok ? <>от <Money kop={p.minKop!} /> до <Money kop={p.maxKop!} /> (по тарифу <Money kop={p.baseKop!} />){p.inspection ? ", нужен осмотр" : ""}</> : <span className="text-muted">не подходит: {p.reason}</span>}</li>)}</ul> : <p className="mt-1 text-muted">Нет продуктов с действующими полномочиями.</p>}</div>
          </div>
          <p className="mt-2 text-xs text-muted">{ai.note}</p>
        </Card>}
        {r.kind === "CLASSIC" && v.eligible && <Card title="Рассчитать и предложить" className="lg:col-span-2">
          <QuoteCalculator requestId={r.id} requestVersion={r.currentVersion} open={open} deductible={Number(data.deductible_rub ?? 0)} altAllowed={!!data.allow_alt_deductible}
            products={products.map((p) => ({ id: p.id, title: `${p.title} (${carriers.find((c) => c.id === p.carrierOrgId)?.name})`, mandate: mandates.some((m) => m.productId === p.id) }))} />
        </Card>}
        <Card title="Мои предложения" className="lg:col-span-2">
          {myQuotes.length === 0 ? <p className="text-sm text-muted">Предложений нет.</p> :
            <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Версия</th><th>Итог</th><th>Франшиза</th><th>Статус</th><th>Действует до</th><th></th></tr></thead><tbody>
              {myQuotes.map((q) => <tr key={q.id}><td data-label="Версия">{q.seq} · v заявки {q.requestVersion}</td><td data-label="Итог"><Money kop={q.totalKop} /></td><td data-label="Франшиза">{((q.terms as any).deductibleRub ?? 0).toLocaleString("ru-RU")} ₽</td><td data-label="Статус"><Status group="quote" value={q.status} />{q.withdrawReason ? <span className="text-xs text-muted"> {q.withdrawReason}</span> : null}</td><td data-label="До">{fmtDate(q.expiresAt, true)}</td>
                <td>{q.status === "DRAFT" && open && <Action url="/api/agency/publish-draft" body={{ quoteId: q.id }} label="Опубликовать" variant="primary" />}{q.status === "PUBLISHED" && <Action url="/api/agency/withdraw" body={{ quoteId: q.id, reason: "Отозвано агентством" }} label="Отозвать" variant="danger" confirm="Отозвать предложение?" />}</td></tr>)}
            </tbody></table></div>}
        </Card>
      </div>
    </>
  );
}
