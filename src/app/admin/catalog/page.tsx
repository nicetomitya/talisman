import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { MACHINES } from "@/server/state/machines";
import { label } from "@/server/domain/labels";
import { Card, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, ApiForm } from "@/components/client";
import { isCarrier } from "@/components/adminctx";

export default async function Catalog() {
  const ctx = await requireAdminPage();
  const carrier = isCarrier(ctx);
  const role = carrier ? "CARRIER" : "ADMIN";
  const products = await db.product.findMany({ where: carrier ? { carrierOrgId: ctx.org.orgId } : {}, orderBy: { code: "asc" } });
  const orgs = await db.organization.findMany();
  const mandates = await db.mandate.findMany({ where: carrier ? { carrierOrgId: ctx.org.orgId } : {}, orderBy: { validTo: "asc" } });
  const susp = await db.salesSuspension.findMany({ where: { active: true } });
  const agencies = orgs.filter((o) => o.type === "AGENCY");
  const name = (id: string | null) => orgs.find((o) => o.id === id)?.name ?? "—";
  const machine = (MACHINES as any).product as Record<string, { to: string; by: string[] }[]>;
  return (
    <>
      <PageTitle title={carrier ? "Продукты и полномочия страховщика" : "Каталог продуктов"} subtitle="Продукт агентства публикуется только после согласования страховщиком и проверки платформой." />
      <div className="space-y-4">
        <Card title="Продукты"><div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Продукт</th><th>Страховщик</th><th>Статус</th><th>Действия</th></tr></thead><tbody>
          {products.map((p) => <tr key={p.id}><td data-label="Продукт"><strong>{p.title}</strong><div className="text-xs text-muted">{p.code}{p.proposedByOrgId ? ` · предложен «${name(p.proposedByOrgId)}»` : ""}</div></td><td data-label="Страховщик">{name(p.carrierOrgId)}</td><td data-label="Статус"><Status group="product" value={p.status} /></td>
            <td data-label="Действия"><div className="flex flex-wrap gap-1">{(machine[p.status] ?? []).filter((x) => x.by.includes(role)).map((x) => <Action key={x.to} url="/api/admin/product-transition" body={{ productId: p.id, to: x.to, note: "Решение из кабинета" }} label={`→ ${label("product", x.to)}`} variant={x.to === "SUSPENDED" || x.to === "ARCHIVED" || x.to === "DRAFT" ? "danger" : "secondary"} confirm={x.to === "SUSPENDED" ? "Приостановить продажи? Новые предложения и оформление будут недоступны, действующие договоры сохранятся." : undefined} />)}</div></td></tr>)}
        </tbody></table></div></Card>
        <Card title="Полномочия агентств"><div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Агентство</th><th>Продукт</th><th>Срок</th><th>Статус</th><th></th></tr></thead><tbody>
          {mandates.map((m) => <tr key={m.id}><td data-label="Агентство">{name(m.agencyOrgId)}</td><td data-label="Продукт">{products.find((p) => p.id === m.productId)?.title ?? m.productId.slice(0, 8)}</td><td data-label="Срок">{fmtDate(m.validFrom)} – {fmtDate(m.validTo)}</td><td data-label="Статус"><Status group="mandate" value={m.status} /></td><td>{m.status === "ACTIVE" && <Action url="/api/admin/revoke-mandate" body={{ mandateId: m.id, reason: "Отозвано страховщиком" }} label="Отозвать" variant="danger" confirm="Отозвать полномочие? Агентство не сможет предлагать и оформлять этот продукт." />}</td></tr>)}
        </tbody></table></div>
          <div className="mt-3 border-t border-line pt-3"><ApiForm url="/api/admin/create-mandate" submit="Выдать полномочие" fields={[{ name: "agencyOrgId", label: "Агентство", type: "select", options: agencies.map((a) => ({ value: a.id, label: a.name })) }, { name: "productId", label: "Продукт", type: "select", options: products.filter((p) => p.status === "PUBLISHED").map((p) => ({ value: p.id, label: p.title })) }, { name: "validDays", label: "Срок, дней", type: "number", defaultValue: 365 }]} /></div></Card>
        <Card title="Приостановки продаж">
          <ul className="mb-3 space-y-1 text-sm">{susp.length === 0 ? <li className="text-muted">Нет активных</li> : susp.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2">{s.scope}: {s.target} · {s.reason} · с {fmtDate(s.createdAt, true)} {!carrier && <Action url="/api/admin/lift-suspension" body={{ id: s.id }} label="Снять" />}</li>)}</ul>
          <ApiForm url="/api/admin/suspend" submit="Приостановить продажи" fields={[{ name: "scope", label: "Область", type: "select", options: [{ value: "PRODUCT", label: "Продукт (код линии: KASKO, PROPERTY, RAIN01, WIND01)" }, { value: "CARRIER", label: "Страховщик (id)" }, { value: "TERRITORY", label: "Территория (RU-SPE и т.п.)" }, { value: "DATA_SOURCE", label: "Источник данных" }] }, { name: "target", label: "Цель", required: true }, { name: "reason", label: "Причина", required: true }]} />
        </Card>
      </div>
    </>
  );
}
