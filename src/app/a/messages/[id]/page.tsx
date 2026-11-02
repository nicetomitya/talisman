import { notFound } from "next/navigation";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { PageTitle } from "@/components/ui";
import { Chat } from "@/components/chat";

export default async function AgencyConversation({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAgencyPage();
  const { id } = await params;
  const c = await db.conversation.findFirst({ where: { id, agencyOrgId: ctx.org.orgId } });
  if (!c) notFound();
  return (<><PageTitle title={c.title} /><Chat id={c.id} me={ctx.user.id} allowAssistant={false} /></>);
}
