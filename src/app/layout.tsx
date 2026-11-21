import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { isDemo } from "@/server/config";
import { pageCtx } from "@/server/page";
import { headers } from "next/headers";
import { CookieBanner, PageView } from "@/components/client";
import { isUsPath } from "@/lib/area";

export const metadata: Metadata = { title: { default: "Талисман — демонстрационный прототип", template: "%s · Талисман (демо)" }, description: "Демонстрационный прототип страховой платформы. Не является страховой организацией и не продаёт полисы." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageCtx().catch(() => null);
  const us = isUsPath((await headers()).get("x-pathname") ?? "/");
  if (us) return (
    <html lang="en-US">
      <body className="min-h-screen bg-bg text-ink">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Skip to content</a>
        {children}
        <CookieBanner loggedIn={!!ctx} lang="en" />
        <PageView />
      </body>
    </html>
  );
  return (
    <html lang="ru">
      <body className="min-h-screen bg-bg text-ink">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Перейти к содержимому</a>
        {isDemo() && (
          <div className="bg-warn-soft px-4 py-1.5 text-center text-xs text-warn" role="note">
            <strong>Демонстрация.</strong> Все страховщики, полисы, платежи и выплаты вымышлены. Документы не являются действующими страховыми полисами. <Link href="/demo" className="underline">Демопанель</Link>
          </div>
        )}
        {children}
        <CookieBanner loggedIn={!!ctx} />
        <PageView />
      </body>
    </html>
  );
}
