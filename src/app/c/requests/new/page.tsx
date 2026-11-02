import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { PageTitle } from "@/components/ui";
import { NewRequest } from "@/components/newrequest";

export default async function New({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const ctx = await requireClientPage();
  const sp = await searchParams;
  const objects = await db.savedObject.findMany({ where: { clientId: ctx.user.id }, select: { id: true, title: true, kind: true } });
  return (<><PageTitle title="Новая заявка" subtitle="Черновик сохраняется автоматически, вернуться можно в любой момент." /><NewRequest preset={sp.product} objects={objects} /></>);
}
