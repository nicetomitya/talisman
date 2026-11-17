import Link from "next/link";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { coverageState } from "@/server/domain/policies";
import { Card, Empty, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, ApiForm } from "@/components/client";
import { externalPolicies } from "@/server/domain/cabinet";
import { CATEGORIES } from "@/server/domain/crm";
import { label } from "@/server/domain/labels";

export default async function Policies() {
  const ctx = await requireClientPage();
  const t = await now();
  const list = await db.policy.findMany({ where: { clientId: ctx.user.id }, orderBy: { createdAt: "desc" } });
  const ext = await externalPolicies(ctx);
  const orgs = await db.organization.findMany({ where: { id: { in: ext.map((p) => p.sourceOrgId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return (<><PageTitle title="Полисы" subtitle="Все полисы демонстрационные и не являются действующими договорами страхования." />
    {list.length === 0 ? <Empty title="Полисов нет" /> : <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Номер</th><th>Объект</th><th>Договор</th><th>Защита</th><th>Период</th><th>Премия</th></tr></thead><tbody>
      {list.map((p) => <tr key={p.id}><td data-label="Номер"><Link href={`/c/policies/${p.id}`}>{p.number}</Link></td><td data-label="Объект">{p.objectTitle}</td><td data-label="Договор"><Status group="contract" value={p.contractStatus} /></td><td data-label="Защита"><Status group="coverage" value={coverageState(p, t)} /></td><td data-label="Период">{fmtDate(p.startsAt)} – {fmtDate(p.endsAt)}</td><td data-label="Премия"><Money kop={p.premiumKop} /></td></tr>)}
    </tbody></table></div>}
    <section className="mt-6">
      <h2 className="mb-1 text-lg font-semibold">Оформлены вне платформы</h2>
      <p className="mb-3 text-sm text-muted">Полисы других компаний и агентов — чтобы всё было в одном месте и напоминания приходили вовремя. Платформа не проверяла их условия: источник и статус проверки указаны отдельно.</p>
      {ext.length === 0 ? <Empty title="Пока нет" text="Добавьте полис вручную или примите приглашение агента." /> :
        <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Полис</th><th>Объект</th><th>Окончание</th><th>Источник</th><th>Действия</th></tr></thead><tbody>
          {ext.map((p) => <tr key={p.id}><td data-label="Полис">{CATEGORIES[p.category]}, {p.insurerName}{p.number ? ` № ${p.number}` : ""}</td><td data-label="Объект">{p.objectTitle}</td><td data-label="Окончание">{fmtDate(p.endsAt)}{p.endsAt && p.endsAt < t ? " (истёк)" : ""}</td>
            <td data-label="Источник">{label("extVerification", p.verification)}{p.sourceOrgId ? ` · ${orgs.find((o) => o.id === p.sourceOrgId)?.name ?? "агентство"}` : ""}</td>
            <td data-label="Действия"><div className="flex flex-wrap gap-1">{["KASKO", "PROPERTY"].includes(p.category) && <Action url="/api/cabinet/market-check" body={{ id: p.id }} label="Сравнить с рынком" redirect="/c/requests/{requestId}" />}<Action url="/api/cabinet/external-archive" body={{ id: p.id }} label="Убрать" confirm="Убрать полис из списка?" /></div></td></tr>)}
        </tbody></table></div>}
      <Card title="Добавить полис" className="mt-4">
        <ApiForm url="/api/cabinet/external-add" submit="Добавить" resetOnSuccess successText="Полис добавлен" fields={[
          { name: "category", label: "Вид", type: "select", options: Object.entries(CATEGORIES).map(([value, label]) => ({ value, label })) },
          { name: "insurerName", label: "Страховая компания", required: true },
          { name: "number", label: "Номер полиса" },
          { name: "objectTitle", label: "Что застраховано", required: true, hint: "Например: Kia K5, квартира на Лесной" },
          { name: "startsAt", label: "Начало", type: "date" },
          { name: "endsAt", label: "Окончание", type: "date", required: true, hint: "Напомним за 30 дней" },
          { name: "premiumRub", label: "Премия, ₽", type: "number", min: 0 },
        ]} />
      </Card>
    </section></>);
}
