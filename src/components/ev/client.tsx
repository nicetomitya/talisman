"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, newKey, type ApiError } from "@/lib/client";
import { fmtPrice, fmtUsd, fmtVwap, fmtX100 } from "@/lib/usd";

export function Err({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="mt-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
      <p className="font-semibold">✕ {error.message}</p>
      {error.details?.fields?.length > 0 && <ul className="mt-1 list-disc pl-5">{error.details.fields.map((f: any, i: number) => <li key={i}>{f.path ? `${f.path}: ` : ""}{f.message}</li>)}</ul>}
      {error.correlationId && <p className="mt-1 text-xs opacity-80">Support code: {error.correlationId}</p>}
    </div>
  );
}

export function SignOut() {
  const router = useRouter();
  return <button className="btn btn-secondary !min-h-0 !py-1" onClick={async () => { await api("/api/auth/logout", { body: {} }); router.push("/"); router.refresh(); }}>Sign out</button>;
}

const EXAMPLES = [
  "I'm sailing in Newport next August. If the wind is too weak during the regatta, I want to offset $1,500 of my trip expenses.",
  "Outdoor wedding in Austin on May 8, 2027. If it rains more than 0.5 inches I'd like $3,000 back. Budget up to $1,000.",
  "We run a street festival in Chicago Jul 1-7, 2027. If it gets hotter than 95 F we lose sales, I want $2,000.",
];

/** Вход: свободный текст на английском → черновик RiskIntent (гостю — тоже). */
export function RiskIntake({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      const r = await api<{ id: string }>("/api/v2/risk-intents", { body: { description: text } });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      router.push(`/risk/${r.data.id}`);
    }}>
      <label htmlFor="risk-text" className="block text-lg font-semibold">What could go wrong, where and when?</label>
      <textarea id="risk-text" rows={4} className="field" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Describe the event, the place, the dates and how much you would want to receive." aria-describedby="risk-hint" />
      <p id="risk-hint" className="text-xs text-muted">The assistant only reads your text to fill in terms. It never buys anything, and it will ask before assuming a station, date or threshold.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy || text.trim().length < 5} aria-busy={busy}>{busy ? "Reading…" : "Build my event"}</button>
      </div>
      <details className="text-sm"><summary className="cursor-pointer text-accent">Try an example</summary>
        <ul className="mt-2 space-y-2">{EXAMPLES.map((x) => <li key={x}><button type="button" className="text-left underline decoration-dotted" onClick={() => setText(x)}>{x}</button></li>)}</ul>
      </details>
      <Err error={error} />
    </form>
  );
}

