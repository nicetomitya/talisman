import Link from "next/link";
import { GUIDES } from "@/lib/guides";

export const metadata = { title: "Ситуации и советы" };

export default function Guides() {
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">Ситуации и советы</h1>
      <p className="mb-4 text-sm text-muted">Короткие ответы по конкретным задачам. Из каждой можно перейти к разбору своей ситуации с помощником.</p>
      <ul className="grid gap-3 sm:grid-cols-2">{GUIDES.map((g) => <li key={g.slug}><Link href={`/guides/${g.slug}`} className="card block no-underline hover:border-accent"><span className="block font-semibold">{g.title}</span><span className="mt-1 block text-sm text-muted">{g.question}</span></Link></li>)}</ul>
    </section>
  );
}
