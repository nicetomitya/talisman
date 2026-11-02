import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { Card, KV, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, ApiForm, DocLink, FileUpload } from "@/components/client";

const EV: Record<string, string> = { CREATED: "Создано", SUBMITTED: "Подано", STATUS: "Изменение статуса", NEEDS_INFO: "Запрошены сведения", DOC_ADDED: "Добавлен документ", DECISION: "Решение", PAYOUT: "Выплата", DISPUTE: "Спор" };

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClientPage();
  const { id } = await params;
  const c = await db.claim.findFirst({ where: { id, clientId: ctx.user.id } });
  if (!c) notFound();
  const [p, events, docs, payouts, conv] = await Promise.all([
    db.policy.findUniqueOrThrow({ where: { id: c.policyId } }),
    db.claimEvent.findMany({ where: { claimId: c.id }, orderBy: { createdAt: "asc" } }),
    db.document.findMany({ where: { claimId: c.id }, orderBy: { createdAt: "asc" } }),
    db.payoutItem.findMany({ where: { claimId: c.id } }),
    db.conversation.findFirst({ where: { contextType: "CLAIM", contextId: c.id } }),
  ]);
  const required = (c.requiredDocs as string[]) ?? [];
  const editable = ["DRAFT", "NEEDS_INFO"].includes(c.status);
  return (
    <>
      <PageTitle title={`Обращение ${c.number}`} subtitle={<>Полис <Link href={`/c/policies/${p.id}`}>{p.number}</Link> · <Status group="claim" value={c.status} /></>} actions={conv ? <Link href={`/c/messages/${conv.id}`} className="btn btn-secondary no-underline">Переписка</Link> : null} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Сведения">
          <KV items={[["Тип", c.type === "PARAMETRIC" ? "Параметрическое: создано автоматически по данным наблюдений" : "Классическое"], ["Дата события", fmtDate(c.eventDate)], ["Описание", c.description ?? "—"], ["Срок ответа", fmtDate(c.slaDueAt, true)], ["Статус у страховщика", c.carrierStatus ?? "—"], ...(c.decision ? [["Решение", `${c.decision}${c.decisionReason ? `: ${c.decisionReason}` : ""}`] as [string, string]] : []), ...(c.disputeReason ? [["Спор", c.disputeReason] as [string, string]] : [])]} />
          {c.status === "REJECTED" && <p className="mt-2 text-sm">Не согласны? Откройте спор ниже: его рассмотрит специалист, не участвовавший в решении.</p>}
        </Card>
        <Card title="Выплаты">{payouts.length === 0 ? <p className="text-sm text-muted">Выплат нет.</p> : <ul className="space-y-1 text-sm">{payouts.map((x) => <li key={x.id}><Money kop={x.amountKop} /> · {x.status === "PAID" ? "✓ выплачено" : x.status === "IN_PROGRESS" || x.status === "INITIATED" ? "выполняется" : x.status === "UNKNOWN" ? "результат уточняется" : "✕ не выполнена"} · получатель: {x.beneficiary} (демо)</li>)}</ul>}</Card>
        {c.type === "CLASSIC" && <Card title="Документы">
          {required.length > 0 && <p className="mb-2 text-sm">Нужны: {required.join(", ")}.</p>}
          <ul className="mb-3 space-y-1 text-sm">{docs.map((d) => <li key={d.id}>{d.status === "CLEAN" || d.status === "GENERATED" ? <DocLink id={d.id} title={d.title} /> : d.title} · <Status group="doc" value={d.status} /></li>)}</ul>
          {editable && <FileUpload url={`/api/claims/${c.id}/upload`} />}
          {editable && <div className="mt-3"><Action url={`/api/claims/${c.id}/submit`} label={c.status === "NEEDS_INFO" ? "Отправить дополнения" : "Подать обращение"} variant="primary" /></div>}
        </Card>}
        <Card title="История"><ol className="space-y-1 text-sm">{events.map((e) => <li key={e.id}>{fmtDate(e.createdAt, true)} · {EV[e.type] ?? e.type}{e.note ? `: ${e.note}` : ""}</li>)}</ol></Card>
        {["REJECTED", "PAID", "APPROVED", "CLOSED", "REVIEWING"].includes(c.status) && <Card title="Оспорить"><ApiForm url={`/api/claims/${c.id}/dispute`} submit="Открыть спор" successText="Спор зарегистрирован" fields={[{ name: "reason", label: "Причина несогласия", type: "textarea", required: true }]} /></Card>}
      </div>
    </>
  );
}
