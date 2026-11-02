import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { Card, Empty, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, InlineInput } from "@/components/client";
import { isCarrier } from "@/components/adminctx";

const T: Record<string, string> = { DATA: "Данные", CALCULATION: "Расчёт", CHECKOUT: "Оформление", PAYMENT: "Платёж", OBSERVATION: "Наблюдения", PAYOUT: "Выплата", AUTOMATION: "Автоматизация", DISPUTE: "Спор" };
const PR: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export default async function Exceptions({ searchParams }: { searchParams: Promise<{ type?: string; all?: string }> }) {
  const ctx = await requireAdminPage();
  if (isCarrier(ctx)) redirect("/admin");
  const sp = await searchParams;
  const t = await now();
  const list = (await db.exceptionItem.findMany({ where: { ...(sp.all ? {} : { status: { not: "RESOLVED" } }), ...(sp.type ? { type: sp.type } : {}) }, orderBy: { dueAt: "asc" }, take: 200 })).sort((a, b) => PR[a.priority] - PR[b.priority] || +a.dueAt - +b.dueAt);
  const users = await db.user.findMany({ where: { id: { in: list.map((e) => e.assigneeId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return (
    <>
      <PageTitle title="Очередь исключений" subtitle="Тип, приоритет, срок, исполнитель, причина и следующее действие. Каждое действие журналируется." />
      <nav aria-label="Фильтр" className="mb-3 flex flex-wrap gap-2 text-sm"><a href="/admin/exceptions">Открытые</a>{Object.entries(T).map(([k, v]) => <a key={k} href={`/admin/exceptions?type=${k}`}>{v}</a>)}<a href="/admin/exceptions?all=1">Все, включая решённые</a></nav>
      {list.length === 0 ? <Empty title="Исключений нет" /> : <ul className="space-y-3">{list.map((e) => (
        <li key={e.id}><Card>
          <div className="flex flex-wrap items-center gap-2 text-sm"><Status value={e.priority} /> <strong>{T[e.type] ?? e.type}</strong> · {e.entityType} {e.entityId.slice(0, 8)} · <Status value={e.status} /> · срок {fmtDate(e.dueAt, true)}{e.dueAt < t && e.status !== "RESOLVED" && <span className="text-bad">✕ просрочено</span>}</div>
          <p className="mt-1 text-sm">{e.reason}</p>
          <p className="text-sm text-muted">Следующее действие: {e.nextAction}. Исполнитель: {users.find((u) => u.id === e.assigneeId)?.name ?? "не назначен"}.</p>
          {Array.isArray(e.actions) && (e.actions as any[]).length > 0 && <details className="mt-1 text-xs"><summary className="cursor-pointer">Журнал ({(e.actions as any[]).length})</summary><ul>{(e.actions as any[]).map((a, i) => <li key={i}>{a.at ? fmtDate(a.at, true) : ""} · {a.action}{a.note ? `: ${a.note}` : ""}</li>)}</ul></details>}
          {e.resolution && <p className="mt-1 text-sm text-ok">✓ {e.resolution}</p>}
          {e.status !== "RESOLVED" && <div className="mt-2 grid gap-2 sm:grid-cols-[auto_auto_1fr]">
            <Action url="/api/admin/exception" body={{ id: e.id, action: "ASSIGN_ME", note: "" }} label="Взять себе" />
            <Action url="/api/admin/exception" body={{ id: e.id, action: "WAITING_INFO", note: "Ожидаем сведения" }} label="Ждём сведения" />
            <InlineInput url="/api/admin/exception" name="note" label="Решение (обязательно с описанием)" submit="Закрыть" extra={{ id: e.id, action: "RESOLVE" }} />
          </div>}
        </Card></li>))}</ul>}
    </>
  );
}