type Station = { id: string; name: string; distanceMiX10: number; note: string };
/** Уточнения: станция выбирается пользователем из ближайших; даты в часовом поясе события. */
export function ClarifyForm({ intent, places }: { intent: any; places: { key: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [placeKey, setPlaceKey] = useState<string>(intent.place?.key ?? "");
  const stations: Station[] = intent.place && intent.place.key === placeKey ? intent.place.stations : [];
  const unit = intent.trigger.unit ?? "";
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      const body: any = { version: intent.version };
      if (placeKey && placeKey !== intent.place?.key) body.placeKey = placeKey;
      const st = fd.get("station"); if (st) body.stationId = String(st);
      for (const k of ["windowStartLocal", "windowEndLocal"]) { const v = String(fd.get(k) ?? ""); if (v) body[k] = v; }
      const th = String(fd.get("threshold") ?? "").trim(); if (th) body.threshold = th;
      const p = String(fd.get("payout") ?? "").trim(); if (p) body.desiredPayoutUsd = p;
      const b = String(fd.get("budget") ?? "").trim(); body.budgetUsd = b === "" ? null : b;
      setBusy(true); setError(null);
      const r = await api(`/api/v2/risk-intents/${intent.id}`, { method: "PATCH", body });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      router.refresh();
    }}>
      <div><label htmlFor="place" className="mb-1 block text-sm font-medium">Location</label>
        <select id="place" className="field" value={placeKey} onChange={(e) => setPlaceKey(e.target.value)}><option value="">Choose a supported location</option>{places.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
        {placeKey !== (intent.place?.key ?? "") && <p className="mt-1 text-xs text-muted">Save to see stations near the new location.</p>}</div>
      {stations.length > 0 && <fieldset><legend className="mb-1 text-sm font-medium">Observation station that decides the outcome</legend>
        <ul className="space-y-2">{stations.map((s) => <li key={s.id}><label className="flex items-start gap-2 rounded-md border border-line p-2 text-sm"><input type="radio" name="station" value={s.id} defaultChecked={intent.stationId === s.id} className="mt-1" /><span><span className="font-medium">{s.name}</span> · {fmtX100(s.distanceMiX10 * 10, "mi")}<span className="block text-xs text-muted">Basis risk: {s.note}</span></span></label></li>)}</ul>
        <p className="mt-1 text-xs text-muted">We never pick a station for you. Wind, rain and heat at the station can differ from your exact spot.</p></fieldset>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="ws" className="mb-1 block text-sm font-medium">First day ({intent.window.timezone ?? "local time"})</label><input id="ws" name="windowStartLocal" type="date" defaultValue={intent.window.startLocal ?? ""} className="field" /></div>
        <div><label htmlFor="we" className="mb-1 block text-sm font-medium">Last day</label><input id="we" name="windowEndLocal" type="date" defaultValue={intent.window.endLocal ?? ""} className="field" /></div>
        <div><label htmlFor="th" className="mb-1 block text-sm font-medium">Threshold ({intent.trigger.operator === "BELOW" ? "below" : "above"}, {unit})</label><input id="th" name="threshold" inputMode="decimal" defaultValue={intent.trigger.thresholdX100 !== null ? fmtX100(intent.trigger.thresholdX100) : ""} className="field" /></div>
        <div><label htmlFor="po" className="mb-1 block text-sm font-medium">Payout you want if it happens (USD)</label><input id="po" name="payout" inputMode="decimal" defaultValue={intent.desiredPayoutCents !== null ? String(intent.desiredPayoutCents / 100) : ""} className="field" /></div>
        <div><label htmlFor="bu" className="mb-1 block text-sm font-medium">Budget, optional (USD)</label><input id="bu" name="budget" inputMode="decimal" defaultValue={intent.budgetCents !== null ? String(intent.budgetCents / 100) : ""} className="field" /></div>
      </div>
      <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Save details"}</button>
      <Err error={error} />
    </form>
  );
}

export function ConfirmIntent({ id, version }: { id: string; version: number }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>The summary above is what I mean. I understand a payout would depend only on the official index at the chosen station.</span></label>
      <button className="btn btn-primary" disabled={!ok || busy} onClick={async () => { setBusy(true); setError(null); const r = await api(`/api/v2/event-drafts/${id}/validate`, { body: { version, confirm: true } }); setBusy(false); if (!r.ok) return setError(r.error); router.refresh(); }}>Confirm event terms</button>
      <Err error={error} />
    </div>
  );
}

export function DemandActions({ id }: { id: string }) {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const send = async (kind: string) => { setError(null); const r = await api(`/api/v2/risk-intents/${id}/demand`, { body: { kind } }); if (!r.ok) return setError(r.error); setDone(kind); };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-secondary" onClick={() => send("WATCH")}>Watch this risk</button>
        <button className="btn btn-secondary" onClick={() => send("WAITLIST")}>Join demand waitlist</button>
        <button className="btn btn-secondary" onClick={() => send("SUGGEST_SPEC")}>Suggest a contract specification</button>
      </div>
      {done && <p role="status" className="mt-2 text-sm text-ok">✓ Saved. This is a signal of interest only. Nothing is purchased and no payment is taken.</p>}
      <Err error={error} />
    </div>
  );
}

type Quote = any;
/**
 * QuoteWidget + ProtectionCalculator: max loss и источники показываются до кнопки (крит. 27);
 * устаревшая котировка недоступна для подтверждения (крит. 7); частичное исполнение — явное согласие (крит. 6).
 */
