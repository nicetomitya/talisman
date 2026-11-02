import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { coverageState } from "@/server/domain/policies";
import { DOC_KINDS } from "@/server/domain/labels";
import { Card, KV, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, ApiForm, DocLink } from "@/components/client";
import { Rating, Terminate } from "@/components/policy";
import { EventCheckView } from "@/components/eventcheck";

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClientPage();
  const { id } = await params;
  const p = await db.policy.findFirst({ where: { id, clientId: ctx.user.id }, include: { coverages: true } });
  if (!p) notFound();
  const t = await now();
  const cov = coverageState(p, t);
  const isEvent = p.productCode === "RAIN01" || p.productCode === "WIND01";
  const [carrier, agency, docs, claims, ec, refunds, reviews, conv, payments] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: p.carrierOrgId } }),
    p.agencyOrgId ? db.organization.findUnique({ where: { id: p.agencyOrgId } }) : null,
    db.document.findMany({ where: { OR: [{ policyId: p.id }, ...(p.checkoutId ? [{ checkoutId: p.checkoutId }] : [])], supersededById: null }, orderBy: { createdAt: "asc" } }),
    db.claim.findMany({ where: { policyId: p.id }, orderBy: { createdAt: "desc" } }),
    isEvent ? db.eventCheck.findUnique({ where: { policyId: p.id } }) : null,
    db.refund.findMany({ where: { policyId: p.id } }),
    db.review.findMany({ where: { policyId: p.id, authorId: ctx.user.id } }),
    db.conversation.findFirst({ where: { contextType: "POLICY", contextId: p.id } }),
    p.checkoutId ? db.payment.findMany({ where: { checkoutId: p.checkoutId } }) : [],
  ]);
  const terms = p.terms as any;
  const unit = p.productCode === "RAIN01" ? "мм" : "м/с";
  const concluded = p.contractStatus === "CONCLUDED";
  const hasClaimDone = claims.some((c) => ["PAID", "REJECTED", "CLOSED"].includes(c.status));
  return (
    <>
      <PageTitle title={`Полис ${p.number}`} subtitle={<>{p.objectTitle} · <Status group="contract" value={p.contractStatus} /> <Status group="coverage" value={cov} /></>} actions={conv ? <Link href={`/c/messages/${conv.id}`} className="btn btn-secondary no-underline">Сообщения</Link> : null} />
      <p className="mb-4 rounded-md border border-warn/30 bg-warn-soft p-2 text-sm text-warn">Демонстрационный документ. Не является действующим страховым полисом.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Условия">
          <KV items={[["Страховщик", carrier.name], ["Агентство", agency?.name ?? "—"], ["Номер у страховщика", p.externalNumber ?? "ожидается"], ["Период", `${fmtDate(p.startsAt, true, p.timezone)} – ${fmtDate(p.endsAt, true, p.timezone)}`], ["Премия", <Money key="m" kop={p.premiumKop} />], ["Франшиза", terms.deductibleRub !== undefined ? `${Number(terms.deductibleRub).toLocaleString("ru-RU")} ₽` : "—"], ["Урегулирование", terms.settlement ?? "—"], ["Телефон экстренной связи", terms.emergencyPhone ?? "—"], ...(p.bookingRef ? [["Бронирование", `${p.bookingRef}${p.bookingCanceledAt ? " (отменено)" : ""}`] as [string, string]] : []), ...(p.terminatedAt ? [["Прекращён", `${fmtDate(p.terminatedAt)}: ${p.terminationReason}`] as [string, string]] : [])]} />
          {(terms.exclusions ?? []).length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Исключения</summary><ul className="mt-1 list-disc pl-5">{terms.exclusions.map((e: any) => <li key={e.code}>{e.title}</li>)}</ul></details>}
        </Card>
        <Card title="Покрытия и лимиты">
          <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Покрытие</th><th>Лимит</th><th>Выплачено</th><th>Остаток</th></tr></thead><tbody>
            {p.coverages.map((c) => <tr key={c.id}><td data-label="Покрытие">{c.title}</td><td data-label="Лимит"><Money kop={c.limitKop} /></td><td data-label="Выплачено"><Money kop={c.paidKop} /></td><td data-label="Остаток"><Money kop={c.limitKop - c.paidKop} /></td></tr>)}
          </tbody></table></div>
        </Card>
        {isEvent && ec && <Card title="Проверка события" className="lg:col-span-2"><EventCheckView ec={ec} unit={unit} tz={p.timezone} /></Card>}
        <Card title="Документы"><ul className="space-y-1 text-sm">{docs.map((d) => <li key={d.id}><DocLink id={d.id} title={d.title} inline /> <span className="text-xs text-muted">· {DOC_KINDS[d.kind] ?? d.kind}, v{d.version}{d.signedBy ? `, подписан ${d.signedBy}` : ""}</span></li>)}</ul></Card>
        <Card title="Обращения и выплаты" actions={!isEvent && concluded && cov !== "NONE" ? null : null}>
          {claims.length === 0 ? <p className="text-sm text-muted">{isEvent ? "Обращение создаётся автоматически после расчёта, подавать заявление не нужно." : "Обращений нет."}</p> :
            <ul className="space-y-1 text-sm">{claims.map((c) => <li key={c.id}><Link href={`/c/claims/${c.id}`}>{c.number}</Link> · <Status group="claim" value={c.status} /> · {fmtDate(c.createdAt)}</li>)}</ul>}
          {payments.length > 0 && <p className="mt-2 text-xs text-muted">Оплата премии: {payments.map((x) => `${(x.amountKop / 100).toLocaleString("ru-RU")} ₽, ${x.status}`).join("; ")}</p>}
          {refunds.length > 0 && <p className="mt-1 text-xs text-muted">Возвраты: {refunds.map((r) => `${(r.amountKop / 100).toLocaleString("ru-RU")} ₽, ${r.status}`).join("; ")}</p>}
        </Card>
        {!isEvent && concluded && <Card title="Заявить о событии"><ApiForm url={`/api/policies/${p.id}/claim`} submit="Создать обращение" redirect="/c/claims/{claimId}" fields={[{ name: "eventDate", label: "Дата события", type: "date", required: true }, { name: "description", label: "Что произошло", type: "textarea", required: true, hint: "Не короче 10 символов. Документы можно приложить на следующем шаге." }]} /></Card>}
        {isEvent && concluded && cov !== "ENDED" && <Card title="Изменение бронирования"><p className="mb-2 text-sm">Если мероприятие отменено или перенесено, сообщите: правила продукта определяют, что происходит с покрытием.</p><div className="flex flex-wrap gap-2"><Action url={`/api/policies/${p.id}/booking-change`} body={{ kind: "CANCELLED" }} label="Бронирование отменено" confirm="Сообщить об отмене бронирования?" /><Action url={`/api/policies/${p.id}/booking-change`} body={{ kind: "DATE_CHANGED" }} label="Дата перенесена" /></div></Card>}
        {concluded && <Card title="Прекращение договора"><Terminate policyId={p.id} /></Card>}
        {concluded && !isEvent && <Card title="Изменение условий и продление">
          <ApiForm url={`/api/policies/${p.id}/change`} submit="Отправить запрос на изменение" successText="Запрос отправлен агентству и страховщику" resetOnSuccess fields={[{ name: "description", label: "Что изменить", type: "textarea", required: true }]} />
          <div className="mt-3"><Action url={`/api/policies/${p.id}/renew`} label="Начать продление (новая заявка)" redirect="/c/requests/{requestId}" /></div></Card>}
        {p.agencyOrgId && (concluded || p.contractStatus === "EXPIRED" || p.contractStatus === "TERMINATED") && <Card title="Отзыв об агентстве">
          {reviews.map((r) => <p key={r.id} className="mb-2 text-sm">Ваш отзыв ({r.stage === "CLAIM" ? "урегулирование" : "покупка"}): {r.rating}/5 · {r.text} {r.status === "HIDDEN" && <span className="text-bad">(скрыт модератором: {r.moderationNote})</span>}</p>)}
          <Rating policyId={p.id} stage="SALE" />{hasClaimDone && <div className="mt-4"><Rating policyId={p.id} stage="CLAIM" /></div>}</Card>}
        <Card title="Не согласны с решением?"><ApiForm url={`/api/policies/${p.id}/dispute`} submit="Открыть спор" successText="Спор зарегистрирован, специалист ответит в течение срока рассмотрения" resetOnSuccess fields={[{ name: "reason", label: "Опишите, с чем вы не согласны", type: "textarea", required: true }]} /></Card>
      </div>
    </>
  );
}
