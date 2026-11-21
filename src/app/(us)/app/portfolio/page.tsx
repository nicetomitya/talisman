import Link from "next/link";
import * as EV from "@/server/ev/service";
import { requireUsClient, Workspace } from "@/components/ev/workspace";
import { Pill, fmtStamp } from "@/components/ev/ui";
import { DisputeForm } from "@/components/ev/client";
import { fmtUsd } from "@/lib/usd";

export const metadata = { title: "Portfolio (simulation)" };
export default async function Portfolio() {
  const ctx = await requireUsClient("/app/portfolio");
  const lots = await EV.positions(ctx);
  const open = lots.filter((l) => l.state === "OPEN");
  const exposure = open.reduce((s, l) => s + l.maxLossCents, 0);
  return (
    <Workspace ctx={ctx} active="/app/portfolio">
      <h1 className="text-2xl font-semibold">Portfolio <span className="ml-1 rounded bg-[#ece8f7] px-2 py-0.5 align-middle text-xs font-semibold text-[#3b2a6b]">SIMULATED · virtual USD</span></h1>
      <p className="mt-1 text-sm text-muted">Every amount on this page is virtual. Nothing here is real money, a real order or an insurance policy.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="card"><p className="text-xs text-muted">Open lots</p><p className="text-2xl font-semibold">{open.length}</p></div>
        <div className="card"><p className="text-xs text-muted">Maximum loss on open lots (virtual)</p><p className="text-2xl font-semibold text-bad"><span className="num">{fmtUsd(exposure)}</span></p></div>
        <div className="card"><p className="text-xs text-muted">Settled lots</p><p className="text-2xl font-semibold">{lots.length - open.length}</p></div>
      </div>
      {lots.length === 0 ? <p className="card mt-4 text-sm">No paper positions yet. <Link href="/markets">Browse contracts</Link></p> :
        <ul className="mt-4 space-y-3">{lots.map((l) => <li key={l.id} className="card space-y-1 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-semibold"><Link href={`/markets/${l.marketId}`}>{l.market.title}</Link></h2><span>{l.side} · {l.units.toLocaleString("en-US")} units</span></div>
          <p>Virtual cost {fmtUsd(l.costCents)} + fees {fmtUsd(l.feeCents)} · max loss {fmtUsd(l.maxLossCents)} · pays {fmtUsd(l.grossIfPaysCents)} if {l.side === "YES" ? "it happens" : "it doesn't happen"}</p>
          <p>Contract: <Pill value={l.market.status} />{l.resolution && <> · resolution <Pill value={l.resolution.status} />{l.resolution.outcome ? ` (${l.resolution.outcome})` : ""}</>}</p>
          {l.settlement && <p className="font-medium">Simulated settlement {fmtStamp(l.settlement.finalAt, l.market.terms.timezone)}: gross {fmtUsd(l.settlement.grossPayoutCents)}, net <span className={l.settlement.netCents < 0 ? "text-bad" : "text-ok"}>{fmtUsd(l.settlement.netCents, { sign: true })}</span> · ref {l.settlement.partnerRef.slice(0, 18)}…</p>}
          {l.resolution?.status === "PROPOSED" && <><p className="text-muted">Disputes until {fmtStamp(l.resolution.disputeDeadline!, l.market.terms.timezone)}. Nothing is paid before the outcome is confirmed.</p><DisputeForm marketId={l.marketId} /></>}
          {l.resolution?.status === "NEEDS_DATA" && <p className="text-warn">Data is missing for this event. Nothing is paid until a data review confirms the outcome.</p>}
          {l.resolution?.status === "DISPUTED" && <p className="text-warn">Under dispute review. Nothing is paid until a decision.</p>}
        </li>)}</ul>}
    </Workspace>
  );
}
