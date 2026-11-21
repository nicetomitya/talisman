import { db } from "@/server/db";
import * as EV from "@/server/ev/service";
import { requireUsClient, Workspace } from "@/components/ev/workspace";
import { fmtUsd } from "@/lib/usd";

export const metadata = { title: "Account and eligibility" };
export default async function Account() {
  const ctx = await requireUsClient("/app/account");
  const e = await EV.eligibility(ctx);
  const decls = await db.conflictDeclaration.findMany({ where: { userId: ctx.user.id } });
  return (
    <Workspace ctx={ctx} active="/app/account">
      <h1 className="text-2xl font-semibold">Account and eligibility</h1>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card text-sm"><h2 className="mb-2 font-semibold">Simulation</h2><p>Allowed · tier {e.simulation.tier} ({e.simulation.tierLabel})</p><p>Limit: up to {fmtUsd(e.simulation.maxPayoutPerEventCents)} of possible payout per event, counted across all related positions.</p><p className="mt-1 text-xs text-muted">Limits are demo product settings, not legal limits.</p></section>
        <section className="card text-sm" aria-labelledby="live"><h2 id="live" className="mb-2 font-semibold">Real-money trading</h2><p className="font-medium text-bad">Not available</p>
          <ul className="mt-1 list-disc pl-5">{e.live.reasons.map((r) => <li key={r}>{({ LIVE_TRADING_DISABLED: "Live trading is switched off in this build.", NO_REGULATED_PARTNER: "No regulated exchange or intermediary is connected.", KYC_NOT_VERIFIED_BY_PARTNER: "Identity checks would be done by the partner, not by Talisman.", STATE_NOT_CLEARED_BY_PARTNER: "Location checks would be done by the partner." } as Record<string, string>)[r] ?? r}</li>)}</ul>
          <p className="mt-1">Declared state: {e.live.declaredState ?? "—"}. {e.live.note}</p></section>
        <section className="card text-sm lg:col-span-2"><h2 className="mb-2 font-semibold">Conflict-of-interest declarations</h2>{decls.length === 0 ? <p className="text-muted">None.</p> : <ul className="list-disc pl-5">{decls.map((d) => <li key={d.id}>{d.objectKey}: {d.relationship.toLowerCase()} → {d.restriction.toLowerCase().replace("_", " ")}{d.assessedAt ? " (reviewed by compliance)" : ""}</li>)}</ul>}</section>
      </div>
    </Workspace>
  );
}
