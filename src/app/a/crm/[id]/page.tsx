import Link from "next/link";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { asAgency } from "@/server/access";
import { contactCard, CATEGORIES, LEGAL_BASES } from "@/server/domain/crm";
import { Card, KV, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action, ApiForm } from "@/components/client";
import { CrmDraft, CrmInvite } from "@/components/crm";
import { CHANNELS } from "@/lib/crmconst";
import { notFound } from "next/navigation";

const KIND: Record<string, string> = { NOTE: "Заметка", CALL: "Звонок", MESSAGE_DRAFT: "Подготовлен текст", MESSAGE_SENT_MANUAL: "Отправлено вручную", SYSTEM: "Система" };

export default async function CrmCard({ params }: { params: Promise<{ id: string }> }) {
  const ctx = asAgency(await requireAgencyPage());
  const { id } = await params;
  const card = await contactCard(ctx, id).catch(() => null);
  if (!card) notFound();
  const { contact: c, policies, interactions, tasks, platformPolicies } = card;
  const owner = ctx.role === "AGENCY_OWNER";
  const members = owner ? await db.membership.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, include: { user: { select: { id: true, name: true } } } }) : [];
  const resp = c.responsibleUserId ? await db.user.findUnique({ where: { id: c.responsibleUserId }, select: { name: true } }) : null;
  return (
    <>
      <PageTitle title={c.name} subtitle={<><Link href="/a/crm">← Все контакты</Link> · <Status group="crmLink" value={c.linkState} /></>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Карточка">
          <KV items={[["Телефон", c.phone ?? "—"], ["Email", c.email ?? "—"], ["Ответственный", resp?.name ?? "не назначен"], ["Основание обработки", LEGAL_BASES[c.legalBasis as keyof typeof LEGAL_BASES] ?? c.legalBasis], ["Источник", c.provenance === "IMPORT" ? "Импорт" : c.provenance === "MANUAL" ? "Вручную" : "Платформа"], ["Создана", fmtDate(c.createdAt)]]} />
          <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Изменить</summary>
            <ApiForm url="/api/crm/contact-update" submit="Сохранить" extra={{ contactId: c.id, version: c.version }} transformEmpty fields={[
              { name: "phone", label: "Телефон", defaultValue: c.phone ?? "" },
              { name: "email", label: "Email", type: "email", defaultValue: c.email ?? "" },
              { name: "notes", label: "Внутренняя заметка (клиент её не увидит)", type: "textarea", defaultValue: c.notes ?? "" },
            ]} />
            {owner && members.length > 1 && <div className="mt-3"><ApiForm url="/api/crm/contact-update" submit="Назначить ответственного" extra={{ contactId: c.id, version: c.version }} fields={[{ name: "responsibleUserId", label: "Ответственный", type: "select", defaultValue: c.responsibleUserId ?? "", options: [{ value: "", label: "Не назначен" }, ...members.map((m) => ({ value: m.user.id, label: m.user.name }))] }]} transformEmpty /></div>}
          </details>
          {c.notes && <p className="mt-3 rounded-md bg-bg p-2 text-sm"><span className="text-xs text-muted">Внутренняя заметка · видна только агентству</span><br />{c.notes}</p>}
        </Card>
        <Card title="Приглашение в кабинет клиента">
          <p className="mb-2 text-sm text-muted">Клиенту не обязательно регистрироваться. Если пригласите, он сам подтвердит данные и решит, какие полисы перенести в кабинет. Ваши заметки и история ему не видны.</p>
          {c.linkState === "VERIFIED_LINKED" ? <p className="text-sm">✓ Клиент подтвердил связь {fmtDate(c.linkedAt)}.</p> : c.linkState === "REGISTERED" ? <p className="text-sm">Клиент зарегистрировался {fmtDate(c.registeredAt)} и ещё не подтвердил связь.</p> : <CrmInvite contactId={c.id} state={c.linkState} />}
          {c.inviteSentAt && <p className="mt-2 text-xs text-muted">Отправлено вручную {fmtDate(c.inviteSentAt, true)}{c.inviteChannel ? ` · ${CHANNELS.find(([v]) => v === c.inviteChannel)?.[1]}` : ""}</p>}
        </Card>
        <Card title="Известные полисы" className="lg:col-span-2">
          {policies.length === 0 ? <p className="text-sm text-muted">Полисов нет.</p> :
            <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Вид</th><th>Страховщик</th><th>Номер</th><th>Объект</th><th>Окончание</th><th>Премия</th><th>У клиента в кабинете</th></tr></thead><tbody>
              {policies.map((p) => <tr key={p.id}><td data-label="Вид">{CATEGORIES[p.category]}</td><td data-label="Страховщик">{p.insurerName}</td><td data-label="Номер">{p.number ?? "—"}</td><td data-label="Объект">{p.objectTitle}</td><td data-label="Окончание">{fmtDate(p.endsAt)}</td><td data-label="Премия">{p.premiumKop !== null ? <Money kop={p.premiumKop} /> : "—"}</td><td data-label="В кабинете">{p.sharedAt ? "да" : "нет"}</td></tr>)}
            </tbody></table></div>}
          <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Добавить полис</summary>
            <ApiForm url="/api/crm/policy-add" submit="Добавить" extra={{ contactId: c.id }} resetOnSuccess fields={[
              { name: "category", label: "Вид", type: "select", options: Object.entries(CATEGORIES).map(([value, label]) => ({ value, label })) },
              { name: "insurerName", label: "Страховщик", required: true },
              { name: "number", label: "Номер полиса" },
              { name: "objectTitle", label: "Объект", required: true },
              { name: "startsAt", label: "Начало", type: "date" },
              { name: "endsAt", label: "Окончание", type: "date", hint: "Задача на продление появится за 30 дней" },
              { name: "premiumRub", label: "Премия, ₽", type: "number", min: 0 },
            ]} />
          </details>
          {platformPolicies.length > 0 && <><h3 className="mt-4 font-semibold">Оформлены вашим агентством на платформе</h3><ul className="mt-1 text-sm">{platformPolicies.map((p) => <li key={p.id}>{p.number} · {p.objectTitle} · до {fmtDate(p.endsAt)}</li>)}</ul></>}
        </Card>
        <Card title="Задачи">
          {tasks.length === 0 ? <p className="text-sm text-muted">Задач нет.</p> : <ul className="space-y-2 text-sm">{tasks.map((t) => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2"><span className={t.status === "DONE" ? "text-muted line-through" : ""}>{t.title}{t.dueAt ? ` · до ${fmtDate(t.dueAt)}` : ""}</span>{t.status === "OPEN" && <Action url="/api/agency/task-done" body={{ taskId: t.id }} label="Готово" />}</li>)}</ul>}
          <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Новая задача</summary>
            <ApiForm url="/api/crm/task" submit="Добавить" extra={{ contactId: c.id }} resetOnSuccess fields={[{ name: "title", label: "Что сделать", required: true }, { name: "dueAt", label: "Срок", type: "date" }]} />
          </details>
        </Card>
        <Card title="Сообщения и история">
          <p className="mb-2 text-sm text-muted">Помощник готовит текст, вы отправляете его сами. Платформа не пишет контакту без вашего действия.</p>
          <CrmDraft contactId={c.id} />
          <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Записать в историю</summary>
            <ApiForm url="/api/crm/interaction" submit="Сохранить" extra={{ contactId: c.id }} resetOnSuccess fields={[
              { name: "kind", label: "Тип", type: "select", options: [{ value: "NOTE", label: "Заметка" }, { value: "CALL", label: "Звонок" }, { value: "MESSAGE_SENT_MANUAL", label: "Отправил сообщение" }] },
              { name: "channel", label: "Канал (для сообщения)", type: "select", options: [{ value: "", label: "—" }, ...CHANNELS.map(([value, label]) => ({ value, label }))] },
              { name: "text", label: "Текст", type: "textarea", required: true },
            ]} />
          </details>
          <ul className="mt-3 space-y-2 text-sm">{interactions.map((i) => <li key={i.id} className="border-l-2 border-line pl-2"><span className="text-xs text-muted">{fmtDate(i.createdAt, true)} · {KIND[i.kind] ?? i.kind}</span><br /><span className="whitespace-pre-line">{i.text}</span></li>)}</ul>
        </Card>
      </div>
    </>
  );
}
