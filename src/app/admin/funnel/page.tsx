import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { isCarrier } from "@/components/adminctx";
import { PageTitle } from "@/components/ui";
import { label } from "@/server/domain/labels";

export const metadata = { title: "Воронка по источникам" };

/** Сквозная воронка (ТЗ 16.11, п. 8.1): источник → заявка → публикация → предложения → полис. Агрегаты без персональных данных. */
export default async function Funnel() {
  const ctx = await requireAdminPage();
  if (isCarrier(ctx)) redirect("/admin");
  const reqs = await db.insuranceRequest.findMany({ select: { id: true, source: true, sourceDetail: true, currentVersion: true } });
  const withQuotes = new Set((await db.quote.findMany({ where: { status: { in: ["PUBLISHED", "SELECTED", "REPLACED", "EXPIRED"] } }, select: { requestId: true }, distinct: ["requestId"] })).map((q) => q.requestId));
  const withPolicy = new Set((await db.policy.findMany({ where: { contractStatus: { in: ["CONCLUDED", "EXPIRED", "TERMINATED"] } }, select: { requestId: true } })).map((p) => p.requestId));
  const key = (r: { source: string; sourceDetail: string | null }) => r.sourceDetail?.startsWith("seo:") ? `SEO · ${r.sourceDetail.slice(4)}` : r.sourceDetail?.startsWith("market-check") ? "Проверка рынка по полису" : label("source", r.source);
  const rows = new Map<string, { created: number; published: number; offers: number; policies: number }>();
  for (const r of reqs) {
    const k = key(r); const x = rows.get(k) ?? { created: 0, published: 0, offers: 0, policies: 0 };
    x.created++; if (r.currentVersion > 0) x.published++; if (withQuotes.has(r.id)) x.offers++; if (withPolicy.has(r.id)) x.policies++;
    rows.set(k, x);
  }
  const views = await db.analyticsEvent.count({ where: { name: "page_view", props: { path: ["path"], string_starts_with: "/guides/" } } }).catch(() => 0);
  return (<><PageTitle title="Воронка по источникам" subtitle="Заявки по источнику клиента и заявки. Импортированные контакты без регистрации сюда не попадают и пользователями не считаются." />
    <p className="mb-3 text-sm">Просмотры страниц «Ситуации» (с согласием на аналитику): <span className="num">{views}</span></p>
    <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Источник</th><th>Заявки</th><th>Опубликованы</th><th>С предложениями</th><th>Полис выпущен</th></tr></thead><tbody>
      {[...rows.entries()].sort((a, b) => b[1].created - a[1].created).map(([k, v]) => <tr key={k}><td data-label="Источник">{k}</td><td data-label="Заявки" className="num">{v.created}</td><td data-label="Опубликованы" className="num">{v.published}</td><td data-label="С предложениями" className="num">{v.offers}</td><td data-label="Полис" className="num">{v.policies}</td></tr>)}
    </tbody></table></div></>);
}
