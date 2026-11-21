import { notFound } from "next/navigation";
import { pageCtx } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import * as EV from "@/server/ev/service";
import { UsShell } from "@/components/ev/shell";
import { EventCard, NotInsurance, PartnerDisclosure, Pill, fmtStamp } from "@/components/ev/ui";
import { QuoteCalculator } from "@/components/ev/client";
import { fmtX100 } from "@/lib/usd";

export const metadata = { title: "Contract" };
export default async function MarketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ intent?: string; payout?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const ctx = await pageCtx().catch(() => null);
  const m = await EV.getMarket(id).catch(() => null);
  if (!m) notFound();
  const forecasts = await EV.publicForecasts(id);
  const res = await EV.resolutionFor(id);
  const client = ctx?.user.kind === "CLIENT";
  const decl = client && m.objectKey ? await db.conflictDeclaration.findUnique({ where: { userId_objectKey: { userId: ctx!.user.id, objectKey: m.objectKey } } }) : null;
  const canTrade = m.status === "OPEN" && (m.complianceStatus === "SIM_ALLOWED" || m.complianceStatus === "RESTRICTED") && new Date(m.tradingCloseUtc) > (await now()) && (!decl || decl.restriction === "ALLOWED");
  const payout = Math.max(1, Math.min(100000, Number(sp.payout) || 1000));
  const tz = m.terms.timezone;
  return (
    <UsShell ctx={ctx}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <EventCard m={m}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Index</dt><dd>{m.template.aggregation}</dd>
              <dt className="text-muted">Pays NO if</dt><dd>{m.template.outcomeNo.replace("the threshold", fmtX100(m.terms.thresholdX100, m.terms.unit))}</dd>
              <dt className="text-muted">Data source</dt><dd>{m.terms.source}; fallback: {m.terms.fallbackStationId ?? "none"}</dd>
              <dt className="text-muted">Missing data</dt><dd>{m.template.missingDataPolicy}</dd>
              <dt className="text-muted">Trading closes</dt><dd>{fmtStamp(m.tradingCloseUtc, tz)}</dd>
              <dt className="text-muted">Terms</dt><dd>version {m.termsVersion} · hash {m.termsHash.slice(0, 12)}</dd>
              <dt className="text-muted">Unit</dt><dd>$1.00 payout per unit · {m.currency}</dd>
            </dl>
            <p className="text-xs text-muted">{m.regulatoryNote}</p>
          </EventCard>
          {m.station && <p className="card text-sm"><strong>Basis risk:</strong> {m.station.note}</p>}
          {decl && decl.restriction !== "ALLOWED" && <p role="alert" className="card border-bad/30 bg-bad-soft text-sm text-bad">{decl.restriction === "BLOCKED" ? "You declared a connection to this project. Positions on this contract are not available to you." : "Your conflict declaration is waiting for a compliance review."}</p>}
          {res.resolution && <section className="card text-sm"><h2 className="font-semibold">Resolution</h2><p><Pill value={res.resolution.status} />{res.resolution.outcome ? ` · outcome ${res.resolution.outcome}` : ""}</p>{res.resolution.disputeDeadline && <p className="text-muted">Disputes until {fmtStamp(res.resolution.disputeDeadline, tz)}</p>}</section>}
          <section className="card text-sm"><h2 className="font-semibold">Expert research</h2>
            {forecasts.length === 0 ? <p className="text-muted">No published forecasts.</p> : <ul className="mt-1 space-y-2">{forecasts.map((f) => <li key={f.id} className="rounded border border-line p-2"><p><strong>{f.expert}</strong> · v{f.version}{f.supersedesId ? " (revises an earlier version)" : ""} · {f.probabilityBp / 100}% · {new Date(f.createdAt).toISOString().slice(0, 10)}</p><p className="text-muted">{f.method}</p>{f.note && <p>{f.note}</p>}<p className="text-xs text-muted">{f.disclosures}</p></li>)}</ul>}
            <p className="mt-2 text-xs text-muted">Forecasts are opinions, not advice. They are kept unchanged; revisions appear as new versions.</p>
          </section>
        </div>
        <div className="space-y-4">
          <section className="card" aria-labelledby="calc"><h2 id="calc" className="mb-3 text-lg font-semibold">Cost and possible payout</h2>
            <QuoteCalculator marketId={m.id} defaultPayoutUsd={payout} riskIntentId={sp.intent ?? null} signedIn={!!client} canTrade={canTrade} needsConflict={!!m.objectKey && !decl} objectKey={m.objectKey} tz={tz} />
          </section>
          <NotInsurance />
          <PartnerDisclosure />
        </div>
      </div>
    </UsShell>
  );
}
