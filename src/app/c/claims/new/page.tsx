import { requireClientPage } from "@/server/page";
import { PageTitle } from "@/components/ui";
import { IncidentTriage } from "@/components/cabinet";

export const metadata = { title: "Страховой случай" };

export default async function NewIncident({ searchParams }: { searchParams: Promise<{ text?: string }> }) {
  await requireClientPage();
  const sp = await searchParams;
  return (<><PageTitle title="Страховой случай" subtitle="Опишите, что произошло, обычными словами. Помощник найдёт подходящие полисы и подскажет первые шаги. Решение о выплате принимает страховщик." /><IncidentTriage initial={sp.text?.slice(0, 2000)} /></>);
}
