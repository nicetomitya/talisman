import Link from "next/link";
import { pageCtx } from "@/server/page";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { Empty, PageTitle, fmtDate } from "@/components/ui";
import { Action } from "@/components/client";

export async function NotificationsView() {
  const ctx = await pageCtx();
  if (!ctx) redirect("/login");
  const list = await db.notification.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (<><PageTitle title="Уведомления" actions={<Action url="/api/notifications" body={{ all: true }} label="Отметить все прочитанными" />} />
    {list.length === 0 ? <Empty title="Уведомлений нет" /> : <ul className="space-y-2">{list.map((n) => <li key={n.id} className={`card !p-3 ${n.readAt ? "" : "border-accent"}`}><p className="text-sm">{!n.readAt && <span className="sr-only">Новое: </span>}{!n.readAt && <span aria-hidden className="text-accent">● </span>}<strong>{n.title}</strong> · {n.body}</p><p className="text-xs text-muted">{fmtDate(n.createdAt, true)}{n.category === "MARKETING" ? " · маркетинг" : ""} {n.link && <Link href={n.link}>Открыть</Link>}</p></li>)}</ul>}</>);
}

