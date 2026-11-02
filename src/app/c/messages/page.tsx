import Link from "next/link";
import { requireClientPage } from "@/server/page";
import { listConversations } from "@/server/domain/messaging";
import { db } from "@/server/db";
import { Empty, PageTitle, fmtDate } from "@/components/ui";

export default async function Messages() {
  const ctx = await requireClientPage();
  const list = await listConversations(ctx);
  const unread = await db.message.groupBy({ by: ["conversationId"], where: { conversationId: { in: list.map((c: any) => c.id) }, readByClientAt: null, authorRole: { not: "CLIENT" } }, _count: true });
  return (<><PageTitle title="Сообщения" />{list.length === 0 ? <Empty title="Переписки нет" text="Чат появляется после выбора предложения агентства." /> :
    <ul className="space-y-2">{list.map((c: any) => { const u = unread.find((x) => x.conversationId === c.id)?._count ?? 0; return <li key={c.id} className="card !p-3"><Link href={`/c/messages/${c.id}`} className="font-medium">{c.title}</Link>{u > 0 && <span className="ml-2 rounded-full bg-accent px-2 text-xs text-white">{u} новых</span>}<p className="text-xs text-muted">Обновлено {fmtDate(c.updatedAt, true)}</p></li>; })}</ul>}</>);
}
