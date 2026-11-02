import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { Card, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, ApiForm } from "@/components/client";

export default async function AgencyProducts() {
  const ctx = await requireAgencyPage();
  const mandates = await db.mandate.findMany({ where: { agencyOrgId: ctx.org.orgId }, orderBy: { validTo: "asc" } });
  const products = await db.product.findMany({ where: { OR: [{ id: { in: mandates.map((m) => m.productId) } }, { proposedByOrgId: ctx.org.orgId }, { distributorOrgId: ctx.org.orgId }] } });
  const carriers = await db.organization.findMany({ where: { type: "CARRIER" } });
  const owner = ctx.org.role === "AGENCY_OWNER";
  return (
    <>
      <PageTitle title="Продукты и полномочия" subtitle="Предлагать можно только продукты, по которым есть действующее полномочие страховщика. Срок проверяется при каждом предложении и при выборе клиентом." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Полномочия"><div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Продукт</th><th>Страховщик</th><th>Срок</th><th>Статус</th></tr></thead><tbody>
          {mandates.map((m) => <tr key={m.id}><td data-label="Продукт">{products.find((p) => p.id === m.productId)?.title}</td><td data-label="Страховщик">{carriers.find((c) => c.id === m.carrierOrgId)?.name}</td><td data-label="Срок">{fmtDate(m.validFrom)} – {fmtDate(m.validTo)}</td><td data-label="Статус"><Status group="mandate" value={m.status} />{m.revokeReason ? <span className="text-xs text-muted"> {m.revokeReason}</span> : null}</td></tr>)}
        </tbody></table></div></Card>
        <Card title="Предложенные агентством продукты">
          <ul className="mb-4 space-y-2 text-sm">{products.filter((p) => p.proposedByOrgId === ctx.org.orgId).map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2"><span>{p.title} · <Status group="product" value={p.status} /></span>{p.status === "DRAFT" && owner && <Action url="/api/agency/submit-product" body={{ productId: p.id }} label="Направить страховщику" />}</li>)}</ul>
          {owner && <ApiForm url="/api/agency/propose" submit="Создать черновик продукта" successText="Черновик создан. Публикация возможна только после согласования страховщиком и проверки платформой." resetOnSuccess fields={[
            { name: "title", label: "Название", required: true }, { name: "summary", label: "Описание и выгода для клиента", type: "textarea", required: true }, { name: "audience", label: "Для кого", required: true },
            { name: "carrierOrgId", label: "Страховщик", type: "select", options: carriers.map((c) => ({ value: c.id, label: c.name })), required: true },
            { name: "baseProductCode", label: "На основе", type: "select", options: [{ value: "RAIN01", label: "Событийный: осадки" }, { value: "WIND01", label: "Событийный: ветер" }, { value: "PROPERTY", label: "Имущество" }, { value: "KASKO", label: "Каско" }], required: true },
          ]} />}
        </Card>
      </div>
    </>
  );
}
