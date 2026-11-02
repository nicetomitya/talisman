"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

export function PayerActions({ externalId, back }: { externalId: string; back: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [res, setRes] = useState<string | null>(null);
  const go = async (outcome: string) => {
    setBusy(true); setError(null);
    const r = await api("/api/demo/pay", { body: { externalId, outcome } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setRes(r.data.status);
    router.refresh();
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button className="btn btn-primary" disabled={busy} onClick={() => go("success")}>Оплатить (успешно)</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => go("fail")}>Отказ банка</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => go("lost_webhook")}>Успех, но уведомление потеряно</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => go("unknown")}>Неизвестный результат</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => go("cancel")}>Отменить оплату</button>
      </div>
      {res && <p role="status" className="text-sm">Результат у провайдера: <strong>{res}</strong>. <a href={back}>Вернуться в кабинет</a></p>}
      <ErrorBox error={error} />
    </div>
  );
}

export function DemoAction({ action, body, label, variant = "secondary", confirm }: { action: string; body?: any; label: string; variant?: string; confirm?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [out, setOut] = useState<string | null>(null);
  return (
    <div>
      <button className={`btn btn-${variant}`} disabled={busy} onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true); setError(null); setOut(null);
        const r = await api(`/api/demo/${action}`, { body: body ?? {} });
        setBusy(false);
        if (!r.ok) return setError(r.error);
        setOut(JSON.stringify(r.data).slice(0, 300));
        if (action === "reset") { window.location.href = "/login"; return; }
        router.refresh();
      }}>{busy ? "…" : label}</button>
      {out && <p className="mt-1 break-all text-xs text-muted">✓ {out}</p>}
      <ErrorBox error={error} />
    </div>
  );
}
