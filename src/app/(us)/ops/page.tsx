import { redirect } from "next/navigation";
import { pageCtx } from "@/server/page";
import { db } from "@/server/db";
import * as EV from "@/server/ev/service";
import { mockVenue } from "@/server/ev/venue";
import { UsShell } from "@/components/ev/shell";
import { Pill } from "@/components/ev/ui";
import { OpsAction } from "@/components/ev/client";
import { fmtUsd, fmtX100 } from "@/lib/usd";

export const metadata = { title: "Compliance console" };
export default async function Ops() {
  const ctx = await pageCtx().catch(() => null);
  if (!ctx) redirect("/signin?next=/ops");
  if (!(ctx.org?.orgType === "PLATFORM" && (ctx.org.role === "ADMIN" || ctx.org.role === "SUPPORT"))) redirect("/go");
  const admin = ctx.org.role === "ADMIN";
  const [markets, cluster, decls, experts, reviews, auditRows, venue, usUsers] = await Promise.all([
    EV.listMarkets(), EV.clusterRisk(ctx), db.conflictDeclaration.findMany({ orderBy: { createdAt: "desc" } }), db.expertProfile.findMany({ orderBy: { createdAt: "asc" } }),
    db.complianceReview.findMany({ orderBy: { createdAt: "desc" }, take: 20 }), db.auditLog.findMany({ where: { action: { startsWith: "ev." } }, orderBy: { at: "desc" }, take: 30 }),
    mockVenue.getVenueStatus(), db.user.findMany({ where: { market: "US" }, orderBy: { email: "asc" } }),
  ]);
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set([...decls.map((d) => d.userId), ...experts.map((e) => e.userId), ...reviews.map((r) => r.reviewerId), ...auditRows.map((a) => a.actorUserId).filter(Boolean) as string[]])] } } })).map((u) => [u.id, u.email]));
  const res = await db.resolutionRecord.findMany();
  return (
    <UsShell ctx={ctx} wide>
      <h1 className="text-2xl font-semibold">Compliance console</h1>
      <p className="mt-1 text-sm text-muted">{admin ? "Every change needs a reason and is written to the audit log with who and when." : "Read-only for support."}</p>

      <section className="card mt-4 text-sm"><h2 className="mb-1 font-semibold">Simulated venue</h2><p>{venue.available ? "Available" : "Outage"} · {venue.note}</p>
        {admin && <div className="mt-2"><OpsAction action="outage" payload={{ on: venue.available }} needReason={false} label={venue.available ? "Simulate venue outage" : "End outage"} /></div>}</section>

      <section className="card mt-4"><h2 className="mb-2 font-semibold">Contracts</h2>
        <ul className="space-y-3">{markets.map((m) => { const r = res.find((x) => x.marketId === m.id); return <li key={m.id} className="rounded-md border border-line p-3 text-sm">
          <p className="font-medium">{m.title}</p>
          <p className="text-muted">{m.venueMarketId} · <Pill value={m.status} /> · <Pill value={m.complianceStatus} /> · threshold {fmtX100(m.terms.thresholdX100, m.terms.unit)} · terms v{m.termsVersion}{m.manipulationRisk ? " · manipulation risk" : ""}{r ? ` · resolution ${r.status}${r.outcome ? ` (${r.outcome})` : ""}` : ""}</p>
          {admin && <div className="mt-2 space-y-2">
            <OpsAction action="compliance" payload={{ marketId: m.id }} label="Set compliance status" fields={[{ name: "toStatus", label: "New status", options: ["SIM_ALLOWED", "RESTRICTED", "RESEARCH_ONLY", "BLOCKED"].filter((s) => s !== m.complianceStatus) }]} />
            {(m.status === "OPEN" || m.status === "SUSPENDED") && <OpsAction action="market-status" payload={{ marketId: m.id }} label="Change trading status" fields={[{ name: "toStatus", label: "Trading", options: m.status === "OPEN" ? ["SUSPENDED", "CLOSED"] : ["OPEN", "CLOSED"] }]} />}
            {(m.status === "OPEN" || m.status === "SUSPENDED") && <OpsAction action="market-terms" payload={{ marketId: m.id }} label="Change threshold (new terms version)" fields={[{ name: "threshold", label: `Threshold, ${m.terms.unit}` }]} />}
            {(!r || r.status === "NEEDS_DATA" || r.status === "PROPOSED") && <OpsAction action="observe" payload={{ marketId: m.id }} needReason={false} label="Collect observations and propose outcome" />}
            {r && (r.status === "PROPOSED" || r.status === "DISPUTED") && <OpsAction action="finalize" payload={{ marketId: m.id }} label="Confirm outcome and settle (simulated)" fields={r.status === "DISPUTED" ? [{ name: "outcome", label: "Decision", options: ["YES", "NO"] }] : []} />}
          </div>}
        </li>; })}</ul></section>

      <section className="card mt-4"><h2 className="mb-1 font-semibold">Cluster risk</h2><p className="mb-2 text-sm text-muted">Shared exposure on the same object or event, shown separately from individual positions. All amounts are virtual.</p>
        <table className="tbl tbl-stack"><thead><tr><th>Group</th><th>Holders</th><th>Lots</th><th>Pays if YES</th><th>Pays if NO</th><th>Paid (virtual)</th></tr></thead>
          <tbody>{cluster.map((g) => <tr key={g.key}><td data-label="Group">{g.kind === "OBJECT" ? "Shared object: " : "Event: "}{g.key.split(":").slice(1).join(":")}</td><td data-label="Holders">{g.holders}</td><td data-label="Lots">{g.lots}</td><td data-label="YES">{fmtUsd(g.yesPayoutCents)}</td><td data-label="NO">{fmtUsd(g.noPayoutCents)}</td><td data-label="Paid">{fmtUsd(g.costCents)}</td></tr>)}</tbody></table></section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card text-sm"><h2 className="mb-2 font-semibold">Conflict declarations</h2><ul className="space-y-2">{decls.map((d) => <li key={d.id} className="rounded border border-line p-2"><p>{names.get(d.userId)} · {d.objectKey} · {d.relationship} → <strong>{d.restriction}</strong>{d.detail ? ` · “${d.detail}”` : ""}</p>{admin && <OpsAction action="conflict-restriction" payload={{ declarationId: d.id }} label="Set restriction" fields={[{ name: "restriction", label: "Restriction", options: ["BLOCKED", "MANUAL_REVIEW", "ALLOWED"] }]} />}</li>)}</ul></section>
        <section className="card text-sm"><h2 className="mb-2 font-semibold">Experts</h2><ul className="space-y-2">{experts.map((p) => <li key={p.id} className="rounded border border-line p-2"><p>{p.displayName} ({names.get(p.userId)}) · {p.moderationStatus} · liquidity provider: {p.liquidityProviderStatus}</p>{admin && <><OpsAction action="expert-moderate" payload={{ userId: p.userId }} label="Moderate" fields={[{ name: "to", label: "Decision", options: ["APPROVED", "REJECTED"] }]} /><OpsAction action="liquidity-provider" payload={{ userId: p.userId }} label="Liquidity provider (simulation)" fields={[{ name: "status", label: "Status", options: ["NONE", "APPROVED"] }]} /></>}</li>)}</ul></section>
        <section className="card text-sm"><h2 className="mb-2 font-semibold">Participant tiers</h2><ul className="space-y-2">{usUsers.map((u) => <li key={u.id} className="rounded border border-line p-2"><p>{u.email} · override {u.riskTierOverride ?? "none"}</p>{admin && <OpsAction action="tier" payload={{ userId: u.id }} label="Set tier" fields={[{ name: "tier", label: "Tier", options: ["T1", "T2", "T3"] }]} />}</li>)}</ul></section>
        <section className="card text-sm"><h2 className="mb-2 font-semibold">Compliance status history</h2><ul className="space-y-1">{reviews.length === 0 ? <li className="text-muted">No changes yet.</li> : reviews.map((r) => <li key={r.id}>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC · {names.get(r.reviewerId)} · {markets.find((m) => m.id === r.marketId)?.venueMarketId}: {r.fromStatus} → {r.toStatus} · “{r.reason}”</li>)}</ul></section>
      </div>
      <section className="card mt-4 text-sm"><h2 className="mb-2 font-semibold">Audit (event contracts)</h2><ul className="space-y-1 font-mono text-xs">{auditRows.map((a) => <li key={a.id}>{a.at.toISOString().slice(0, 19).replace("T", " ")} · {a.actorUserId ? names.get(a.actorUserId) ?? a.actorRole : a.actorRole} · {a.action} · {a.entityType}{a.reason ? ` · ${a.reason}` : ""}</li>)}</ul></section>
    </UsShell>
  );
}
