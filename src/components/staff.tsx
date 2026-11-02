"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

const A: Record<string, string> = { START_REVIEW: "Взять в работу", REQUEST_INFO: "Запросить сведения", PREPARE_APPROVE: "Подготовить одобрение", PREPARE_REJECT: "Подготовить отказ", APPROVE: "Одобрить (страховщик)", REJECT: "Отказать (страховщик)", CLOSE: "Закрыть", REOPEN: "Переоткрыть" };

/** Действия сотрудника по обращению. Сервер проверяет роль и допустимость перехода; кнопки — только подсказка. */
export function ClaimStaffActions({ claimId, actions, needAmount }: { claimId: string; actions: string[]; needAmount: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = async (action: string) => {
    setBusy(true); setError(null);
    const r = await api(`/api/claims/${claimId}/staff`, { body: { action, ...(note ? { note } : {}), ...(action === "APPROVE" && amount ? { amountKop: Math.round(Number(amount) * 100) } : {}) } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setNote(""); router.refresh();
  };
  return (
    <div className="space-y-2">
      <label htmlFor={`sn-${claimId}`} className="block text-sm font-medium">Комментарий или объяснение решения</label>
      <textarea id={`sn-${claimId}`} rows={2} className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      {needAmount && actions.includes("APPROVE") && <div><label htmlFor={`sa-${claimId}`} className="mb-1 block text-sm font-medium">Сумма выплаты, ₽</label><input id={`sa-${claimId}`} className="field max-w-xs" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /><p className="mt-1 text-xs text-muted">Не больше остатка лимита покрытия: проверяется сервером и ограничением БД.</p></div>}
      <div className="flex flex-wrap gap-2">{actions.map((a) => <button key={a} className={`btn ${a === "APPROVE" ? "btn-primary" : a === "REJECT" || a === "PREPARE_REJECT" ? "btn-danger" : "btn-secondary"}`} disabled={busy} onClick={() => run(a)}>{A[a] ?? a}</button>)}</div>
      <ErrorBox error={error} />
    </div>
  );
}