export function QuoteCalculator({ marketId, defaultPayoutUsd, riskIntentId, signedIn, canTrade, needsConflict, objectKey, tz }: { marketId: string; defaultPayoutUsd: number; riskIntentId?: string | null; signedIn: boolean; canTrade: boolean; needsConflict: boolean; objectKey?: string | null; tz: string }) {
  const router = useRouter();
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [payout, setPayout] = useState(String(defaultPayoutUsd));
  const [q, setQ] = useState<Quote | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [partialOk, setPartialOk] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [nowMs, setNowMs] = useState(0);
  const key = useMemo(() => (q ? `${q.quoteSnapshotId}:${newKey()}` : ""), [q]);
  const load = async () => {
    setError(null); setDone(null); setAck(false); setPartialOk(false);
    const r = await api<Quote>(`/api/v2/markets/${marketId}/quote?side=${side}&targetPayoutUsd=${encodeURIComponent(payout.replace(/[$,]/g, ""))}`);
    if (!r.ok) { setQ(null); return setError(r.error); }
    setQ(r.data); setNowMs(Date.now()); setReceivedAt(Date.now());
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [side]);
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 5000); return () => clearInterval(t); }, []);
  const [receivedAt, setReceivedAt] = useState(0);
  // Срок жизни считаем от момента получения (часы браузера и демо-часы сервера могут расходиться).
  const ttlLeftMs = q ? new Date(q.staleAt).getTime() - new Date(q.takenAt).getTime() - q.ageSec * 1000 : 0;
  const stale = q ? q.stale || (receivedAt > 0 && nowMs - receivedAt >= ttlLeftMs) : false;
  const c = q?.calc;
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <fieldset><legend className="mb-1 text-sm font-medium">Outcome you take</legend>
          <div className="inline-flex rounded-md border border-line" role="radiogroup">
            {(["YES", "NO"] as const).map((s) => <label key={s} className={`cursor-pointer px-3 py-2 text-sm ${side === s ? "bg-accent text-white" : "bg-white"}`}><input type="radio" className="sr-only" name="side" checked={side === s} onChange={() => setSide(s)} />{s === "YES" ? "YES: pays if it happens" : "NO: pays if it doesn't"}</label>)}
          </div></fieldset>
        <div><label htmlFor="payout" className="mb-1 block text-sm font-medium">Possible payout (USD)</label><input id="payout" className="field w-36" inputMode="decimal" value={payout} onChange={(e) => setPayout(e.target.value)} /></div>
        <button className="btn btn-secondary">Update quote</button>
      </form>
      <Err error={error} />
      {q && c && <>
        <section aria-label="Cost and possible outcome" className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border-2 border-bad/40 bg-bad-soft p-3"><p className="text-xs font-medium text-bad">Maximum loss</p><p className="text-2xl font-semibold text-bad"><span className="num">{fmtUsd(c.maxLossCents)}</span></p><p className="text-xs">Everything you pay, including fees, if the outcome goes the other way.</p></div>
          <div className="rounded-md border border-line bg-white p-3"><p className="text-xs font-medium text-muted">Total cost (virtual)</p><p className="text-2xl font-semibold"><span className="num">{fmtUsd(c.totalCents)}</span></p><p className="text-xs">{c.filledUnits.toLocaleString("en-US")} units × avg {c.vwapX100 !== null ? fmtVwap(c.vwapX100) : "—"} + fees {fmtUsd(c.venueFeeCents + c.talismanFeeCents)}</p></div>
          <div className="rounded-md border border-ok/30 bg-ok-soft p-3"><p className="text-xs font-medium text-ok">Possible gross payout</p><p className="text-2xl font-semibold text-ok"><span className="num">{fmtUsd(c.grossPayoutCents)}</span></p><p className="text-xs">$1.00 per unit if {side === "YES" ? "the event happens" : "the event does not happen"}.</p></div>
        </section>
        <p className="text-sm" data-testid="quote-source">Source: <strong>{q.source}</strong> · venue {q.venue} · <strong>{q.sourceKind}</strong> · quoted {fmtTime(q.takenAt, tz)} ({q.ageSec}s old) · valid until {fmtTime(q.staleAt, tz)}</p>
        {stale && <p role="alert" className="rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn">This quote is out of date and cannot be confirmed. <button type="button" className="underline" onClick={load}>Refresh the quote</button></p>}
        {c.partial && <p role="alert" className="rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn">Only {c.fillPct}% of the size you asked for is available ({c.filledUnits.toLocaleString("en-US")} of {c.requestedUnits.toLocaleString("en-US")} units). The payout would be {fmtUsd(c.grossPayoutCents)}, not {fmtUsd(c.requestedUnits * 100)}.</p>}
        <table className="tbl tbl-stack"><caption className="mb-1 text-left text-sm font-medium">Outcome scenarios (before any exit)</caption>
          <thead><tr><th>If…</th><th>Gross payout</th><th>Net result</th></tr></thead>
          <tbody>
            <tr><td data-label="If…">the event happens</td><td data-label="Gross"><span className="num">{fmtUsd(c.scenarios.eventHappens.grossCents)}</span></td><td data-label="Net"><span className={`num ${c.scenarios.eventHappens.netCents < 0 ? "text-bad" : "text-ok"}`}>{fmtUsd(c.scenarios.eventHappens.netCents, { sign: true })}</span></td></tr>
            <tr><td data-label="If…">the event does not happen</td><td data-label="Gross"><span className="num">{fmtUsd(c.scenarios.eventDoesNotHappen.grossCents)}</span></td><td data-label="Net"><span className={`num ${c.scenarios.eventDoesNotHappen.netCents < 0 ? "text-bad" : "text-ok"}`}>{fmtUsd(c.scenarios.eventDoesNotHappen.netCents, { sign: true })}</span></td></tr>
          </tbody></table>
        <details className="text-sm"><summary className="cursor-pointer text-accent">Order book depth and fees</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div><p className="font-medium">Fills for your size</p><ul className="num">{c.fills.map((f: any, i: number) => <li key={i}>{f.units.toLocaleString("en-US")} × {fmtPrice(f.priceCents)}</li>)}</ul></div>
            <div><p className="font-medium">Offers ({side})</p><ul className="num">{(side === "YES" ? q.book.yesAsks : q.book.noAsks).map((l: number[], i: number) => <li key={i}>{l[1].toLocaleString("en-US")} at {fmtPrice(l[0])}</li>)}</ul><p className="text-xs text-muted">Spread: {q.book.spreadCents !== null ? `${q.book.spreadCents}¢` : "—"}</p></div>
          </div>
          <p className="mt-2 text-xs text-muted">Fees: simulated venue {fmtUsd(c.venueFeeCents)}; Talisman {fmtUsd(c.talismanFeeCents)} (Talisman charges no fee without an approved partner fee schedule). {q.feeRule}</p>
          <p className="mt-1 text-xs text-muted">A market price is not a proven probability. Quotes can disappear, and fills are never guaranteed.</p>
        </details>
        {done ? <p role="status" className="rounded-md border border-ok/30 bg-ok-soft p-3 text-sm">✓ Paper position opened: {done.filledUnits.toLocaleString("en-US")} units, virtual cost {fmtUsd(done.totalCents)}. <Link href="/app/portfolio">View in portfolio</Link></p> :
          !signedIn ? <p className="text-sm"><Link className="btn btn-primary no-underline" href={`/signin?next=/markets/${marketId}`}>Sign in to open a paper position</Link> <span className="text-muted">Exploring quotes works without an account.</span></p> :
          !canTrade ? <p className="text-sm text-muted">Paper positions are not available for this contract right now.</p> :
          needsConflict ? <ConflictDeclare objectKey={objectKey!} /> :
          <div className="space-y-2 rounded-md border border-line bg-white p-3">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>I understand this is a <strong>simulated</strong> position with virtual money, it is not an insurance policy, and I could lose the full {fmtUsd(c.maxLossCents)}.</span></label>
            {c.partial && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={partialOk} onChange={(e) => setPartialOk(e.target.checked)} /><span>Accept a partial fill of {c.fillPct}%.</span></label>}
            <button className="btn btn-primary" disabled={!ack || busy || stale || !q.canConfirm || (c.partial && !partialOk)} aria-busy={busy} onClick={async () => {
              setBusy(true); setError(null);
              const r = await api("/api/v2/sim/orders", { body: { marketId, side, targetPayoutUsd: payout.replace(/[$,]/g, ""), quoteSnapshotId: q.quoteSnapshotId, termsHash: q.termsHash, riskIntentId: riskIntentId ?? null, allowPartial: partialOk, confirm: true, idempotencyKey: key } });
              setBusy(false);
              if (!r.ok) return setError(r.error);
              setDone(r.data); router.refresh();
            }}>Open paper position</button>
            {!q.canConfirm && !stale && <p className="text-xs text-muted">Not available: {q.blockers.join(", ").toLowerCase().replace(/_/g, " ")}.</p>}
          </div>}
      </>}
    </div>
  );
}
const fmtTime = (d: string, tz: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short", timeZone: tz });

const RELS: [string, string][] = [["NONE", "No connection"], ["EMPLOYEE", "Employee of the builder or developer"], ["CONTRACTOR", "Contractor or subcontractor on the project"], ["INSPECTOR", "Inspector or permit official"], ["AFFILIATE", "Related to someone above, or an affiliated account"], ["OTHER", "Other connection"]];
export function ConflictDeclare({ objectKey }: { objectKey: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [res, setRes] = useState<string | null>(null);
  return (
    <form className="space-y-2 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm" onSubmit={async (e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget); setError(null);
      const r = await api<{ restriction: string }>("/api/v2/participant/conflicts", { body: { objectKey, relationship: fd.get("rel"), detail: String(fd.get("detail") ?? "") || undefined } });
      if (!r.ok) return setError(r.error);
      setRes(r.data.restriction); router.refresh();
    }}>
      <p className="font-medium">Before any position on this project, tell us about your connection to it.</p>
      <label htmlFor="rel" className="block">Your connection</label>
      <select id="rel" name="rel" className="field">{RELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <label htmlFor="detail" className="block">Details (optional)</label><input id="detail" name="detail" className="field" maxLength={1000} />
      <button className="btn btn-primary">Submit declaration</button>
      {res && <p role="status">{res === "ALLOWED" ? "✓ Declaration saved." : res === "BLOCKED" ? "Positions on this contract are not available to people connected with the project." : "Your declaration needs a compliance review."}</p>}
      <Err error={error} />
    </form>
  );
}

export function DisputeForm({ marketId }: { marketId: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setError(null); const r = await api(`/api/v2/events/${marketId}/dispute`, { body: { reason: fd.get("reason") } }); if (!r.ok) return setError(r.error); router.refresh(); }}>
      <label htmlFor={`dr-${marketId}`} className="block text-sm font-medium">Dispute the proposed outcome</label>
      <textarea id={`dr-${marketId}`} name="reason" rows={2} className="field" placeholder="What looks wrong in the data or the calculation?" />
      <button className="btn btn-secondary">Send dispute</button>
      <Err error={error} />
    </form>
  );
}

