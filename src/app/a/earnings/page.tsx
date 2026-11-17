import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { label } from "@/server/domain/labels";
import { Card, Money, PageTitle, Status, fmtDate } from "@/components/ui";
import { ApiForm } from "@/components/client";

export default async function Earnings() {
  const ctx = await requireAgencyPage();
  const list = await db.commission.findMany({ where: { recipientOrgId: ctx.org.orgId, recipientType: "AGENCY" }, orderBy: { createdAt: "desc" } });
  const pol = await db.policy.findMany({ where: { id: { in: list.map((c) => c.policyId) } }, select: { id: true, number: true } });
  const sum = (s: string[]) => list.filter((c) => s.includes(c.status)).reduce((a, c) => a + c.amountKop, 0);
  const net = list.reduce((a, c) => a + c.amountKop, 0);
  const owner = ctx.org.role === "AGENCY_OWNER";
  // Доля платформы по сделкам агентства — видна, чтобы агентство могло проверить происхождение сделки и оспорить.
  const platform = await db.commission.findMany({ where: { recipientType: "PLATFORM", kind: "DISTRIBUTION", policyId: { in: (await db.policy.findMany({ where: { agencyOrgId: ctx.org.orgId }, select: { id: true } })).map((p) => p.id) } }, orderBy: { createdAt: "desc" } });
  const ppol = await db.policy.findMany({ where: { id: { in: platform.map((c) => c.policyId) } }, select: { id: true, number: true } });
  return (<><PageTitle title="Вознаграждение" subtitle="Вознаграждение агентства по условиям распределения страховщика. Сторно при прекращении договора — отдельными записями." />
    <div className="mb-4 grid gap-3 sm:grid-cols-3"><Card><p className="text-xs text-muted">Начислено</p><p className="text-lg font-semibold"><Money kop={sum(["ACCRUED"])} /></p></Card><Card><p className="text-xs text-muted">Подтверждено или получено</p><p className="text-lg font-semibold"><Money kop={sum(["CONFIRMED", "RECEIVED"])} /></p></Card><Card><p className="text-xs text-muted">Итого с учётом сторно</p><p className="text-lg font-semibold"><Money kop={net} /></p></Card></div>
    <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Полис</th><th>Вид</th><th>База</th><th>Ставка</th><th>Сумма</th><th>Статус</th><th>Дата</th></tr></thead><tbody>
      {list.map((c) => <tr key={c.id}><td data-label="Полис">{pol.find((p) => p.id === c.policyId)?.number}</td><td data-label="Вид">{c.kind === "DISTRIBUTION" ? "Начисление" : "Сторно"}{c.dealOrigin ? <span className="block text-xs text-muted">{label("dealOrigin", c.dealOrigin)}</span> : null}</td><td data-label="База"><Money kop={c.baseKop} /></td><td data-label="Ставка">{(c.rateBp / 100).toFixed(1)} %</td><td data-label="Сумма"><Money kop={c.amountKop} /></td><td data-label="Статус"><Status group="commission" value={c.status} /></td><td data-label="Дата">{fmtDate(c.createdAt)}</td></tr>)}
    </tbody></table></div>
    <h2 className="mb-1 mt-6 text-lg font-semibold">Доля платформы по вашим сделкам</h2>
    <p className="mb-2 text-sm text-muted">Доля зависит от происхождения сделки: подбор на платформе — обычная; ваш приглашённый клиент снова выбрал вас — пониженная (демо-правило, не утверждено). Обслуживание своей базы в CRM начислений не создаёт.</p>
    <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Полис</th><th>Происхождение</th><th>Ставка</th><th>Сумма</th><th>Статус</th>{owner && <th>Спор</th>}</tr></thead><tbody>
      {platform.map((c) => <tr key={c.id}><td data-label="Полис">{ppol.find((p) => p.id === c.policyId)?.number}</td><td data-label="Происхождение">{label("dealOrigin", c.dealOrigin)}</td><td data-label="Ставка">{(c.rateBp / 100).toFixed(1)} % вознаграждения</td><td data-label="Сумма"><Money kop={c.amountKop} /></td><td data-label="Статус"><Status group="commission" value={c.status} />{c.disputeReason ? <span className="block text-xs text-muted">{c.disputeReason}</span> : null}</td>
        {owner && <td data-label="Спор">{["ACCRUED", "CONFIRMED"].includes(c.status) ? <details><summary className="cursor-pointer text-sm">Оспорить</summary><ApiForm url="/api/agency/commission-dispute" submit="Отправить" extra={{ commissionId: c.id }} fields={[{ name: "reason", label: "Причина", type: "textarea", required: true, hint: "Например: клиент из нашей базы, сделка не с маркетплейса" }]} /></details> : "—"}</td>}</tr>)}
    </tbody></table></div></>);
}
