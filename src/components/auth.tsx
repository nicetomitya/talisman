"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setBusy(true); setError(null);
      const r = await api("/api/auth/login", { body: { email: fd.get("email"), password: fd.get("password"), ...(needTotp ? { totp: fd.get("totp") } : {}) } });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      if (r.data.needTotp) return setNeedTotp(true);
      const next = sp.get("next");
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : "/go");
      router.refresh();
    }}>
      <div><label htmlFor="email" className="mb-1 block text-sm font-medium">Email</label><input id="email" name="email" type="email" autoComplete="username" required className="field" /></div>
      <div><label htmlFor="password" className="mb-1 block text-sm font-medium">Пароль</label><input id="password" name="password" type="password" autoComplete="current-password" required className="field" /></div>
      {needTotp && <div><label htmlFor="totp" className="mb-1 block text-sm font-medium">Код из приложения-аутентификатора</label><input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" className="field" autoFocus /><p className="mt-1 text-xs text-muted">Для этой роли нужен второй фактор (TOTP). Демо-секрет указан в README.</p></div>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Вход…" : "Войти"}</button>
      <ErrorBox error={error} />
    </form>
  );
}

export function DemoSwitch({ accounts }: { accounts: { email: string; title: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {accounts.map((a) => <li key={a.email}><button className="btn btn-secondary w-full !justify-start text-left" onClick={async () => { setError(null); const r = await api("/api/auth/demo-switch", { body: { email: a.email } }); if (!r.ok) return setError(r.error); router.push("/go"); router.refresh(); }}><span><span className="block text-sm font-medium">{a.title}</span><span className="block text-xs text-muted">{a.email}</span></span></button></li>)}
      </ul>
      <ErrorBox error={error} />
    </div>
  );
}

export function TokenAction({ url, label, extraPassword }: { url: string; label: string; extraPassword?: boolean }) {
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<ApiError | null>(null);
  if (!token) return <p className="text-sm text-bad">В ссылке нет токена. Откройте ссылку из письма целиком.</p>;
  if (state === "done") return <p role="status" className="text-ok">✓ Готово. <a href="/login">Войти</a></p>;
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      setState("busy"); setError(null);
      const r = await api(url, { body: { token, ...(extraPassword ? { password: fd.get("password") } : {}) } });
      if (!r.ok) { setState("idle"); return setError(r.error); }
      setState("done");
    }}>
      {extraPassword && <div><label htmlFor="np" className="mb-1 block text-sm font-medium">Новый пароль</label><input id="np" name="password" type="password" autoComplete="new-password" className="field" /><p className="mt-1 text-xs text-muted">Не короче 10 символов, буквы и цифры.</p></div>}
      <button className="btn btn-primary" disabled={state === "busy"}>{label}</button>
      <ErrorBox error={error} />
    </form>
  );
}

export function Mailbox() {
  const [mails, setMails] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div>
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={async (e) => {
        e.preventDefault(); const fd = new FormData(e.currentTarget); setError(null);
        const r = await api("/api/demo/mailbox", { body: { email: fd.get("email"), password: fd.get("password") } });
        if (!r.ok) return setError(r.error); setMails(r.data.mails);
      }}>
        <label className="sr-only" htmlFor="mb-e">Email</label><input id="mb-e" name="email" type="email" placeholder="email@client.test" className="field" required />
        <label className="sr-only" htmlFor="mb-p">Пароль</label><input id="mb-p" name="password" type="password" placeholder="Пароль" className="field" required />
        <button className="btn btn-secondary">Открыть ящик</button>
      </form>
      <ErrorBox error={error} />
      {mails && (mails.length === 0 ? <p className="mt-3 text-sm text-muted">Писем нет.</p> :
        <ul className="mt-3 space-y-2">{mails.map((m) => <li key={m.id} className="card !p-3"><p className="text-sm font-medium">{m.subject}</p><p className="text-xs text-muted">{new Date(m.createdAt).toLocaleString("ru-RU")} · {m.toEmail}</p><pre className="mt-1 whitespace-pre-wrap break-words text-sm">{linkify(m.body)}</pre></li>)}</ul>)}
    </div>
  );
}
function linkify(s: string) {
  return s.split(/(\/(?:verify|reset)\?token=[\w-]+)/).map((p, i) => p.startsWith("/") ? <a key={i} href={p}>{p}</a> : p);
}
