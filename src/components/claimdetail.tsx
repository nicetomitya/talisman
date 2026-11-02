import { db } from "@/server/db";
import { Card, KV, Money, Status, fmtDate } from "./ui";
import { DocLink } from "./client";
import { ClaimStaffActions } from "./staff";
import { staffActionsFor } from "./claimstaff";
import { EventCheckView } from "./eventcheck";

/** Карточка обращения для сотрудников (агентство, страховщик, платформа). */
export async function StaffClaimDetail({ claimId, role }: { claimId: string; role: "AGENT" | "CARRIER" | "ADMIN" }) {
  const c = await db.claim.findUniqueOrThrow({ where: { id: claimId } });
  const [p, events, docs, payouts, ec] = await Promise.all([
    db.policy.findUniqueOrThrow({ where: { id: c.policyId }, include: { coverages: true } }),
    db.claimEvent.findMany({ where: { claimId: c.id }, orderBy: { createdAt: "asc" } }),
    db.document.findMany({ where: { claimId: c.id } }),
    db.payoutItem.findMany({ where: { claimId: c.id } }),
    c.eventCheckId ? db.eventCheck.findUnique({ where: { id: c.eventCheckId } }) : null,
  ]);
  const actions = staffActionsFor(c.status, role);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`Обращение ${c.number}`}>
        <KV items={[["Статус", <Status key="s" group="claim" value={c.status} />], ["Тип", c.type === "PARAMETRIC" ? "Параметрическое" : "Классическое"], ["Полис", `${p.number} · ${p.objectTitle}`], ["Дата события", fmtDate(c.eventDate)], ["Описание", c.description ?? "—"], ["Срок ответа (SLA)", fmtDate(c.slaDueAt, true)], ["Решение", c.decision ? `${c.decision}: ${c.decisionReason ?? ""}` : "—"], ["Спор", c.disputeReason ?? "—"]]} />
        <div className="mt-3 border-t border-line pt-3 text-sm"><p className="font-medium">Лимиты</p>{p.coverages.map((x) => <p key={x.id}>{x.title}: выплачено <Money kop={x.paidKop} /> из <Money kop={x.limitKop} /></p>)}</div>
      </Card>
      <Card title="Действия">{actions.length ? <ClaimStaffActions claimId={c.id} actions={actions} needAmount={c.type === "CLASSIC"} /> : <p className="text-sm text-muted">Для вашей роли в этом статусе действий нет.</p>}
        {role === "AGENT" && <p className="mt-2 text-xs text-muted">Решение о выплате принимает страховщик. Агентство помогает клиенту собрать документы.</p>}</Card>
      <Card title="Документы и выплаты">
        <ul className="space-y-1 text-sm">{docs.map((d) => <li key={d.id}>{["CLEAN", "GENERATED"].includes(d.status) ? <DocLink id={d.id} title={d.title} /> : d.title} · <Status group="doc" value={d.status} /></li>)}</ul>
        {payouts.map((x) => <p key={x.id} className="mt-2 text-sm">Выплата <Money kop={x.amountKop} /> · {x.status} · основание {x.basisKey.slice(0, 8)}</p>)}
      </Card>
      <Card title="История"><ol className="space-y-1 text-sm">{events.map((e) => <li key={e.id}>{fmtDate(e.createdAt, true)} · {e.type}{e.note ? `: ${e.note}` : ""}</li>)}</ol></Card>
      {ec && <Card title="Проверка события" className="lg:col-span-2"><EventCheckView ec={ec} unit={p.productCode === "RAIN01" ? "мм" : "м/с"} tz={p.timezone} /></Card>}
    </div>
  );
}
