import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { Empty, PageTitle, fmtDate } from "@/components/ui";

export default async function Objects() {
  const ctx = await requireClientPage();
  const list = await db.savedObject.findMany({ where: { clientId: ctx.user.id }, orderBy: { updatedAt: "desc" } });
  return (<><PageTitle title="Сохранённые объекты" subtitle="Используются для быстрого заполнения новых заявок. Ключевые поля при повторном использовании нужно перепроверить." />
    {list.length === 0 ? <Empty title="Объектов нет" /> : <ul className="grid gap-3 sm:grid-cols-2">{list.map((o) => <li key={o.id} className="card"><p className="font-semibold">{o.title}</p><p className="text-xs text-muted">{o.kind === "CAR" ? "Автомобиль" : o.kind === "PROPERTY" ? "Недвижимость" : "Бронирование"} · обновлён {fmtDate(o.updatedAt)}</p><dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 text-sm">{Object.entries(o.data as any).slice(0, 8).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{Array.isArray(v) ? v.join(", ") : String(v)}</dd></div>)}</dl></li>)}</ul>}</>);
}
