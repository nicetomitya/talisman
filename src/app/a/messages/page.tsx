import Link from "next/link";
import { requireAgencyPage } from "@/server/page";
import { listConversations } from "@/server/domain/messaging";
import { db } from "@/server/db";
import { Empty, PageTitle, fmtDate } from "@/components/ui";

export default async function AgencyMessages() {
  const ctx = await requireAgencyPage();
  const list = await listConversations(ctx);
  const unread = await db.message.groupBy({ by: ["conversationId"], where: { conversationId: { in: list.map((c) => c.id) }, readByAgencyAt: null, authorRole: "CLIENT" }, _count: true });
  return (<><PageTitle title="Сообщения" />{list.length === 0 ? <Empty title="Переписки нет" /> : <ul className="space-y-2">{list.map((c) => { const u = unread.find((x) => x.conversationId === c.id)?._count ?? 0; const last = c.messages[0];
    const overdue = last && last.authorRole === "CLIENT" && Date.now() - new Date(last.createdAt).getTime() > c.slaMinutes * 60_000;
    return <li key={c.id} className="card !p-3"><Link href={`/a/messages/${c.id}`} className="font-medium">{c.title}</Link>{u > 0 && <span className="ml-2 rounded-full bg-accent px-2 text-xs text-white">{u} новых</span>}{overdue && <span className="ml-2 text-xs text-bad">✕ просрочен ответ (SLA {c.slaMinutes} мин)</span>}<p className="text-xs text-muted">{last ? `${last.body.slice(0, 80)} · ` : ""}{fmtDate(c.updatedAt, true)}</p></li>; })}</ul>}</>);
}