export function ExpertProfileForm({ initial }: { initial?: any }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget); setError(null);
      const r = await api("/api/v2/expert/profile", { body: { displayName: fd.get("displayName"), tags: String(fd.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean), credentials: fd.get("credentials"), disclosures: fd.get("disclosures"), conflicts: String(fd.get("conflicts") ?? "") || undefined } });
      if (!r.ok) return setError(r.error); router.refresh();
    }}>
      {[["displayName", "Display name and specialization", initial?.displayName], ["tags", "Topics, comma-separated", (initial?.tags ?? []).join(", ")]].map(([n, l, v]) => <div key={n}><label htmlFor={n} className="mb-1 block text-sm font-medium">{l}</label><input id={n} name={n} defaultValue={v ?? ""} className="field" /></div>)}
      {[["credentials", "Experience and documents (moderators verify; no trading license is implied)", initial?.credentials], ["disclosures", "Disclosures (positions, employers, funding)", initial?.disclosures], ["conflicts", "Conflicts of interest", initial?.conflicts]].map(([n, l, v]) => <div key={n}><label htmlFor={n} className="mb-1 block text-sm font-medium">{l}</label><textarea id={n} name={n} rows={2} defaultValue={v ?? ""} className="field" /></div>)}
      <button className="btn btn-primary">{initial ? "Update profile (sends it to moderation again)" : "Submit for moderation"}</button>
      <Err error={error} />
    </form>
  );
}

