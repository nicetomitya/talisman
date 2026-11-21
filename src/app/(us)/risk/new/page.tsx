import { pageCtx } from "@/server/page";
import { UsShell } from "@/components/ev/shell";
import { RiskIntake } from "@/components/ev/client";

export const metadata = { title: "Describe a risk" };
export default async function NewRisk({ searchParams }: { searchParams: Promise<{ text?: string }> }) {
  const ctx = await pageCtx().catch(() => null);
  const { text } = await searchParams;
  return (
    <UsShell ctx={ctx}>
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Describe a risk</h1>
        <section className="card"><RiskIntake initial={text?.slice(0, 2000) ?? ""} /></section>
        <p className="text-sm text-muted">No account needed to explore. Your draft is kept on this device and moves to your workspace when you sign in.</p>
      </div>
    </UsShell>
  );
}
