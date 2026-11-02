import { notFound } from "next/navigation";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { isDemo } from "@/server/config";
import { PageTitle, Empty, fmtDate } from "@/components/ui";
import { AutoRefresh } from "@/components/client";

export default async function Mail() {
  if (!isDemo()) notFound();
  const ctx = await requireClientPage();
  const mails = await db.demoMail.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 30 });
  return (<><PageTitle title="Демопочта" subtitle="Письма платформы для вашего демо-аккаунта. Реальная отправка не выполняется." /><AutoRefresh ms={5000} />
    {mails.length === 0 ? <Empty title="Писем нет" /> : <ul className="space-y-2">{mails.map((m) => <li key={m.id} className="card"><p className="font-medium">{m.subject}</p><p className="text-xs text-muted">{fmtDate(m.createdAt, true)} · {m.category === "MARKETING" ? "маркетинг" : "сервисное"}</p><pre className="mt-2 whitespace-pre-wrap break-words text-sm">{m.body}</pre></li>)}</ul>}</>);
}
