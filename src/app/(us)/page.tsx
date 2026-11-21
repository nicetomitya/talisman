import Link from "next/link";
import { pageCtx } from "@/server/page";
import { UsShell } from "@/components/ev/shell";
import { RiskIntake } from "@/components/ev/client";

export const metadata = { title: "Talisman: event risk, explained" };

export default async function Landing() {
  const ctx = await pageCtx().catch(() => null);
  return (
    <UsShell ctx={ctx}>
      <div className="space-y-8">
        <section className="rounded-xl bg-white p-6 shadow-sm sm:p-10">
          <h1 className="text-2xl font-semibold sm:text-4xl">Protect what matters when events don&apos;t go as planned</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">Describe the risk. Understand the options. See the cost and possible payout.</p>
          <div className="mt-6 max-w-3xl"><RiskIntake /></div>
          <p className="mt-4 max-w-3xl text-xs text-muted">Availability depends on the market and your jurisdiction. Today Talisman runs in simulation only: contracts, prices and payouts are demo data with virtual money. Event contracts are financial instruments, not insurance policies.</p>
        </section>
        <section aria-labelledby="how"><h2 id="how" className="mb-3 text-lg font-semibold">How it works</h2>
          <ol className="grid gap-3 sm:grid-cols-4">
            {[["Describe", "Tell us in plain English what could go wrong, where and when."], ["Define", "The AI Event Builder turns it into exact terms: station, dates in local time, threshold, payout. It asks instead of guessing."], ["Compare", "We look for a listed contract and say honestly whether it is an exact, partial or no match."], ["Calculate", "See the cost across order book depth, your maximum loss and every outcome, before you decide anything."]].map(([t, d], i) => <li key={t} className="card"><span className="text-sm font-semibold text-[#0f7a4f]">{i + 1}. {t}</span><p className="mt-1 text-sm">{d}</p></li>)}
          </ol>
        </section>
        <section className="grid gap-3 sm:grid-cols-3" aria-label="Examples">
          {[["Windless regatta", "Sailing in Newport and worried the wind won't show up."], ["Rain on the wedding day", "An outdoor ceremony in Austin with a deposit at stake."], ["Heat during a festival", "Fewer visitors in Chicago if it gets above 95°F."]].map(([t, d]) => <div key={t} className="card"><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-muted">{d}</p><Link href={`/risk/new?text=${encodeURIComponent(d)}`} className="mt-2 inline-block text-sm">Start with this</Link></div>)}
        </section>
        <section className="card text-sm"><h2 className="font-semibold">What Talisman is and isn&apos;t</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5"><li>Talisman helps you define, compare and track event risks.</li><li>It is not an exchange, broker or insurer, holds no customer money, and does not place real orders.</li><li>Real-money event contracts would only be offered through a regulated partner, after its own checks. None are connected today.</li><li>Experts publish research. A forecast is an opinion, not advice or a promise.</li></ul>
          <p className="mt-2"><Link href="/how-it-works">Read the full disclosures</Link> · <Link href="/markets">Browse simulated contracts</Link></p></section>
      </div>
    </UsShell>
  );
}