export function ForecastForm({ markets }: { markets: { id: string; title: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget); setError(null); setOk(null);
      const r = await api<{ version: number }>("/api/v2/expert/forecasts", { body: { marketId: fd.get("marketId"), probabilityPct: Number(fd.get("p")), method: fd.get("method"), note: String(fd.get("note") ?? "") || undefined } });
      if (!r.ok) return setError(r.error); setOk(`Published as version ${r.data.version}. Earlier versions stay visible.`); router.refresh();
    }}>
      <div><label htmlFor="fm" className="mb-1 block text-sm font-medium">Contract</label><select id="fm" name="marketId" className="field">{markets.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></div>
      <div><label htmlFor="fp" className="mb-1 block text-sm font-medium">Your probability that the event happens (%)</label><input id="fp" name="p" type="number" min={0} max={100} className="field w-28" required /></div>
      <div><label htmlFor="fme" className="mb-1 block text-sm font-medium">Method and data sources</label><textarea id="fme" name="method" rows={2} className="field" required /></div>
      <div><label htmlFor="fn" className="mb-1 block text-sm font-medium">Research note (optional)</label><textarea id="fn" name="note" rows={2} className="field" /></div>
      <button className="btn btn-primary">Publish forecast</button>
      {ok && <p role="status" className="text-sm text-ok">✓ {ok}</p>}
      <Err error={error} />
    </form>
  );
}

