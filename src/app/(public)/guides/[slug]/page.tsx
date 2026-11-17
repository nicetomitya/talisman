import Link from "next/link";
import { notFound } from "next/navigation";
import { GUIDES, guideBySlug } from "@/lib/guides";
import { PageView } from "@/components/client";

export function generateStaticParams() { return GUIDES.map((g) => ({ slug: g.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const g = guideBySlug((await params).slug);
  return { title: g?.title ?? "Статья", description: g?.answer.slice(0, 160) };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const g = guideBySlug((await params).slug);
  if (!g) notFound();
  const cta = `/c/requests/new?text=${encodeURIComponent(g.prefill)}&src=${encodeURIComponent(`seo:${g.slug}`)}`;
  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <PageView />
      <p className="text-sm"><Link href="/guides">← Все ситуации</Link></p>
      <h1 className="text-2xl font-semibold">{g.title}</h1>
      <section className="card"><h2 className="font-semibold">{g.question}</h2><p className="mt-2">{g.answer}</p></section>
      <section className="card"><h2 className="font-semibold">Какие риски бывают</h2><ul className="mt-2 list-disc space-y-1 pl-5">{g.risks.map((r) => <li key={r}>{r}</li>)}</ul></section>
      <section className="card"><h2 className="font-semibold">Чек-лист перед заявкой</h2><ul className="mt-2 list-disc space-y-1 pl-5">{g.checklist.map((r) => <li key={r}>{r}</li>)}</ul></section>
      <section className="card"><h2 className="font-semibold">Примеры условий</h2><ul className="mt-2 list-disc space-y-1 pl-5">{g.examples.map((r) => <li key={r}>{r}</li>)}</ul></section>
      <div className="card flex flex-wrap items-center justify-between gap-3"><p>Помощник задаст уточняющие вопросы и соберёт заявку. Предложения сравните сами.</p><Link className="btn btn-primary no-underline" href={cta}>Разобрать мою ситуацию с AI</Link></div>
      <p className="text-xs text-muted">Актуально на {new Date(g.reviewedAt).toLocaleDateString("ru-RU")}. Источник: демонстрационные условия продуктов платформы. Раскрытие: «Талисман» не является страховщиком; на странице нет рекламных и партнёрских размещений. Примеры не являются офертой.</p>
    </article>
  );
}
