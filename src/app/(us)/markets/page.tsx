import { pageCtx } from "@/server/page";
import * as EV from "@/server/ev/service";
import { mockVenue, readOnlyMarketData } from "@/server/ev/venue";
import { UsShell } from "@/components/ev/shell";
import { EventCard } from "@/components/ev/ui";

export const metadata = { title: "Contracts" };
export default async function Markets() {
  const ctx = await pageCtx().catch(() => null);
  const markets = await EV.listMarkets();
  const venues = [await mockVenue.getVenueStatus(), await readOnlyMarketData.getVenueStatus()];
  return (
    <UsShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Contracts</h1>
      <ul className="mt-2 space-y-1 text-sm">{venues.map((v) => <li key={v.venue}><strong>{v.venue === "MOCK_VENUE" ? "Simulated venue" : "Real market data"}</strong>: {v.note}</li>)}</ul>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">{markets.map((m) => <li key={m.id}><EventCard m={m} /></li>)}</ul>
    </UsShell>
  );
}
