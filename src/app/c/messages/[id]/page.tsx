import { notFound } from "next/navigation";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { PageTitle } from "@/components/ui";
import { Chat } from "@/components/chat";

export default async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClientPage();
  const { id } = await params;
  const c = await db.conversation.findFirst({ where: { id, clientId: ctx.user.id } });
  if (!c) notFound();
  const agency = c.agencyOrgId ? await db.organization.findUnique({ where: { id: c.agencyOrgId } }) : null;
  return (<><PageTitle title={c.title} subtitle={agency ? `Агентство: ${agency.name}. Обычное время ответа: до ${c.slaMinutes} минут в рабочее время.` : undefined} /><Chat id={c.id} me={ctx.user.id} allowAssistant={c.contextType !== "REQUEST"} /></>);
}
