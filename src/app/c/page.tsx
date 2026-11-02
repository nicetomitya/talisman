import Link from "next/link";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { coverageState } from "@/server/domain/policies";
import { Card, Empty, Money, PageTitle, Status, fmtDate } from "@/components/ui";

export default async function ClientHome() {
  const ctx = await requireClientPage();
  const t = await now();
  const [reqs, checkouts, policies, claims, notes] = await Promise.all([
    db.insuranceRequest.findMany({ where: { clientId: ctx.user.id, status: { in: ["DRAFT", "NEEDS_INFO", "OPEN", "SELECTION"] } }, orderBy: { updatedAt: "desc" } }),
    db.checkout.findMany({ where: { clientId: ctx.user.id, status: { notIn: ["CANCELLED", "COMPLETED"] } } }),
    db.policy.findMany({ where: { clientId: ctx.user.id }, orderBy: { startsAt: "desc" } }),
    db.claim.findMany({ where: { clientId: ctx.user.id, status: { in: ["DRAFT", "NEEDS_INFO", "DECISION_PREPARED"] } } }),
    db.notification.findMany({ where: { userId: ctx.user.id, readAt: null }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const todo = [
    ...reqs.filter((r) => r.status === "NEEDS_INFO" || r.status === "DRAFT").map((r) => ({ href: `/c/requests/${r.id}`, text: `${r.title}: ${r.status === "NEEDS_INFO" ? "дополните анкету" : "черновик не опубликован"}` })),
    ...reqs.filter((r) => r.status === "SELECTION").map((r) => ({ href: `/c/requests/${r.id}`, text: `${r.title}: предложения собраны, выберите` })),
    ...checkouts.map((c) => ({ href: `/c/checkouts/${c.id}`, text: `Оформление: ${c.status === "PAYMENT" ? "ожидает оплаты" : c.status === "AWAITING_CARRIER" ? "ждём подтверждения страховщика" : "продолжите оформление"}` })),
    ...claims.map((c) => ({ href: `/c/claims/${c.id}`, text: `Обращение ${c.number}: ${c.status === "NEEDS_INFO" ? "нужны сведения" : c.status === "DRAFT" ? "не отправлено" : "решение подготовлено"}` })),
  ];
  return (
    <>
      <PageTitle title={`Здравствуйте, ${ctx.user.name.split(" ")[0]}`} actions={<Link className="btn btn-primary no-underline" href="/c/requests/new">Новая заявка</Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Что нужно сделать">{todo.length ? <ul className="space-y-2 text-sm">{todo.map((x, i) => <li key={i}>→ <Link href={x.href}>{x.text}</Link></li>)}</ul> : <p className="text-sm text-muted">Сейчас от вас ничего не требуется.</p>}</Card>
        <Card title="Новые уведомления" actions={<Link href="/c/notifications" className="text-sm">Все</Link>}>{notes.length ? <ul className="space-y-2 text-sm">{notes.map((n) => <li key={n.id}><strong>{n.title}</strong> · {n.body} {n.link && <Link href={n.link}>Открыть</Link>}</li>)}</ul> : <p className="text-sm text-muted">Нет новых.</p>}</Card>
        <Card title="Полисы" className="lg:col-span-2">
          {policies.length === 0 ? <Empty title="Полисов пока нет" text="Создайте заявку, чтобы получить предложения." /> :
            <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Полис</th><th>Объект</th><th>Договор</th><th>Защита</th><th>Период</th><th>Премия</th></tr></thead><tbody>
              {policies.map((p) => <tr key={p.id}><td data-label="Полис"><Link href={`/c/policies/${p.id}`}>{p.number}</Link></td><td data-label="Объект">{p.objectTitle}</td><td data-label="Договор"><Status group="contract" value={p.contractStatus} /></td><td data-label="Защита"><Status group="coverage" value={coverageState(p, t)} /></td><td data-label="Период">{fmtDate(p.startsAt)} – {fmtDate(p.endsAt)}</td><td data-label="Премия"><Money kop={p.premiumKop} /></td></tr>)}
            </tbody></table></div>}
        </Card>
      </div>
    </>
  );
}
