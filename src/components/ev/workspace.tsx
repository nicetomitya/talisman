import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { pageCtx } from "@/server/page";
import type { Ctx } from "@/server/access";
import { UsShell } from "./shell";

const TABS = [["/app", "My risks"], ["/app/portfolio", "Portfolio"], ["/app/expert", "Expert"], ["/app/account", "Account & eligibility"]];
export async function requireUsClient(next: string): Promise<Ctx> {
  const ctx = await pageCtx().catch(() => null);
  if (!ctx) redirect(`/signin?next=${encodeURIComponent(next)}`);
  if (ctx.user.kind !== "CLIENT") redirect(ctx.org?.orgType === "PLATFORM" ? "/ops" : "/go");
  return ctx;
}
export function Workspace({ ctx, active, children }: { ctx: Ctx; active: string; children: ReactNode }) {
  return (
    <UsShell ctx={ctx}>
      <nav aria-label="Workspace" className="-mt-2 mb-4 overflow-x-auto"><ul className="flex gap-1 whitespace-nowrap text-sm">{TABS.map(([h, l]) => <li key={h}><Link href={h} aria-current={active === h ? "page" : undefined} className={`inline-block rounded-t px-3 py-2 no-underline ${active === h ? "border-b-2 border-[#0f7a4f] font-semibold text-[#0f7a4f]" : "text-ink hover:bg-white"}`}>{l}</Link></li>)}</ul></nav>
      {children}
    </UsShell>
  );
}
