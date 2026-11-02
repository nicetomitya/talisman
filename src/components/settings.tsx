"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

export function ConsentToggle({ purpose, title, text, granted, required, version }: { purpose: string; title: string; text: string; granted: boolean; required: boolean; version: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  return (
    <li className="border-b border-line py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="font-medium">{title} <span className="text-xs text-muted">· {version}</span></p><p className="text-sm text-muted">{text}</p></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={granted} disabled={busy} onChange={async (e) => {
          const want = e.target.checked;
          if (!want && required && !window.confirm("Это обязательное согласие. После отзыва новые заявки создать нельзя, а записи, которые нужно хранить по закону и для исполнения договоров, сохранятся. Продолжить?")) return;
          setBusy(true); setError(null);
          const r = await api("/api/consents", { body: { purpose, granted: want } });
          setBusy(false);
          if (!r.ok) return setError(r.error);
          if (purpose === "COOKIES_ANALYTICS") document.cookie = `tcookie=${want ? "analytics" : "necessary"}; path=/; max-age=${365 * 86400}; samesite=lax`;
          if (!want && required) setWarn("Согласие отозвано. Часть данных хранится по закону.");
          router.refresh();
        }} />{granted ? "Дано" : "Не дано"}</label>
      </div>
      {warn && <p className="mt-1 text-xs text-warn">{warn}</p>}
      <ErrorBox error={error} />
    </li>
  );
}

export function SessionRevoke({ id }: { id: string }) {
  const router = useRouter();
  return <button className="btn btn-secondary !min-h-0 !py-1" onClick={async () => { await api("/api/auth/revoke-session", { body: { sessionId: id } }); router.refresh(); }}>Завершить</button>;
}

export function TotpSetup() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div className="space-y-2">
      {!data ? <button className="btn btn-secondary" onClick={async () => { const r = await api("/api/auth/totp-setup", { body: {} }); if (!r.ok) return setError(r.error); setData(r.data); }}>Настроить второй фактор</button> : (
        <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const r = await api("/api/auth/totp-confirm", { body: { code: String(fd.get("code")) } }); if (!r.ok) return setError(r.error); router.refresh(); }}>
          <p className="text-sm">Добавьте ключ в приложение-аутентификатор: <code className="break-all">{data.secret}</code></p>
          <label htmlFor="tc" className="block text-sm font-medium">Код из приложения</label><input id="tc" name="code" className="field max-w-[10rem]" inputMode="numeric" />
          <button className="btn btn-primary">Подтвердить</button>
        </form>)}
      <ErrorBox error={error} />
    </div>
  );
}

export function StepUp() {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setError(null); const r = await api("/api/auth/stepup", { body: { code: String(fd.get("code")) } }); if (!r.ok) return setError(r.error); router.refresh(); }}>
      <div><label htmlFor="su" className="mb-1 block text-sm font-medium">Код второго фактора для подтверждения действий</label><input id="su" name="code" className="field max-w-[10rem]" inputMode="numeric" autoComplete="one-time-code" /></div>
      <button className="btn btn-primary">Подтвердить</button>
      <ErrorBox error={error} />
    </form>
  );
}
