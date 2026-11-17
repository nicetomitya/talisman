"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type ApiError } from "@/lib/client";
import { looksLikeIncident } from "@/lib/intent";
import { ErrorBox } from "./client";

/** Главный вход кабинета: «Опишите, что хотите застраховать или что произошло». */
export function HomeIntake() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  return (
    <section className="card">
      <form className="space-y-2" onSubmit={async (e) => {
        e.preventDefault();
        const text = String(new FormData(e.currentTarget).get("t") ?? "").trim();
        if (text.length < 5) return setHint("Опишите ситуацию хотя бы парой слов");
        setError(null); setHint(null);
        if (looksLikeIncident(text)) return router.push(`/c/claims/new?text=${encodeURIComponent(text)}`);
        setBusy(true);
        const r = await api("/api/requests", { body: { freeText: text } });
        setBusy(false);
        if (!r.ok) return setError(r.error);
        if (r.data.needProduct) return router.push(`/c/requests/new?text=${encodeURIComponent(text)}`);
        router.push(`/c/requests/${r.data.id}`);
      }}>
        <label htmlFor="intake" className="block text-lg font-semibold">Опишите, что хотите застраховать или что произошло</label>
        <textarea id="intake" name="t" rows={3} className="field" placeholder="Например: «планирую свадьбу на улице, боюсь дождя» или «меня затопили соседи»" />
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? "Разбираю…" : "Разобрать с помощником"}</button>
          <Link href="/c/requests/new" className="btn btn-secondary no-underline">Новая потребность</Link>
          <Link href="/c/claims/new" className="btn btn-secondary no-underline">Страховой случай</Link>
          <Link href="/c/policies" className="btn btn-secondary no-underline">Мои полисы</Link>
        </div>
        <p className="text-xs text-muted">Помощник объясняет и структурирует. Решения о цене, договоре и выплате принимает страховщик.</p>
        {hint && <p role="status" className="text-sm text-warn">! {hint}</p>}
        <ErrorBox error={error} />
      </form>
    </section>
  );
}

type Triage = { category: string | null; candidates: { kind: "PLATFORM" | "EXTERNAL"; id: string; title: string; insurer: string | null; agency: string | null; canCreateClaim: boolean; why: string }[]; firstSteps: string[]; evidence: string[]; deadlines: string; nextStep: string; disclaimer: string };

/** Страховой случай свободным текстом: подходящие полисы, первые шаги, доказательства, создание обращения. */
export function IncidentTriage({ initial }: { initial?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [res, setRes] = useState<Triage | null>(null);
  const [text, setText] = useState(initial ?? "");
  const run = async (t: string) => {
    setBusy(true); setError(null);
    const r = await api<Triage>("/api/cabinet/triage", { body: { text: t } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setRes(r.data);
  };
  return (
    <div className="space-y-4">
      <form className="card space-y-2" onSubmit={(e) => { e.preventDefault(); run(text); }}>
        <label htmlFor="inc" className="block font-semibold">Что произошло?</label>
        <textarea id="inc" rows={3} className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: меня затопили соседи сверху, течёт с потолка" />
        <button className="btn btn-primary" disabled={busy || text.trim().length < 5} aria-busy={busy}>{busy ? "Разбираю…" : "Разобрать ситуацию"}</button>
        <ErrorBox error={error} />
      </form>
      {res && <>
        <section className="card"><h2 className="font-semibold">Сначала безопасность</h2><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{res.firstSteps.map((s, i) => <li key={i}>{s}</li>)}</ol></section>
        <section className="card"><h2 className="font-semibold">Возможно подходящие полисы</h2>
          {res.candidates.length === 0 ? <p className="mt-1 text-sm text-muted">Действующих полисов этого вида не найдено. <Link href="/c/policies">Добавить полис, оформленный вне платформы</Link></p> :
            <ul className="mt-2 space-y-3">{res.candidates.map((c) => <li key={c.id} className="rounded-md border border-line p-3 text-sm">
              <p className="font-medium">{c.title}</p>
              <p className="text-muted">{[c.insurer && `Страховщик: ${c.insurer}`, c.agency && `агентство: ${c.agency}`].filter(Boolean).join(", ")}</p>
              <p className="mt-1">Почему показан: {c.why}</p>
              {c.canCreateClaim && <ClaimStart policyId={c.id} description={text} onDone={(id) => router.push(`/c/claims/${id}`)} />}
              {c.kind === "EXTERNAL" && <p className="mt-1 text-muted">Полис оформлен вне платформы: сообщите о случае страховщику по контактам из договора.</p>}
            </li>)}</ul>}
          <p className="mt-2 text-sm">{res.nextStep}</p>
        </section>
        {res.evidence.length > 0 && <section className="card"><h2 className="font-semibold">Что подготовить</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{res.evidence.map((s, i) => <li key={i}>{s}</li>)}</ul><p className="mt-2 text-sm">{res.deadlines}</p></section>}
        <p role="note" className="rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn">! {res.disclaimer}</p>
      </>}
    </div>
  );
}

function ClaimStart({ policyId, description, onDone }: { policyId: string; description: string; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault();
      const eventDate = String(new FormData(e.currentTarget).get("d"));
      setBusy(true); setError(null);
      const r = await api(`/api/policies/${policyId}/claim`, { body: { eventDate, description: description.length >= 10 ? description : `${description} (описание дополню)`, answers: {} } });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      onDone(r.data.claimId);
    }}>
      <div><label htmlFor={`d-${policyId}`} className="mb-1 block text-xs font-medium">Дата события</label><input id={`d-${policyId}`} name="d" type="date" defaultValue={today} className="field" required /></div>
      <button className="btn btn-primary" disabled={busy}>Создать обращение по этому полису</button>
      <ErrorBox error={error} />
    </form>
  );
}
