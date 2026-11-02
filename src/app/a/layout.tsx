import { requireAgencyPage } from "@/server/page";
import { AppShell } from "@/components/shell";
import { db } from "@/server/db";
import { label } from "@/server/domain/labels";
import Link from "next/link";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAgencyPage();
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.orgId } });
  const sub = await db.subscription.findUnique({ where: { organizationId: org.id } });
  const owner = ctx.org.role === "AGENCY_OWNER";
  const nav = [
    { href: "/a", label: "Заявки" }, { href: "/a/deals", label: "Сделки" }, { href: "/a/claims", label: "Обращения" }, { href: "/a/messages", label: "Сообщения" },
    { href: "/a/automation", label: "Автоматизация" }, { href: "/a/products", label: "Продукты" }, { href: "/a/rating", label: "Рейтинг" }, { href: "/a/earnings", label: "Вознаграждение" },
    ...(owner ? [{ href: "/a/subscription", label: "Подписка" }, { href: "/a/team", label: "Команда" }] : []), { href: "/a/settings", label: "Настройки" },
  ];
  return (
    <AppShell ctx={ctx} area={`Агентство «${org.name}»`} nav={nav}>
      {org.verificationStatus !== "VERIFIED" && <p role="alert" className="mb-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn">! Агентство не прошло проверку платформы: подходящие заявки не показываются, предложения отправлять нельзя. Проверка выполняется администратором.</p>}
      {org.status === "BLOCKED" && <p role="alert" className="mb-4 rounded-md border border-bad/30 bg-bad-soft p-3 text-sm text-bad">✕ Агентство заблокировано: {org.blockReason}</p>}
      {sub && ["PAST_DUE", "GRACE", "RESTRICTED"].includes(sub.status) && <p role="alert" className="mb-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn">! Подписка: {label("subscription", sub.status)}{sub.graceUntil ? ` до ${sub.graceUntil.toLocaleDateString("ru-RU")}` : ""}. {sub.status === "RESTRICTED" ? "Новые заявки недоступны, действующие сделки и данные сохранены." : "Ответы на заявки пока доступны."} {owner && <Link href="/a/subscription">Оплатить</Link>}</p>}
      {children}
    </AppShell>
  );
}
