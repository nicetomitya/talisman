import Link from "next/link";
import type { ReactNode } from "react";
import type { Ctx } from "@/server/access";
import { SimRibbon } from "./ui";
import { SignOut } from "./client";

export function UsShell({ ctx, children, sim = true, wide = false }: { ctx: Ctx | null; children: ReactNode; sim?: boolean; wide?: boolean }) {
  const staff = ctx?.org?.orgType === "PLATFORM";
  return (
    <div className="flex min-h-screen flex-col">
      {sim && <SimRibbon />}
      <header className="border-b border-line bg-white">
        <nav aria-label="Main" className={`mx-auto flex ${wide ? "max-w-7xl" : "max-w-6xl"} flex-wrap items-center justify-between gap-2 px-4 py-3`}>
          <Link href="/" className="text-lg font-semibold text-[#0f7a4f] no-underline">Talisman</Link>
          <ul className="flex flex-wrap items-center gap-3 text-sm">
            <li><Link href="/risk/new">Describe a risk</Link></li>
            <li><Link href="/markets">Contracts</Link></li>
            <li><Link href="/how-it-works">How it works</Link></li>
            {staff && <li><Link href="/ops">Compliance</Link></li>}
            {ctx ? <>
              {!staff && <li><Link href="/app">My workspace</Link></li>}
              <li className="hidden text-muted sm:block">{ctx.user.name}</li>
              <li><SignOut /></li>
            </> : <li><Link className="btn btn-primary !min-h-0 !py-1.5 no-underline" href="/signin">Sign in</Link></li>}
          </ul>
        </nav>
      </header>
      <main id="main" className={`mx-auto w-full ${wide ? "max-w-7xl" : "max-w-6xl"} flex-1 px-4 py-6`}>{children}</main>
      <footer className="border-t border-line bg-white px-4 py-4 text-center text-xs text-muted">
        Talisman demo prototype. Not an exchange, broker, insurer or adviser. Availability of real event contracts depends on a regulated partner and your jurisdiction; none are offered here. <Link href="/how-it-works">Disclosures</Link> · <Link href="/insurance" lang="ru">Legacy insurance pilot (RU)</Link>
      </footer>
    </div>
  );
}
