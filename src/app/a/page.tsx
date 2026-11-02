import Link from "next/link";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { rankForAgency } from "@/server/domain/auction";
import { Card, Empty, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { AutoRefresh } from "@/components/client";

export default async function Feed() {
  const ctx = await requireAgencyPage();
  const t = await now();
  const auctions = await db.auction.findMany({ where: { status: { in: ["OPEN", "EXTENDED", "PAUSED"] }, eligibleOrgIds: { array_contains: [ctx.org.orgId] } }, orderBy: { closesAt: "asc" } });
  const reqs = await db.insuranceRequest.findMany({ where: { id: { in: auctions.map((a) => a.requestId) } } });
  const live = auctions.filter((a) => reqs.find((r) => r.id === a.requestId && r.currentVersion === a.requestVersion));
  const ranks = await Promise.all(live.map((a) => rankForAgency(ctx.org.orgId, a.requestId)));
  const drafts = await db.quote.findMany({ where: { agencyOrgId: ctx.org.orgId, status: "DRAFT" } });
  const tasks = await db.task.findMany({ where: { organizationId: ctx.org.orgId, status: "OPEN", OR: [{ assigneeId: ctx.user.id }, { assigneeId: null }] }, orderBy: { dueAt: "asc" }, take: 10 });
  const exc = await db.exceptionItem.findMany({ where: { organizationId: ctx.org.orgId, status: { not: "RESOLVED" } }, take: 10 });
  return (
    <>
      <AutoRefresh ms={6000} />
      <PageTitle title="Подходящие заявки" subtitle="Показаны заявки, по которым у агентства есть действующие полномочия. Контакты клиентов скрыты до выбора." />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          {live.length === 0 ? <Empty title="Открытых заявок нет" text="Новые заявки появятся автоматически." /> :
            <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Заявка</th><th>Регион</th><th>Приём до</th><th>Моё предложение</th></tr></thead><tbody>
              {live.map((a, i) => { const r = reqs.find((x) => x.id === a.requestId)!; const rk = ranks[i]?.find((x) => x.status !== "DRAFT"); return (
                <tr key={a.id}><td data-label="Заявка"><Link href={`/a/requests/${r.id}`}>{r.title}</Link><span className="text-xs text-muted"> · v{r.currentVersion}</span></td><td data-label="Регион">{r.territory ?? "—"}</td><td data-label="Приём до">{a.status === "PAUSED" ? "клиент оформляет выбор" : fmtDate(a.closesAt, true)}</td>
                  <td data-label="Моё предложение">{rk ? <>{rk.place} место из {rk.comparableCount}{rk.betterExists ? " · есть лучше" : ""}</> : <span className="text-muted">нет</span>}</td></tr>); })}
            </tbody></table></div>}
        </div>
        <aside className="space-y-4">
          {drafts.length > 0 && <Card title="Черновики на подтверждение"><ul className="space-y-1 text-sm">{drafts.map((d) => <li key={d.id}><Link href={`/a/requests/${d.requestId}`}>Черновик <Money kop={d.totalKop} /></Link> · {d.createdVia === "CONFIRM" ? "подготовлен автоматизацией" : "ручной"}</li>)}</ul></Card>}
          <Card title="Задачи">{tasks.length === 0 ? <p className="text-sm text-muted">Задач нет.</p> : <ul className="space-y-1 text-sm">{tasks.map((x) => <li key={x.id}>{x.title}{x.dueAt ? ` · до ${fmtDate(x.dueAt, true)}` : ""}</li>)}</ul>}</Card>
          {exc.length > 0 && <Card title="Требует внимания"><ul className="space-y-1 text-sm">{exc.map((e) => <li key={e.id}><Status value={e.priority} /> {e.reason}. <span className="text-muted">{e.nextAction}</span></li>)}</ul></Card>}
        </aside>
      </div>
    </>
  );
}
