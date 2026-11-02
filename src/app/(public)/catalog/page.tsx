import Link from "next/link";
import { db } from "@/server/db";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Продукты" };
export default async function Catalog() {
  const products = await db.product.findMany({ where: { status: "PUBLISHED" }, orderBy: { code: "asc" } });
  const orgs = await db.organization.findMany({ where: { type: "CARRIER" } });
  return (
    <>
      <PageTitle title="Продукты" subtitle="Все продукты демонстрационные. Условия и цены вымышлены." />
      <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Продукт</th><th>Страховщик</th><th>Как получить цену</th><th></th></tr></thead><tbody>
        {products.map((p) => (<tr key={p.id}><td data-label="Продукт"><strong>{p.title}</strong><div className="text-xs text-muted">{p.summary}</div></td><td data-label="Страховщик">{orgs.find((o) => o.id === p.carrierOrgId)?.name}</td><td data-label="Цена">{p.instantQuote ? "Фиксированная по тарифу" : "Подбор предложений агентств"}</td><td><Link href={`/products/${p.code}`}>Подробнее</Link></td></tr>))}
      </tbody></table></div>
    </>
  );
}
