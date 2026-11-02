import Link from "next/link";
import type { ReactNode } from "react";
import type { Ctx } from "@/server/access";
import { db } from "@/server/db";
import { LogoutButton, OrgSwitcher } from "./client";
import { NavLinks } from "./nav";

const ROLE: Record<string, string> = { AGENCY_OWNER: "владелец", AGENT: "агент", ADMIN: "администратор", SUPPORT: "поддержка", CARRIER_REP: "представитель страховщика" };

export async function AppShell({ ctx, nav, area, children }: { ctx: Ctx; nav: { href: string; label: string; badge?: number }[]; area: string; children: ReactNode }) {
  const unread = await db.notification.count({ where: { userId: ctx.user.id, readAt: null } });
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-3">
            <Link href="/" className="font-semibold text-accent no-underline">Талисман</Link>
            <span className="rounded bg-bg px-2 py-0.5 text-xs text-muted">{area}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <OrgSwitcher orgs={ctx.memberships.map((m) => ({ id: m.orgId, name: m.orgName, role: ROLE[m.role] ?? m.role }))} current={ctx.org?.orgId} />
            <Link href={ctx.user.kind === "CLIENT" ? "/c/notifications" : ctx.org?.orgType === "AGENCY" ? "/a/notifications" : "/admin/notifications"} className="no-underline" aria-label={`Уведомления, непрочитанных: ${unread}`}>🔔 <span className="num">{unread}</span></Link>
            <span className="hidden text-muted sm:inline">{ctx.user.name}{ctx.org ? ` · ${ROLE[ctx.org.role] ?? ""}` : ""}{ctx.isDemoSwitch ? " · демо-вход" : ""}</span>
            <LogoutButton />
          </div>
        </div>
        <NavLinks items={nav} />
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">{children}</main>
      <footer className="border-t border-line bg-white px-4 py-3 text-center text-xs text-muted">Демонстрационный прототип. Не является страховой организацией и не продаёт полисы. <Link href="/legal">Документы платформы</Link></footer>
    </div>
  );
}
