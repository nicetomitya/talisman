import { db } from "@/server/db";
import { now } from "@/server/clock";
import * as EV from "@/server/ev/service";
import { requireUsClient, Workspace } from "@/components/ev/workspace";
import { ExpertProfileForm, ForecastForm } from "@/components/ev/client";

export const metadata = { title: "Expert research" };
export default async function Expert() {
  const ctx = await requireUsClient("/app/expert");
  const d = await EV.expertDashboard(ctx);
  const at = await now();
  const openMarkets = (await db.venueMarket.findMany({ where: { status: "OPEN", tradingCloseUtc: { gt: at } }, orderBy: { title: "asc" } })).map((m) => ({ id: m.id, title: m.title }));
  const p = d.profile;
  return (
    <Workspace ctx={ctx} active="/app/expert">
      <h1 className="text-2xl font-semibold">Expert research</h1>
      <p className="mt-1 text-sm text-muted">Publish research and forecasts. An expert profile is not a trading license or permission to advise clients. Liquidity-provider status can only be granted by Talisman compliance, and only for the simulation.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card"><h2 className="mb-2 font-semibold">Profile {p && <span className="text-sm font-normal text-muted">· moderation: {p.moderationStatus.toLowerCase()} · liquidity provider: {p.liquidityProviderStatus.toLowerCase()}</span>}</h2><ExpertProfileForm initial={p} /></section>
        <section className="card"><h2 className="mb-2 font-semibold">Publish a forecast</h2>{p?.moderationStatus === "APPROVED" ? <ForecastForm markets={openMarkets} /> : <p className="text-sm text-muted">Available after your profile is approved.</p>}</section>
      </div>
      <section className="card mt-4"><h2 className="mb-2 font-semibold">Calibration</h2>
        <p className="text-sm">Resolved forecasts: {d.calibration.resolved}{d.calibration.avgBrierBp !== null ? ` · average Brier score ${(d.calibration.avgBrierBp / 10000).toFixed(4)} (0 is perfect, lower is better)` : ""}</p>
        <table className="tbl tbl-stack mt-2"><thead><tr><th>Contract</th><th>Version</th><th>Probability</th><th>Method</th><th>Published</th></tr></thead>
          <tbody>{d.forecasts.map((f) => <tr key={f.id}><td data-label="Contract">{f.market.title}</td><td data-label="Version">v{f.version}</td><td data-label="Probability">{f.probabilityBp / 100}%</td><td data-label="Method">{f.method}</td><td data-label="Published">{new Date(f.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC</td></tr>)}</tbody></table>
        <p className="mt-2 text-xs text-muted">Published versions are permanent. A revision is a new version; after trading closes no new versions are accepted.</p>
      </section>
    </Workspace>
  );
}
