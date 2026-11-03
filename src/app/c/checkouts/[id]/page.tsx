import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { DOC_KINDS, label } from "@/server/domain/labels";
import { Card, KV, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, AutoRefresh, CodeForm, Countdown, DocLink, PayButton } from "@/components/client";

const STEPS = ["RESERVED", "DOCUMENTS", "CLIENT_CONFIRMATION", "PAYMENT", "AWAITING_CARRIER", "COMPLETED"];
const STEP_T: Record<string, string> = { RESERVED: "Резерв цены", DOCUMENTS: "Ознакомление", CLIENT_CONFIRMATION: "Подтверждение кодом", PAYMENT: "Оплата страховщику", AWAITING_CARRIER: "Подтверждение страховщика", COMPLETED: "Полис" };
const REQUIRED = ["OFFER", "RULES", "INDIVIDUAL_TERMS", "APPLICATION"];

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClientPage();
  const { id } = await params;
  const c = await db.checkout.findFirst({ where: { id, clientId: ctx.user.id } });
  if (!c) notFound();
  const t = await now();
  const s = c.snapshot as any;
  const [req, carrier, agency, docs, payments, policy, conv, sig] = await Promise.all([
    db.insuranceRequest.findUniqueOrThrow({ where: { id: c.requestId } }),
    db.organization.findUniqueOrThrow({ where: { id: c.carrierOrgId } }),
    c.agencyOrgId ? db.organization.findUnique({ where: { id: c.agencyOrgId } }) : null,
    db.document.findMany({ where: { checkoutId: c.id, supersededById: null }, orderBy: { createdAt: "asc" } }),
    db.payment.findMany({ where: { checkoutId: c.id }, orderBy: { createdAt: "asc" } }),
    db.policy.findUnique({ where: { checkoutId: c.id } }),
    db.conversation.findFirst({ where: { contextType: "CHECKOUT", contextId: c.id } }),
    db.signatureSession.findFirst({ where: { checkoutId: c.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const acks = c.acknowledgements as Record<string, any>;
  const stepIdx = c.status === "CHECKING" ? 0 : STEPS.indexOf(c.status);
  const reserveActive = ["RESERVED", "CHECKING", "DOCUMENTS", "CLIENT_CONFIRMATION"].includes(c.status);
  const allAcked = REQUIRED.every((k) => { const d = docs.find((x) => x.kind === k); return d && acks[k]?.documentId === d.id && acks[k]?.sha256 === d.sha256; });
  const livePay = payments.find((p) => ["PENDING", "CREATED", "UNKNOWN"].includes(p.status));
  return (
    <>
      <PageTitle title={`Оформление: ${req.title}`} subtitle={<>Статус: <Status group="checkout" value={c.status} /></>} actions={<>
        {conv && <Link href={`/c/messages/${conv.id}`} className="btn btn-secondary no-underline">Чат с агентством</Link>}
        {reserveActive || c.status === "PAYMENT" ? <Action url={`/api/checkouts/${c.id}/cancel`} body={{ reason: "Клиент отменил матч" }} label="Отменить матч" variant="danger" confirm="Отменить матч? К прежним предложениям вернуться будет нельзя, только создать новую заявку (в том числе этому же агентству)." redirect={`/c/requests/${c.requestId}`} /> : null}
      </>} />
      {["CHECKING", "AWAITING_CARRIER", "PAYMENT"].includes(c.status) && <AutoRefresh />}
      <ol className="mb-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-6" aria-label="Шаги оформления">
        {STEPS.map((st, i) => <li key={st} aria-current={i === stepIdx ? "step" : undefined} className={`rounded border px-2 py-1.5 ${c.status === "CANCELLED" ? "border-line text-muted" : i < stepIdx ? "border-ok/30 bg-ok-soft text-ok" : i === stepIdx ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line bg-white text-muted"}`}>{i < stepIdx ? "✓ " : `${i + 1}. `}{STEP_T[st]}</li>)}
      </ol>
      {c.status !== "CANCELLED" && agency && <section aria-label="Матч" className="mb-4 rounded-lg border border-accent bg-accent-soft p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Матч</p>
        <p className="mt-1 text-lg font-semibold">Вы и «{agency.name}»</p>
        <p className="mt-1 text-sm">{c.status === "COMPLETED" ? "Договор оформлен. Вопросы по полису и обращения ведёт это агентство." : "Теперь вы общаетесь только с этим агентством. Остальные предложения закрыты, ваши данные получило только оно."}</p>
        {conv && <Link href={`/c/messages/${conv.id}`} className="btn btn-primary mt-3 no-underline">Написать агентству</Link>}
      </section>}
      {c.status === "CANCELLED" && <Card className="mb-4"><p className="text-sm text-bad">✕ Матч отменён: {c.cancelReason}.</p><p className="mt-1 text-sm"><Link href={`/c/requests/${c.requestId}`}>Создать новую заявку</Link>: всем агентствам или этому же.</p></Card>}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {c.status === "RESERVED" && <Card title="Шаг 1. Резерв">
            <p className="text-sm">Цена удерживается за вами. Нажмите, чтобы страховщик выполнил окончательную проверку и сформировал документы. Если страховщик изменит цену, понадобится ваше новое согласие.</p>
            <div className="mt-3"><Action url={`/api/checkouts/${c.id}/prepare`} label="Сформировать документы" variant="primary" /></div></Card>}
          {c.status === "CHECKING" && <Card title="Проверка у страховщика"><p className="text-sm">Страховщик проверяет предложение. Страница обновится автоматически.</p></Card>}
          {docs.length > 0 && <Card title="Документы комплекта">
            <p className="mb-2 text-xs text-warn">Все документы демонстрационные и не являются действующим страховым полисом.</p>
            <ul className="divide-y divide-line">{docs.map((d) => { const acked = acks[d.kind]?.documentId === d.id && acks[d.kind]?.sha256 === d.sha256; const need = REQUIRED.includes(d.kind);
              return <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><DocLink id={d.id} title={d.title} inline /> <span className="text-xs text-muted">· {DOC_KINDS[d.kind] ?? d.kind}, версия {d.version}{d.signedBy ? `, подписан: ${d.signedBy}` : ""}</span></span>
                {need && (acked ? <span className="text-xs text-ok">✓ Ознакомлен(а) {fmtDate(acks[d.kind].at, true)}</span> : c.status === "DOCUMENTS" || c.status === "CLIENT_CONFIRMATION" ? <Action url={`/api/checkouts/${c.id}/ack`} body={{ documentId: d.id }} label="Ознакомлен(а)" /> : null)}
              </li>; })}</ul>
            {(c.status === "DOCUMENTS" || c.status === "CLIENT_CONFIRMATION") && <div className="mt-3 border-t border-line pt-3">
              {!allAcked ? <p className="text-sm text-muted">Откройте и отметьте ознакомление с каждым обязательным документом (предложение, правила, индивидуальные условия, заявление). Отметка фиксирует версию и контрольную сумму документа.</p> :
                <Action url={`/api/checkouts/${c.id}/code`} label={c.status === "CLIENT_CONFIRMATION" ? "Отправить новый код" : "Получить код подтверждения"} variant={c.status === "DOCUMENTS" ? "primary" : "secondary"} successText="Код отправлен в демопочту" />}
            </div>}
          </Card>}
          {c.status === "CLIENT_CONFIRMATION" && <Card title="Шаг 3. Подтверждение">
            <p className="mb-2 text-sm">Код отправлен в <Link href="/c/mail" target="_blank">демопочту</Link>{sig ? `, действует до ${fmtDate(sig.expiresAt, true)}` : ""}. Подтверждая, вы соглашаетесь с документами в версиях, с которыми ознакомились.</p>
            <CodeForm checkoutId={c.id} /></Card>}
          {c.status === "PAYMENT" && <Card title="Шаг 4. Оплата страховщику">
            <KV items={[["Получатель", `${carrier.name} (страховщик), напрямую`], ["Сумма", <Money key="m" kop={s.quote.totalKop} />], ["Назначение", `Страховая премия по заявке «${req.title}»`]]} />
            <p className="mt-2 text-xs text-muted">Платформа не принимает премию на свой счёт. Повторное нажатие не создаёт второго списания. Оплата демонстрационная: реальные деньги не списываются.</p>
            <div className="mt-3">{payments.some((p) => p.status === "UNKNOWN") ? <p className="text-sm text-warn">! Результат предыдущей оплаты уточняется. Повторно оплачивать не нужно: мы сверим статус с провайдером.</p> : <PayButton checkoutId={c.id} label={livePay ? "Продолжить оплату" : "Перейти к оплате"} />}</div></Card>}
          {c.status === "AWAITING_CARRIER" && <Card title="Шаг 5. Подтверждение страховщика"><p className="text-sm">Оплата получена страховщиком. Ждём подтверждения заключения договора. До подтверждения защита не действует. Страница обновится автоматически, а если ожидание затянется, поддержка получит задачу.</p></Card>}
          {c.status === "COMPLETED" && policy && <Card title="Готово"><p className="text-sm">✓ Договор заключён (демо). <Link href={`/c/policies/${policy.id}`}>Открыть полис {policy.number}</Link></p></Card>}
        </div>
        <aside className="space-y-4">
          <Card title="Сводка">
            <KV items={[["Итого", <Money key="t" kop={s.quote.totalKop} />], ["Премия", <Money key="p" kop={s.quote.premiumKop} />], ["Сборы", <Money key="f" kop={s.quote.feesKop} />], ["Скидка", <Money key="d" kop={s.quote.discountKop} />], ["Страховщик", carrier.name], ["Агентство", agency?.name ?? "—"], ["Версия заявки", String(c.requestVersion)], ["Версия предложения", String(c.quoteSeq)]]} />
            {reserveActive && <p className="mt-3 text-sm"><Countdown label="Резерв цены" deadline={c.reservationExpiresAt.toISOString()} serverNow={t.toISOString()} /></p>}
            {reserveActive && <p className="mt-1 text-xs text-muted">На ознакомление, подпись и оплату есть 2 часа после матча, мы напомним за час и за 15 минут. Если не успеть, матч завершится. Тогда можно будет отправить новую заявку этому же агентству.</p>}
          </Card>
          {payments.length > 0 && <Card title="Платежи"><ul className="space-y-1 text-sm">{payments.map((p) => <li key={p.id}><Money kop={p.amountKop} /> · <Status group="payment" value={p.status} /> · {fmtDate(p.createdAt, true)}</li>)}</ul></Card>}
        </aside>
      </div>
    </>
  );
}
