"use client";
import { useState } from "react";
import { api, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

type Hint = { level: "BLOCK" | "CHECK" | "TIP"; key?: string; label?: string; text: string };
const LV: Record<Hint["level"], string> = { BLOCK: "Нужно исправить", CHECK: "Проверьте", TIP: "Совет" };

/** Проверка заявки помощником перед публикацией: только подсказки, данные не меняет. */
export function RequestReview({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [res, setRes] = useState<{ ready: boolean; hints: Hint[]; note: string } | null>(null);
  return (
    <section aria-labelledby="ai-review" className="mb-4 rounded-md border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 id="ai-review" className="text-sm font-semibold">Помощник: проверка заявки</h2>
          <p className="text-xs text-muted">Сверит заполненность и правдоподобие, чтобы агентства рассчитали ровно то, что вам нужно. Ничего не меняет сам.</p></div>
        <button type="button" className="btn btn-secondary" disabled={busy} aria-busy={busy} onClick={async () => {
          setBusy(true); setError(null);
          const r = await api(`/api/requests/${requestId}/review`, { method: "GET" });
          setBusy(false);
          if (!r.ok) setError(r.error); else setRes(r.data);
        }}>{busy ? "Проверяю…" : "Проверить заявку"}</button>
      </div>
      <ErrorBox error={error} />
      {res && <div role="status" className="mt-2 text-sm">
        <p className={res.ready ? "text-ok" : "text-bad"}>{res.ready ? (res.hints.length ? "✓ Заявку можно отправлять. Есть что проверить:" : "✓ Заявка заполнена полностью, замечаний нет.") : "✕ Перед отправкой нужно исправить:"}</p>
        {res.hints.length > 0 && <ul className="mt-1 space-y-1">{res.hints.map((h, i) => <li key={i}><span className="font-semibold">{LV[h.level]}</span>{h.label ? ` · ${h.label}` : ""}: {h.text}</li>)}</ul>}
        <p className="mt-2 text-xs text-muted">{res.note}</p>
      </div>}
    </section>
  );
}
