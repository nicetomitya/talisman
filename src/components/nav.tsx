"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const path = usePathname();
  const active = (h: string) => path === h || (h.split("/").length > 2 && path.startsWith(h + "/")) || (path.startsWith(h + "/") && h !== "/c" && h !== "/a" && h !== "/admin");
  return (
    <nav aria-label="Разделы" className="mx-auto max-w-6xl overflow-x-auto px-2">
      <ul className="flex gap-1 whitespace-nowrap text-sm">
        {items.map((i) => (
          <li key={i.href}><Link href={i.href} aria-current={active(i.href) ? "page" : undefined} className={`inline-block rounded-t px-3 py-2 no-underline ${active(i.href) ? "border-b-2 border-accent font-semibold text-accent" : "text-ink hover:bg-bg"}`}>{i.label}{i.badge ? <span className="ml-1 rounded-full bg-accent px-1.5 text-xs text-white">{i.badge}</span> : null}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
