import { requireAdminPage } from "@/server/page";
import { AppShell } from "@/components/shell";
import { db } from "@/server/db";
import { isCarrier, isSupport } from "@/components/adminctx";
import { StepUp } from "@/components/settings";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAdminPage();
  const carrier = isCarrier(ctx);
  const openExc = carrier ? 0 : await db.exceptionItem.count({ where: { status: { not: "RESOLVED" } } });
  const pendingApprovals = carrier ? 0 : await db.adminApproval.count({ where: { status: "PENDING" } });
  const nav = carrier ? [
    { href: "/admin", label: "Обзор" }, { href: "/admin/catalog", label: "Продукты и полномочия" }, { href: "/admin/claims", label: "Обращения" }, { href: "/admin/events", label: "События" }, { href: "/admin/settings", label: "Безопасность" },
  ] : [
    { href: "/admin", label: "Обзор" }, { href: "/admin/exceptions", label: "Исключения", badge: openExc }, { href: "/admin/orgs", label: "Организации" }, { href: "/admin/catalog", label: "Каталог" },
    { href: "/admin/requests", label: "Заявки" }, { href: "/admin/events", label: "События" }, { href: "/admin/claims", label: "Обращения" }, { href: "/admin/payments", label: "Платежи" },
    { href: "/admin/billing", label: "Доходы и подписки" }, { href: "/admin/documents", label: "Документы" }, { href: "/admin/reviews", label: "Отзывы" }, { href: "/admin/approvals", label: "Согласования", badge: pendingApprovals },
    { href: "/admin/audit", label: "Аудит" }, { href: "/admin/integrations", label: "Интеграции" }, { href: "/admin/settings", label: "Безопасность" },
  ];
  return (
    <AppShell ctx={ctx} area={carrier ? `Страховщик «${ctx.org.orgName}»` : isSupport(ctx) ? "Поддержка платформы" : "Администрирование"} nav={nav}>
      {!ctx.mfa && <div className="mb-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn"><p className="mb-2">! Изменения в административной части требуют подтверждения вторым фактором (TOTP).</p><StepUp /></div>}
      {children}
    </AppShell>
  );
}
