import Link from "next/link";
import type { ReactNode } from "react";
import { fmtUsd, fmtX100, OP_LABEL } from "@/lib/usd";

/** Серверные компоненты US-интерфейса (ТЗ v2, п. 14). Без клиентского состояния. */
export function SimRibbon() {
  return (
    <div role="note" aria-label="Simulation mode" className="sticky top-0 z-40 bg-[#3b2a6b] px-4 py-1.5 text-center text-xs font-medium text-white">
      SIMULATION · Virtual money only. No real orders, no real payouts. Prices and order books are fixed demo data.
    </div>
  );
}

export function NotInsurance({ className = "" }: { className?: string }) {
  return <p role="note" className={`rounded-md border border-line bg-bg p-3 text-sm ${className}`}><strong>This is a financial event contract, not an insurance policy.</strong> It pays only if the stated index outcome happens, regardless of your actual loss. You could lose the entire amount you pay.</p>;
}

export function PartnerDisclosure() {
  return (
    <section aria-labelledby="pd" className="rounded-md border border-line bg-white p-3 text-sm">
      <h3 id="pd" className="font-semibold">Who is on the other side</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
        <li>Venue: <strong className="text-ink">Talisman Mock Venue (simulation)</strong>. It is not a regulated exchange and is not connected to one.</li>
        <li>Funds: none. Positions use virtual dollars; Talisman holds no customer money.</li>
        <li>Resolution: demo observations and a Talisman admin review, shown with evidence and a dispute window.</li>
        <li>Real-money event contracts would only be available through a regulated partner, after its own eligibility, identity and location checks.</li>
      </ul>
    </section>
  );
}

const MATCH_STYLE: Record<string, string> = { EXACT: "bg-ok-soft text-ok border-ok/30", PARTIAL: "bg-warn-soft text-warn border-warn/30", NONE: "bg-bg text-muted border-line" };
const MATCH_TEXT: Record<string, string> = { EXACT: "Exact match", PARTIAL: "Partial match", NONE: "No match" };
export function MatchBadge({ value }: { value: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${MATCH_STYLE[value] ?? MATCH_STYLE.NONE}`} title={value === "EXACT" ? "All terms match. A match is not a guarantee of payout." : undefined}>{MATCH_TEXT[value] ?? value}</span>;
}

const STATUS_TEXT: Record<string, [string, string]> = {
  OPEN: ["Open (simulation)", "text-ok"], SUSPENDED: ["Suspended", "text-warn"], CLOSED: ["Closed, awaiting resolution", "text-muted"], RESOLVED: ["Resolved", "text-ink"], SETTLED: ["Settled (simulated)", "text-ink"],
  SIM_ALLOWED: ["Paper positions allowed", "text-ok"], RESTRICTED: ["Restricted: conflict declaration required", "text-warn"], RESEARCH_ONLY: ["Research only", "text-warn"], BLOCKED: ["Blocked", "text-bad"],
  NEEDS_CLARIFICATION: ["Needs details", "text-warn"], READY_FOR_REVIEW: ["Ready for your review", "text-accent"], CONFIRMED: ["Confirmed by you", "text-ok"], ARCHIVED: ["Archived", "text-muted"],
  NEEDS_DATA: ["Needs data review", "text-warn"], PROPOSED: ["Outcome proposed, dispute window open", "text-accent"], DISPUTED: ["Disputed", "text-bad"],
};
export function Pill({ value }: { value: string }) {
  const [t, c] = STATUS_TEXT[value] ?? [value, "text-muted"];
  return <span className={`text-sm font-medium ${c}`}>{t}</span>;
}

export const triggerText = (t: { operator: string | null; thresholdX100: number | null; unit: string | null }, metric = "") => t.thresholdX100 === null ? "threshold not set" : `${metric ? metric + " " : ""}${OP_LABEL[t.operator ?? ""] ?? ""} ${fmtX100(t.thresholdX100, t.unit)}`.trim();
export const fmtDay = (iso: string | null | undefined) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
export const fmtStamp = (d: Date | string, tz = "America/New_York") => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: tz });
export const windowText = (a: string | null, b: string | null, tz?: string | null) => (a ? `${fmtDay(a)}${b && b !== a ? ` – ${fmtDay(b)}` : ""}${tz ? ` (${tz.replace("America/", "").replace("_", " ")} time)` : ""}` : "dates not set");

export function EventCard({ m, children }: { m: any; children?: ReactNode }) {
  const t = m.terms;
  return (
    <article className="card space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-semibold"><Link href={`/markets/${m.id}`}>{m.title}</Link></h3>
        <span className="rounded bg-[#ece8f7] px-2 py-0.5 text-xs font-semibold text-[#3b2a6b]">{m.sourceKind}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Place</dt><dd>{m.place?.name ?? t.placeKey}</dd>
        <dt className="text-muted">Station</dt><dd>{m.station?.name ?? t.stationId}</dd>
        <dt className="text-muted">Dates</dt><dd>{windowText(t.windowStartLocal, t.windowEndLocal, t.timezone)}</dd>
        <dt className="text-muted">Pays if</dt><dd>{m.template.outcomeYes.replace("the threshold", fmtX100(t.thresholdX100, t.unit))}</dd>
        <dt className="text-muted">Status</dt><dd><Pill value={m.status} /> · <Pill value={m.complianceStatus} /></dd>
      </dl>
      {m.manipulationRisk && <p className="rounded bg-warn-soft p-2 text-xs text-warn">Manipulation risk: people involved in the project can influence or know the outcome.</p>}
      {children}
    </article>
  );
}

export function Money({ cents, sign }: { cents: number; sign?: boolean }) { return <span className="num">{fmtUsd(cents, { sign })}</span>; }
export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return <section aria-labelledby={id} className="card"><h2 id={id} className="mb-2 text-lg font-semibold">{title}</h2>{children}</section>;
}
