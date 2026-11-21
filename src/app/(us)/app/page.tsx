import Link from "next/link";
import { db } from "@/server/db";
import { pageOwner } from "@/server/ev/page";
import * as EV from "@/server/ev/service";
import { CATEGORY_LABEL } from "@/server/ev/templates";
import { requireUsClient, Workspace } from "@/components/ev/workspace";
import { Pill, windowText } from "@/components/ev/ui";
import { fmtUsd } from "@/lib/usd";

export const metadata = { title: "My risks" };
export default async function MyRisks() {
  const ctx = await requireUsClient("/app");
  await pageOwner(ctx);
  const risks = await EV.listIntents({ userId: ctx.user.id });
  const orders = await db.simOrder.findMany({ where: { userId: ctx.user.id, riskIntentId: { in: risks.map((r) => r.id) } } });
  return (
    <Workspace ctx={ctx} active="/app">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-semibold">My risks</h1><Link href="/risk/new" className="btn btn-primary no-underline">Describe a new risk</Link></div>
      {risks.length === 0 ? <p className="card mt-4 text-sm">No risks yet. Describe what could go wrong and we will turn it into exact event terms.</p> :
        <ul className="mt-4 grid gap-3 md:grid-cols-2">{risks.map((r) => {
          const linked = orders.filter((o) => o.riskIntentId === r.id);
          const paid = linked.reduce((s, o) => s + o.costCents + o.feeCents, 0);
          return <li key={r.id} className="card space-y-1">
            <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-semibold"><Link href={`/risk/${r.id}`}>{CATEGORY_LABEL[r.category] ?? r.category}{r.place ? ` · ${r.place.name}` : ""}</Link></h2><Pill value={r.status} /></div>
            <p className="line-clamp-2 text-sm text-muted">{r.rawDescription}</p>
            <p className="text-sm">Goal: {r.desiredPayoutCents !== null ? `${fmtUsd(r.desiredPayoutCents)} if it happens` : "not set"} · {windowText(r.window.startLocal, r.window.endLocal)}</p>
            <p className="text-sm">{linked.length ? <>Linked paper positions: {linked.length}, virtual paid {fmtUsd(paid)} · <Link href="/app/portfolio">track</Link></> : "No linked contract yet."}</p>
          </li>;
        })}</ul>}
    </Workspace>
  );
}
