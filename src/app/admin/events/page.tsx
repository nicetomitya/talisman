import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { Card, PageTitle } from "@/components/ui";
import { InlineInput } from "@/components/client";
import { EventCheckView } from "@/components/eventcheck";
import { isCarrier } from "@/components/adminctx";

export default async function Events() {
  const ctx = await requireAdminPage();
  const carrier = isCarrier(ctx);
  const policies = await db.policy.findMany({ where: { productCode: { in: ["RAIN01", "WIND01"] }, ...(carrier ? { carrierOrgId: ctx.org.orgId } : {}) }, orderBy: { startsAt: "desc" } });
  const checks = await db.eventCheck.findMany({ where: { policyId: { in: policies.map((p) => p.id) } } });
  return (<><PageTitle title="Проверки событий" subtitle="Расчёт выполняется по версии правила продукта. Специалист может пересобрать данные с указанием причины; окончательный отказ — только человеком." />
    <div className="space-y-3">{policies.map((p) => { const ec = checks.find((c) => c.policyId === p.id); return (
      <Card key={p.id} title={`${p.number} · ${p.objectTitle}`}>{ec ? <><EventCheckView ec={ec} unit={p.productCode === "RAIN01" ? "мм" : "м/с"} tz={p.timezone} />
        {["NEEDS_DATA", "SPECIALIST_REVIEW", "CALCULATED", "COMPLETED"].includes(ec.status) && <div className="mt-3 border-t border-line pt-3"><InlineInput url="/api/admin/recollect" name="reason" label="Пересобрать данные и пересчитать (причина)" submit="Пересчитать" extra={{ eventCheckId: ec.id }} /></div>}</> : <p className="text-sm text-muted">Проверка ещё не запланирована (договор не заключён).</p>}</Card>); })}</div></>);
}
