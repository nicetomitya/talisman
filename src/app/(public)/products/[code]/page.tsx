import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { Card, KV, PageTitle, DemoNote } from "@/components/ui";
import { rub } from "@/server/money";
import { rulesClauses } from "@/server/domain/templates";

export default async function ProductPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const p = await db.product.findUnique({ where: { code } });
  if (!p || p.status !== "PUBLISHED") notFound();
  const v = await db.productVersion.findFirst({ where: { productId: p.id, status: "PUBLISHED" }, orderBy: { version: "desc" } });
  const carrier = await db.organization.findUnique({ where: { id: p.carrierOrgId } });
  const t: any = v?.terms ?? {};
  const base = p.code.startsWith("KASKO") ? "KASKO" : p.code.startsWith("PROPERTY") ? "PROPERTY" : p.code;
  const clauses = rulesClauses(base);
  return (
    <>
      <PageTitle title={p.title} subtitle={`Страховщик: ${carrier?.name}. Версия условий ${v?.version ?? "—"}.`} actions={<Link href={`/c/requests/new?product=${base}`} className="btn btn-primary no-underline">Оформить заявку</Link>} />
      <DemoNote>условия, цены и страховщик вымышлены; оформление не создаёт действующий договор.</DemoNote>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Коротко">
          <p className="text-sm">{p.summary}</p>
          {t.event && <div className="mt-3"><KV items={[["Цена", rub(t.event.premiumKop)], ["Фиксированная выплата", rub(t.event.payoutKop)], ["Порог", `${t.event.aggregation === "SUM_GTE" ? "не менее" : "меньше"} ${(t.event.thresholdX100 / 100).toFixed(1)} ${t.event.unit}${t.event.minIntervals ? ` минимум в ${t.event.minIntervals} часах` : " за часы мероприятия"}`], ["Основной источник", `${t.event.primary.source} (станция ${t.event.primary.stationId})`], ["Резервный источник", t.event.backup ? `${t.event.backup.source} (станция ${t.event.backup.stationId})` : "нет"], ["Измерение", t.event.measurement ?? "Сумма часовых значений осадков по станции"], ["Правило продажи", t.saleRule], ["Пропуски данных", t.missingDataRule], ["Исправления", t.correctionsRule], ["Территория", (t.territories ?? []).join(", ")], ["Нужные документы", (t.docs ?? []).join(", ")]]} /></div>}
        </Card>
        <Card title="Что не покрывается и как урегулируется">
          <ul className="list-disc space-y-1 pl-5 text-sm">{clauses.map((c) => <li key={c.id}><strong>{c.title}.</strong> {c.text}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
