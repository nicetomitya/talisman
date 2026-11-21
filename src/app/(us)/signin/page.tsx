import { pageCtx } from "@/server/page";
import { isDemo } from "@/server/config";
import { UsShell } from "@/components/ev/shell";
import { DemoSignIn, SignInForm } from "@/components/ev/client";

export const metadata = { title: "Sign in" };
const DEMO_US = [
  { email: "maya@consumer.test", title: "Maya Chen · consumer (regatta, wedding, portfolio)" },
  { email: "olivia@consumer.test", title: "Olivia Brooks · new consumer, empty workspace" },
  { email: "sam@expert.test", title: "Sam Rivera · approved expert" },
  { email: "jordan@builder.test", title: "Jordan Blake · builder employee (conflict case)" },
  { email: "buyer1@homebuyer.test", title: "Alex Park · home buyer (cluster risk)" },
  { email: "admin1@talisman.test", title: "Compliance admin" },
];

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const ctx = await pageCtx().catch(() => null);
  const { next } = await searchParams;
  return (
    <UsShell ctx={ctx}>
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <section className="card"><h1 className="mb-4 text-xl font-semibold">Sign in</h1><SignInForm next={next} /><p className="mt-3 text-xs text-muted">Registering with Talisman never makes you eligible for real-money trading. That would be decided by a regulated partner.</p></section>
        {isDemo() && <section className="card"><h2 className="font-semibold">Demo accounts</h2><p className="mb-3 mt-1 text-sm text-muted">Demo mode only. Fictional people on .test addresses.</p><DemoSignIn accounts={DEMO_US} next={next} /></section>}
      </div>
    </UsShell>
  );
}
