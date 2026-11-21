import Link from "next/link";
import { notFound } from "next/navigation";
import { pageCtx } from "@/server/page";
import { pageOwner } from "@/server/ev/page";
import * as EV from "@/server/ev/service";
import { CATEGORY_LABEL, TEMPLATES } from "@/server/ev/templates";
import { UsShell } from "@/components/ev/shell";
import { EventCard, MatchBadge, Pill, triggerText, windowText, fmtStamp } from "@/components/ev/ui";
import { ClarifyForm, ConfirmIntent, DemandActions } from "@/components/ev/client";
import { fmtUsd } from "@/lib/usd";

export const metadata = { title: "Your event" };

export default async function RiskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx().catch(() => null);
  const owner = await pageOwner(ctx);
  if (!owner) notFound();
  const intent = await EV.getIntent(owner, id).catch(() => null);
  if (!intent) notFound();
  const matches = intent.templateCode ? await EV.marketMatches(owner, id) : null;
  const tpl = intent.templateCode ? TEMPLATES[intent.templateCode] : null;
  const station = intent.place?.stations.find((s) => s.id === intent.stationId);
  const open = intent.unresolved as { field: string; question: string }[];
  const payoutUsd = intent.desiredPayoutCents ? Math.floor(intent.desiredPayoutCents / 100) : 1000;
  return (
    <UsShell ctx={ctx}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-semibold">Your event</h1><Pill value={intent.status} /></div>
          <blockquote className="rounded-md border-l-4 border-line bg-white p-3 text-sm text-muted">“{intent.rawDescription}”</blockquote>
          <section className="card" aria-labelledby="sum"><h2 id="sum" className="mb-2 font-semibold">Summary of terms</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted">Risk</dt><dd>{CATEGORY_LABEL[intent.category] ?? intent.category}{tpl ? ` · template ${tpl.code} v${tpl.version}` : " · no supported template"}</dd>
              <dt className="text-muted">Place</dt><dd>{intent.place?.name ?? <em>not set</em>}</dd>
              <dt className="text-muted">Station</dt><dd>{station ? station.name : <em>not chosen</em>}</dd>
              <dt className="text-muted">Dates</dt><dd>{windowText(intent.window.startLocal, intent.window.endLocal, intent.window.timezone)}{intent.window.startUtc && <span className="block text-xs text-muted">Stored as {new Date(intent.window.startUtc).toISOString()} to {new Date(intent.window.endUtc!).toISOString()} (UTC)</span>}</dd>
              <dt className="text-muted">Trigger</dt><dd>{tpl ? `${tpl.aggregation.toLowerCase()}, ${triggerText(intent.trigger)}` : "—"}</dd>
              <dt className="text-muted">Payout wanted</dt><dd>{intent.desiredPayoutCents !== null ? fmtUsd(intent.desiredPayoutCents) : <em>not set</em>}</dd>
              <dt className="text-muted">Budget</dt><dd>{intent.budgetCents !== null ? fmtUsd(intent.budgetCents) : "—"}</dd>
              <dt className="text-muted">Extraction</dt><dd>{intent.confidence}% confidence in the terms (not in the outcome) · {intent.extractorVersion}</dd>
            </dl>
            {intent.manipulationRisk && <p className="mt-3 rounded bg-warn-soft p-2 text-sm text-warn">Manipulation risk: this outcome can be influenced or known in advance by people involved. It cannot be auto-approved for trading and is research-only or restricted.</p>}
          </section>
          {open.length > 0 && <section className="card" aria-labelledby="q"><h2 id="q" className="mb-2 font-semibold">We need a few details</h2><ul className="list-disc space-y-1 pl-5 text-sm">{open.map((u) => <li key={u.field}>{u.question}</li>)}</ul></section>}
          {(intent.basisRisk as string[]).length > 0 && <section className="card text-sm" aria-labelledby="br"><h2 id="br" className="mb-1 font-semibold">Basis risk</h2><ul className="list-disc space-y-1 pl-5">{(intent.basisRisk as string[]).map((b) => <li key={b}>{b}</li>)}</ul></section>}
          {tpl && intent.status !== "ARCHIVED" && <section className="card" aria-labelledby="ed"><h2 id="ed" className="mb-2 font-semibold">{intent.status === "CONFIRMED" ? "Change terms (you will review again)" : "Details"}</h2><ClarifyForm intent={intent} places={EV.SUPPORTED_PLACES} /></section>}
          {intent.status === "READY_FOR_REVIEW" && <section className="card"><h2 className="mb-2 font-semibold">Confirm the event</h2><ConfirmIntent id={intent.id} version={intent.version} /><p className="mt-2 text-xs text-muted">Confirming fixes the event definition. It does not buy anything.</p></section>}
        </div>
        <div className="space-y-4">
          <section className="card" aria-labelledby="mm">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="mm" className="font-semibold">Available contracts</h2>{matches && <MatchBadge value={matches.simulated.overall} />}</div>
            <p className="mt-1 text-xs text-muted">Checked {fmtStamp(new Date(), intent.window.timezone ?? undefined)} · match version {matches?.matchVersion ?? "—"}</p>
            {matches && matches.termsChangedMarketIds.length > 0 && <p role="alert" className="mt-2 rounded bg-warn-soft p-2 text-sm text-warn">Terms of a contract you looked at have changed since. Review the contract again before any position.</p>}
            <h3 className="mt-3 text-sm font-semibold">Real markets</h3>
            <p className="text-sm"><MatchBadge value="NONE" /> {matches?.live.explanation ?? "No verified real market is connected, so no real contract can be offered."}</p>
            <h3 className="mt-3 text-sm font-semibold">Simulated venue</h3>
            {!matches || matches.simulated.results.length === 0 ? <div className="space-y-2 text-sm"><p>No matching listed contract is available. You can track this event or request a new-market review.</p><DemandActions id={intent.id} /></div> :
              <ul className="mt-2 space-y-3">{matches.simulated.results.map((r) => <li key={r.marketId}><EventCard m={r.market}>
                <p className="text-sm"><MatchBadge value={r.exactness} /> {r.explanation}</p>
                {r.exactness === "PARTIAL" && <p className="text-xs text-muted">A partial match is not equivalent protection for your risk.</p>}
                {r.tradable ? <Link className="btn btn-secondary no-underline" href={`/markets/${r.marketId}?intent=${intent.id}&payout=${payoutUsd}`}>See cost and payout</Link> : <p className="text-sm text-muted">Not available for paper positions now.</p>}
              </EventCard></li>)}</ul>}
            {matches && matches.simulated.overall === "PARTIAL" && <div className="mt-3 text-sm"><p className="mb-1">None of these is exact. You can also register interest:</p><DemandActions id={intent.id} /></div>}
          </section>
        </div>
      </div>
    </UsShell>
  );
}
