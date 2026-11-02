import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { planAllows } from "@/server/domain/subscriptions";
import { Card, PageTitle, Status, fmtDate } from "@/components/ui";
import { RuleForm } from "@/components/agency";

export default async function Automation() {
  const ctx = await requireAgencyPage();
  const rule = await db.automationRule.findUnique({ where: { organizationId: ctx.org.orgId } }) ?? { mode: "MANUAL", productCodes: [], territories: [], maxSumInsuredRub: 5000000, maxVehicleAge: 15, tariffMaxAgeDays: 30, maxContractsPerDay: 20, dailyResponseLimit: 50, minCommissionBp: 1000, improveMode: "NONE", manualReasons: [] };
  const runs = await db.automationRun.findMany({ where: { organizationId: ctx.org.orgId }, orderBy: { createdAt: "desc" }, take: 30 });
  const canAuto = await planAllows(db, ctx.org.orgId, "autoReply");
  return (
    <>
      <PageTitle title="Автоматизация ответов" subtitle="Правила действуют только в пределах полномочий и утверждённых тарифов. Каждое автоматическое решение журналируется с причиной." />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card title="Правила">{ctx.org.role === "AGENCY_OWNER" ? <RuleForm rule={rule} canAuto={canAuto} /> : <p className="text-sm text-muted">Правила настраивает владелец агентства. Текущий режим: {rule.mode}.</p>}</Card>
        <Card title="Журнал решений">{runs.length === 0 ? <p className="text-sm text-muted">Пока пусто.</p> : <ul className="space-y-2 text-sm">{runs.map((r: any) => <li key={r.id} className="border-b border-line pb-1"><Status value={r.result} text={({ SENT: "Отправлено", DRAFT: "Черновик", TASK: "Задача агенту", SKIPPED: "Пропущено", BLOCKED: "Заблокировано" } as any)[r.result] ?? r.result} /> {r.mode} · {fmtDate(r.createdAt, true)}<ul className="mt-1 text-xs text-muted">{(Array.isArray(r.steps) ? r.steps : []).map((s: any, i: number) => <li key={i}>{s.ok === false ? "✕" : "✓"} {s.check ?? s.step ?? ""}{s.reason ? `: ${s.reason}` : s.note ? `: ${s.note}` : ""}</li>)}</ul></li>)}</ul>}</Card>
      </div>
    </>
  );
}