/** Действие комплаенс-консоли: всегда с основанием; запрос идёт на сервер, где проверяются права и 2FA. */
export function OpsAction({ action, payload, label, needReason = true, fields }: { action: string; payload: Record<string, unknown>; label: string; needReason?: boolean; fields?: { name: string; label: string; options?: string[] }[] }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget); setError(null); setMsg(null);
      const body: any = { ...payload };
      for (const f of fields ?? []) { const v = fd.get(f.name); if (v !== null && v !== "") body[f.name] = v; }
      if (needReason) body.reason = fd.get("reason");
      setBusy(true);
      const url = action === "compliance" ? "/api/v2/compliance/reviews" : `/api/v2/admin/${action}`;
      const r = await api(url, { body });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      setMsg("Done"); router.refresh();
    }}>
      {fields?.map((f) => <div key={f.name}><label className="mb-1 block text-xs font-medium" htmlFor={`${action}-${f.name}-${JSON.stringify(payload)}`}>{f.label}</label>{f.options ? <select id={`${action}-${f.name}-${JSON.stringify(payload)}`} name={f.name} className="field !py-1">{f.options.map((o) => <option key={o}>{o}</option>)}</select> : <input id={`${action}-${f.name}-${JSON.stringify(payload)}`} name={f.name} className="field !py-1 w-24" />}</div>)}
      {needReason && <div className="min-w-48 flex-1"><label className="mb-1 block text-xs font-medium" htmlFor={`${action}-reason-${JSON.stringify(payload)}`}>Reason</label><input id={`${action}-reason-${JSON.stringify(payload)}`} name="reason" className="field !py-1" required minLength={5} /></div>}
      <button className="btn btn-secondary !min-h-0 !py-1.5" disabled={busy}>{label}</button>
      {msg && <span role="status" className="text-xs text-ok">✓ {msg}</span>}
      <Err error={error} />
    </form>
  );
}

export function DemoSignIn({ accounts, next }: { accounts: { email: string; title: string }[]; next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {accounts.map((a) => <li key={a.email}><button className="btn btn-secondary w-full !justify-start text-left" onClick={async () => { setError(null); const r = await api("/api/auth/demo-switch", { body: { email: a.email } }); if (!r.ok) return setError(r.error); router.push(next && next.startsWith("/") ? next : "/go"); router.refresh(); }}><span><span className="block text-sm font-medium">{a.title}</span><span className="block text-xs text-muted">{a.email}</span></span></button></li>)}
      </ul>
      <Err error={error} />
    </div>
  );
}

export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget); setBusy(true); setError(null);
      const r = await api<any>("/api/auth/login", { body: { email: fd.get("email"), password: fd.get("password") } });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      if (r.data.needTotp) return setError({ code: "MFA", message: "This account uses a second factor. Use the staff sign-in page." });
      router.push(next && next.startsWith("/") ? next : "/go"); router.refresh();
    }}>
      <div><label htmlFor="em" className="mb-1 block text-sm font-medium">Email</label><input id="em" name="email" type="email" autoComplete="email" className="field" required /></div>
      <div><label htmlFor="pw" className="mb-1 block text-sm font-medium">Password</label><input id="pw" name="password" type="password" autoComplete="current-password" className="field" required /></div>
      <button className="btn btn-primary" disabled={busy}>Sign in</button>
      <Err error={error} />
    </form>
  );
}
