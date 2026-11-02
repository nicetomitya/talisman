import Link from "next/link";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { PageTitle, Status, fmtDate } from "@/components/ui";
import { isCarrier } from "@/components/adminctx";

export default async function AdminClaims() {
  const ctx = await requireAdminPage();
  const t = await now();
  const list = await db.claim.findMany({ where: isCarrier(ctx) ? { carrierOrgId: ctx.org.orgId } : {}, orderBy: { createdAt: "desc" } });
  return (<><PageTitle title="Обращения" /><div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Номер</th><th>Тип</th><th>Статус</th><th>SLA</th></tr></thead><tbody>
    {list.map((c) => <tr key={c.id}><td data-label="Номер"><Link href={`/admin/claims/${c.id}`}>{c.number}</Link></td><td data-label="Тип">{c.type === "PARAMETRIC" ? "Параметрическое" : "Классическое"}</td><td data-label="Статус"><Status group="claim" value={c.status} /></td><td data-label="SLA">{fmtDate(c.slaDueAt, true)}{c.slaDueAt && c.slaDueAt < t && !["PAID", "CLOSED", "REJECTED"].includes(c.status) ? <span className="text-bad"> ✕ просрочено</span> : null}</td></tr>)}
  </tbody></table></div></>);
}
