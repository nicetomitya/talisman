import { pageCtx } from "@/server/page";
import { UsShell } from "@/components/ev/shell";
import { NotInsurance, PartnerDisclosure } from "@/components/ev/ui";
import { SIM_VENUE_FEE_RULE } from "@/server/ev/pricing";
import { TIERS } from "@/server/ev/limits";
import { fmtUsd } from "@/lib/usd";

export const metadata = { title: "How it works and disclosures" };

export default async function HowItWorks() {
  const ctx = await pageCtx().catch(() => null);
  return (
    <UsShell ctx={ctx}>
      <article className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">How it works and disclosures</h1>
        <NotInsurance />
        <section className="card space-y-2 text-sm"><h2 className="text-lg font-semibold">The math of a binary event contract</h2>
          <p>Each unit pays $1.00 if its outcome happens and $0 if it does not. If a YES unit costs $0.20 and you want a $5,000 payout, you need 5,000 units: $1,000 plus fees, if that much is offered at $0.20.</p>
          <ul className="list-disc space-y-1 pl-5"><li>If the event happens: gross payout $5,000, net result $4,000 minus fees.</li><li>If it does not: the position pays $0 and you lose the $1,000 plus fees.</li><li>Buying NO at $0.80 for the same size costs $4,000; it pays $5,000 only if the event does not happen.</li></ul>
          <p>When the offers are at different prices, we walk the order book and show the depth-weighted average price, not the first price times your size. If only part of your size is offered, we say so before you confirm.</p>
          <p>A market price is not a proven probability. Quotes expire after 60 seconds and an expired quote cannot be confirmed.</p></section>
        <section className="card space-y-2 text-sm"><h2 className="text-lg font-semibold">Fees</h2><p>{SIM_VENUE_FEE_RULE} Talisman charges no fee: we would only add one with a regulated partner&apos;s approved fee schedule, and it would always be shown before you confirm.</p></section>
        <section className="card space-y-2 text-sm"><h2 className="text-lg font-semibold">Basis risk</h2><p>A contract settles on an index at a named observation station, not on what happened at your exact location or on your actual costs. The station can be miles away and conditions can differ.</p></section>
        <section className="card space-y-2 text-sm"><h2 className="text-lg font-semibold">Resolution and disputes</h2><p>After the event window ends, observations are collected from the primary station, with a named fallback station for missing days. If data is still missing, the outcome is not decided and nothing is paid until a review. A proposed outcome has a dispute window; position holders can dispute it. Only a confirmed outcome is settled. In this demo, observations and settlement are simulated.</p></section>
        <section className="card space-y-2 text-sm"><h2 className="text-lg font-semibold">Simulation limits</h2><p>Limits apply to the total possible payout across all related positions on the same event. They are product settings for the demo, not legal limits.</p>
          <ul className="list-disc pl-5">{Object.entries(TIERS).map(([k, t]) => <li key={k}>{k} · {t.label}: up to {fmtUsd(t.maxPayoutCents)} per event</li>)}</ul></section>
        <section className="card space-y-2 text-sm"><h2 className="text-lg font-semibold">Conflicts of interest</h2><p>Some events can be influenced by one party or known in advance by insiders, such as whether a particular building is finished on time. These contracts are research-only or restricted. People connected with the project (employees, contractors, inspectors, affiliates) cannot take positions. A small position does not make trading on non-public information acceptable.</p></section>
        <PartnerDisclosure />
      </article>
    </UsShell>
  );
}
