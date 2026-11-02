import { requireClientPage } from "@/server/page";
import { AppShell } from "@/components/shell";
import { db } from "@/server/db";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireClientPage();
  const unreadMsgs = await db.message.count({ where: { conversation: { clientId: ctx.user.id }, readByClientAt: null, authorRole: { not: "CLIENT" } } });
  return (
    <AppShell ctx={ctx} area="Кабинет клиента" nav={[
      { href: "/c", label: "Обзор" }, { href: "/c/requests", label: "Заявки" }, { href: "/c/policies", label: "Полисы" }, { href: "/c/claims", label: "Обращения" },
      { href: "/c/messages", label: "Сообщения", badge: unreadMsgs }, { href: "/c/documents", label: "Документы" }, { href: "/c/payments", label: "Платежи" },
      { href: "/c/objects", label: "Объекты" }, { href: "/c/settings", label: "Настройки" }, { href: "/c/mail", label: "Демопочта" },
    ]}>{children}</AppShell>
  );
}
