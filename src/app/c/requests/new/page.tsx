import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { PageTitle } from "@/components/ui";
import { NewRequest } from "@/components/newrequest";

export default async function New({ searchParams }: { searchParams: Promise<{ product?: string; text?: string; src?: string }> }) {
  const ctx = await requireClientPage();
  const sp = await searchParams;
  const objects = await db.savedObject.findMany({ where: { clientId: ctx.user.id }, select: { id: true, title: true, kind: true } });
  return (<><PageTitle title="Новая заявка" subtitle="Черновик сохраняется автоматически, вернуться можно в любой момент." /><NewRequest preset={sp.product} objects={objects} initialText={sp.text?.slice(0, 2000)} sourceDetail={sp.src && /^seo:[a-z0-9-]{1,60}$/.test(sp.src) ? sp.src : undefined} /></>);
}
