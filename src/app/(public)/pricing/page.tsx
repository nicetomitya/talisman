import { db } from "@/server/db";
import { PageTitle } from "@/components/ui";
import { rub } from "@/server/money";

export const metadata = { title: "Тарифы для агентств" };
const F: Record<string, string> = { autoReply: "Автоматические ответы", roles: "Роли и распределение", analytics: "Аналитика" };
export default async function Pricing() {
  const plans = await db.plan.findMany({ orderBy: { priceKop: "asc" } });
  return (
    <>
      <PageTitle title="Тарифы для агентств" subtitle="Подписка дает доступ к заявкам и инструментам. Комиссия за полис рассчитывается отдельно по условиям распределения. Пробный период 14 дней. Все суммы демонстрационные, реальные списания не выполняются." />
      <ul className="grid gap-4 sm:grid-cols-3">
        {plans.map((p) => { const f = p.features as any; return (
          <li key={p.id} className="card"><h2 className="text-lg font-semibold">{p.title}</h2><p className="mt-1 text-2xl font-semibold num">{rub(p.priceKop)}<span className="text-sm font-normal text-muted"> / мес.</span></p>
            <ul className="mt-3 space-y-1 text-sm"><li>Пользователей: {p.maxUsers}</li><li>Ответов на заявки в месяц: {p.maxResponses}</li>{Object.entries(F).map(([k, t]) => <li key={k}>{f?.[k] ? "✓" : "✕"} {t}</li>)}</ul></li>); })}
      </ul>
      <p className="mt-4 text-sm text-muted">Автопродление включается только отдельным согласием и отключается в один клик. При неуспешной оплате действует льготный период 7 дней, после него доступ к новым заявкам ограничивается, а данные и действующие сделки сохраняются.</p>
    </>
  );
}
