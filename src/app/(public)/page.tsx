import Link from "next/link";
import { db } from "@/server/db";
import { rub } from "@/server/money";

export default async function Home() {
  const products = await db.product.findMany({ where: { status: "PUBLISHED" }, orderBy: { code: "asc" } });
  const orgs = await db.organization.findMany({ where: { id: { in: [...new Set(products.map((p) => p.carrierOrgId))] } } });
  return (
    <div className="space-y-8">
      <section className="rounded-xl bg-white p-6 shadow-sm sm:p-10">
        <h1 className="text-2xl font-semibold sm:text-3xl">Опишите, что нужно застраховать, и сравните предложения агентств</h1>
        <p className="mt-3 max-w-2xl text-muted">Заявка публикуется для проверенных агентств с полномочиями от страховщиков. Агентства снижают цену в открытом подборе, вы сравниваете сопоставимые условия и выбираете сами. Сроки и правила показаны заранее, без давления.</p>
        <div className="mt-5 flex flex-wrap gap-2"><Link href="/c/requests/new" className="btn btn-primary no-underline">Создать заявку</Link><Link href="/catalog" className="btn btn-secondary no-underline">Посмотреть продукты</Link></div>
        <p className="mt-4 text-xs text-muted">Это демонстрация: страховщики, агентства и документы вымышлены, оплата и выплаты эмулируются.</p>
      </section>
      <section aria-labelledby="how"><h2 id="how" className="mb-3 text-lg font-semibold">Как это работает</h2>
        <ol className="grid gap-3 sm:grid-cols-4">
          {["Заполните анкету или загрузите документы: распознанные поля вы проверяете и подтверждаете.", "Агентства с полномочиями присылают предложения в течение заранее известного срока.", "Вы сравниваете предложения внутри групп с одинаковыми условиями и выбираете.", "Документы, подтверждение кодом и оплата страховщику напрямую. Полис и обращения в кабинете."].map((t, i) => <li key={i} className="card"><span className="text-sm font-semibold text-accent">Шаг {i + 1}</span><p className="mt-1 text-sm">{t}</p></li>)}
        </ol>
      </section>
      <section aria-labelledby="pr"><h2 id="pr" className="mb-3 text-lg font-semibold">Продукты</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <li key={p.id} className="card"><h3 className="font-semibold"><Link href={`/products/${p.code}`}>{p.title}</Link></h3><p className="mt-1 text-sm text-muted">{p.summary}</p><p className="mt-2 text-xs">Страховщик: {orgs.find((o) => o.id === p.carrierOrgId)?.name}. {p.instantQuote ? "Фиксированная цена, оформление сразу." : "Предложения от агентств."}</p></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
