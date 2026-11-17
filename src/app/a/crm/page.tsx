import Link from "next/link";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { asAgency } from "@/server/access";
import { listContacts, crmMetrics, CATEGORIES } from "@/server/domain/crm";
import { Card, Empty, PageTitle, Status, fmtDate } from "@/components/ui";
import { ApiForm } from "@/components/client";
import { CrmImport } from "@/components/crm";
import { BASES } from "@/lib/crmconst";
import { L } from "@/server/domain/labels";

export const metadata = { title: "Клиенты (CRM)" };

export default async function Crm({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  const ctx = asAgency(await requireAgencyPage());
  const sp = await searchParams;
  const state = sp.state && Object.keys(L.crmLink).includes(sp.state) ? sp.state : undefined;
  const t = await now();
  const [list, m, members] = await Promise.all([
    listContacts(ctx, { q: sp.q?.slice(0, 100), state }),
    crmMetrics(ctx),
    db.membership.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  const tiles: [string, number][] = [["Контактов", m.total], ["Импортировано", m.imported], ["Приглашено", m.invited], ["Зарегистрировались", m.registered], ["Связаны с кабинетом", m.linked], ["Продаж через платформу", m.newSales], ["Продлений в ближайшие 30 дней", m.renewalsDue30d]];
  return (
    <>
      <PageTitle title="Клиенты (CRM)" subtitle="Ваша база: клиенты с платформы и собственные контакты. Регистрация клиентов не обязательна — карточки, задачи и продления работают и без неё." />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">{tiles.map(([l, v]) => <Card key={l}><p className="text-xs text-muted">{l}</p><p className="text-lg font-semibold num">{v}</p></Card>)}</div>
      <p className="mb-4 text-xs text-muted">Импортированные контакты не считаются пользователями платформы. Приглашение — по желанию клиента и только по вашей ссылке; массовых рассылок платформа не делает.</p>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          <form className="mb-3 flex flex-wrap items-end gap-2" method="get">
            <div><label htmlFor="q" className="mb-1 block text-sm font-medium">Поиск</label><input id="q" name="q" defaultValue={sp.q} className="field" placeholder="Имя, email или телефон" /></div>
            <div><label htmlFor="st" className="mb-1 block text-sm font-medium">Статус</label><select id="st" name="state" defaultValue={state ?? ""} className="field"><option value="">Все</option>{Object.entries(L.crmLink).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <button className="btn btn-secondary">Показать</button>
          </form>
          {list.length === 0 ? <Empty title="Контактов нет" text="Добавьте контакт вручную или импортируйте свою базу из CSV." /> :
            <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Контакт</th><th>Связь</th><th>Ближайшее окончание полиса</th><th>Источник</th></tr></thead><tbody>
              {list.map((c) => { const p = c.policies.find((x) => x.endsAt && x.endsAt > t); return (
                <tr key={c.id}><td data-label="Контакт"><Link href={`/a/crm/${c.id}`}>{c.name}</Link><span className="block text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</span></td>
                  <td data-label="Связь"><Status group="crmLink" value={c.linkState} /></td>
                  <td data-label="Окончание">{p ? <>{fmtDate(p.endsAt)} · {CATEGORIES[p.category]}, {p.insurerName}</> : <span className="text-muted">—</span>}</td>
                  <td data-label="Источник">{c.provenance === "IMPORT" ? "Импорт" : c.provenance === "MANUAL" ? "Вручную" : "Платформа"}</td></tr>); })}
            </tbody></table></div>}
        </div>
        <aside className="space-y-4">
          <Card title="Добавить контакт">
            <ApiForm url="/api/crm/contact-create" submit="Создать карточку" redirect="/a/crm/{contactId}" fields={[
              { name: "name", label: "Имя", required: true },
              { name: "phone", label: "Телефон", hint: "Телефон или email обязателен для приглашения" },
              { name: "email", label: "Email", type: "email" },
              { name: "legalBasis", label: "Основание обработки данных", type: "select", required: true, options: BASES.map(([value, label]) => ({ value, label })) },
              { name: "notes", label: "Внутренняя заметка (клиент её не увидит)", type: "textarea" },
            ]} />
          </Card>
          <Card title="Импорт базы"><CrmImport members={members.map((x) => ({ id: x.user.id, name: x.user.name }))} /></Card>
        </aside>
      </div>
    </>
  );
}
