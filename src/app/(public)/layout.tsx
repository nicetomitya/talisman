import Link from "next/link";
import { pageCtx, homeFor } from "@/server/page";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageCtx().catch(() => null);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-white">
        <nav aria-label="Основное меню" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/" className="text-lg font-semibold text-accent no-underline">Талисман</Link>
          <ul className="flex flex-wrap items-center gap-3 text-sm">
            <li><Link href="/catalog">Продукты</Link></li>
            <li><Link href="/pricing">Агентствам</Link></li>
            <li><Link href="/help">Помощь</Link></li>
            <li>{ctx ? <Link className="btn btn-primary !min-h-0 !py-1.5 no-underline" href={homeFor(ctx)}>Кабинет</Link> : <Link className="btn btn-primary !min-h-0 !py-1.5 no-underline" href="/login">Войти</Link>}</li>
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-line bg-white px-4 py-4 text-center text-xs text-muted">
        Демонстрационный прототип «Талисман». Не является страховой организацией или брокером, полисы не продаются. <Link href="/legal">Документы платформы</Link>
      </footer>
    </div>
  );
}
