import { db, type Tx } from "../db";
import { err } from "../errors";
import { FORM_SCHEMAS, type FormSchemaDef } from "./forms";
import type { EventTerms } from "./eventcalc";
import { emu } from "../adapters/emu";
import { appMode } from "../config";

export function schemaFor(code: string, version = 1): FormSchemaDef {
  const s = FORM_SCHEMAS.find((x) => x.productCode === code && x.version === version);
  if (!s) throw err("NOT_FOUND", "Анкета для продукта не найдена");
  return s;
}

export async function publishedVersion(tx: Tx | typeof db, productId: string) {
  return tx.productVersion.findFirst({ where: { productId, status: "PUBLISHED" }, orderBy: { version: "desc" } });
}

/** Все продукты с данным кодом (у разных страховщиков код уникален по продукту; KASKO у двух страховщиков — разные продукты KASKO_A/KASKO_B → группа productCode в terms). */
export async function productsForCode(tx: Tx | typeof db, productCode: string) {
  const all = await tx.product.findMany({ where: { status: "PUBLISHED" }, include: { versions: { where: { status: "PUBLISHED" }, orderBy: { version: "desc" }, take: 1 } } });
  return all.filter((p) => (p.versions[0]?.terms as any)?.productCode === productCode);
}

export async function activeTariff(tx: Tx | typeof db, productId: string, carrierOrgId: string, at: Date) {
  const t = await tx.tariffVersion.findFirst({ where: { productId, carrierOrgId, status: "ACTIVE" }, orderBy: { version: "desc" } });
  if (!t) return { tariff: null, stale: true, reason: "Нет утверждённой тарифной версии" };
  const s = await emu();
  if (s.tariffs.stale) return { tariff: t, stale: true, reason: "Источник тарифов устарел (эмуляция)" };
  if (t.validFrom > at || t.validTo < at) return { tariff: t, stale: true, reason: "Срок действия тарифной версии истёк" };
  return { tariff: t, stale: false, reason: null };
}

/** Аварийная приостановка продаж: по страховщику, продукту, территории, поставщику данных. Сопровождение не затрагивается. */
export async function assertSalesAllowed(tx: Tx | typeof db, i: { carrierOrgId?: string; productCode?: string; territory?: string | null; dataSource?: string | null }) {
  const active = await tx.salesSuspension.findMany({ where: { active: true } });
  const hit = active.find((s) =>
    (s.scope === "CARRIER" && s.target === i.carrierOrgId) || (s.scope === "PRODUCT" && s.target === i.productCode) ||
    (s.scope === "TERRITORY" && i.territory && s.target === i.territory) || (s.scope === "DATA_SOURCE" && i.dataSource && s.target === i.dataSource));
  if (hit) throw err("SALES_SUSPENDED", `Новые продажи приостановлены: ${hit.reason}`, { scope: hit.scope, target: hit.target });
  if (appMode() === "production") {
    const launch = await tx.launchApproval.findFirst({ where: { carrierOrgId: i.carrierOrgId, productCode: i.productCode } });
    if (!launch) throw err("INTEGRATION_NOT_CONFIGURED", "Для этого сочетания страховщик/продукт нет подтверждённого запуска реальных продаж");
  }
}

export function eventTerms(v: { terms: any }): EventTerms {
  return v.terms.event as EventTerms;
}
