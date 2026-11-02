import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { INTEGRATION_MATRIX } from "@/server/adapters";
import { emu as getEmu } from "@/server/adapters/emu";
import { appMode } from "@/server/config";
import { db } from "@/server/db";
import { Card, PageTitle, Status, fmtDate } from "@/components/ui";
import { isCarrier } from "@/components/adminctx";

export default async function Integrations() {
  const ctx = await requireAdminPage();
  if (isCarrier(ctx)) redirect("/admin");
  const emu = await getEmu();
  const jobs = await db.job.groupBy({ by: ["status"], _count: true });
  const dead = await db.job.findMany({ where: { status: "DEAD" }, orderBy: { updatedAt: "desc" }, take: 10 });
  return (<><PageTitle title="Интеграции" subtitle={`Режим приложения: ${appMode()}. В боевом режиме эмуляторы отключены, а неподключённая интеграция возвращает ошибку «интеграция не настроена».`} />
    <div className="space-y-4">
      <Card title="Матрица адаптеров"><div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Адаптер</th><th>P0 (сейчас)</th><th>Что нужно для P1</th></tr></thead><tbody>{INTEGRATION_MATRIX.map((m) => <tr key={m.adapter}><td data-label="Адаптер">{m.adapter}</td><td data-label="P0">{m.p0}</td><td data-label="P1">{m.p1}</td></tr>)}</tbody></table></div></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Текущие режимы эмуляторов"><pre className="overflow-x-auto rounded bg-bg p-2 text-xs">{JSON.stringify(emu, null, 2)}</pre><p className="mt-1 text-xs text-muted">Меняются на демопанели.</p></Card>
        <Card title="Фоновые задания"><ul className="text-sm">{jobs.map((j) => <li key={j.status}><Status value={j.status} /> <span className="num">{j._count}</span></li>)}</ul>{dead.length > 0 && <ul className="mt-2 space-y-1 text-xs">{dead.map((d) => <li key={d.id}>✕ {d.type} · {fmtDate(d.updatedAt, true)} · {String(d.lastError ?? "").slice(0, 100)}</li>)}</ul>}</Card>
      </div>
    </div></>);
}
