import { requireClientPage } from "@/server/page";
import { myAgentLinks, CATEGORIES } from "@/server/domain/crm";
import { Card, Empty, PageTitle, Status, fmtDate } from "@/components/ui";
import { Action } from "@/components/client";

export const metadata = { title: "Мои агенты" };

export default async function Agents() {
  const ctx = await requireClientPage();
  const links = await myAgentLinks(ctx);
  return (
    <>
      <PageTitle title="Мои агенты" subtitle="Агентства, которые пригласили вас в кабинет. Каждое обслуживает свои договоры, но не получает права на ваши будущие заявки: любую новую потребность вы можете отдать на сравнение всему рынку." />
      {links.length === 0 ? <Empty title="Связей с агентствами нет" text="Если агент пришлёт персональную ссылку, приглашение появится здесь после входа." /> :
        <div className="space-y-4">{links.map((l) => (
          <Card key={l.id} title={<>{l.orgName} <Status group="crmLink" value={l.state} /></>}>
            {l.state === "REGISTERED" && <>
              <p className="text-sm">Агентство «{l.orgName}» ведёт вашу карточку. Подтвердите, что это вы, и решите, переносить ли в кабинет известные агентству полисы. Агентство увидит только факт связи; ваши заявки и полисы других агентств ему не видны.</p>
              {!l.channelsMatch && <p role="alert" className="mt-2 rounded-md border border-warn/30 bg-warn-soft p-2 text-sm text-warn">! Телефон или email в карточке агентства не совпадает с подтверждёнными данными вашего аккаунта. Связать можно после того, как агент исправит карточку. Автоматически ничего не объединяется.</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {l.channelsMatch && <><Action url="/api/cabinet/link-confirm" body={{ contactId: l.id, sharePolicies: true }} variant="primary" label={`Подтвердить и перенести полисы (${l.policies.length})`} /><Action url="/api/cabinet/link-confirm" body={{ contactId: l.id, sharePolicies: false }} label="Подтвердить без полисов" /></>}
                <Action url="/api/cabinet/link-revoke" body={{ contactId: l.id }} variant="danger" label="Это не я / отклонить" confirm="Отклонить приглашение? Карточка останется у агентства, связь с вашим кабинетом не появится." />
              </div>
            </>}
            {l.state === "VERIFIED_LINKED" && <>
              <p className="text-sm">Связь подтверждена {fmtDate(l.linkedAt)}. Отозвать доступ можно в любой момент: договоры, которые агентство обслуживает, сохранятся.</p>
              <div className="mt-2"><Action url="/api/cabinet/link-revoke" body={{ contactId: l.id }} variant="danger" label="Отозвать доступ" confirm="Отозвать связь с агентством? Полисы, которые вы перенесли, останутся у вас." /></div>
            </>}
            {l.policies.length > 0 && <><h3 className="mt-3 text-sm font-semibold">Полисы, известные агентству</h3><ul className="mt-1 text-sm">{l.policies.map((p) => <li key={p.id}>{CATEGORIES[p.category]}, {p.insurerName}{p.number ? ` № ${p.number}` : ""} · {p.objectTitle}{p.endsAt ? ` · до ${fmtDate(p.endsAt)}` : ""}{p.sharedAt ? " · в вашем кабинете" : ""}</li>)}</ul></>}
          </Card>))}</div>}
    </>
  );
}
