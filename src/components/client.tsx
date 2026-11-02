"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api, newKey, type ApiError } from "@/lib/client";

/** Перенаправление после действия: шаблон вида "/c/claims/{claimId}" (функции нельзя передать из серверного компонента). */
function fillRedirect(t: string | undefined, d: any) { if (!t) return null; const whole = t.match(/^\{(\w+)\}$/); if (whole) { const v = String(d?.[whole[1]] ?? ""); return v.startsWith("/") && !v.startsWith("//") ? v : null; } return t.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(d?.[k] ?? ""))); }

export function ErrorBox({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="mt-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
      <p className="font-semibold">✕ {error.message}</p>
      {error.nextAction && <p className="mt-0.5">Что сделать: {error.nextAction}</p>}
      {error.details?.fields?.length > 0 && <ul className="mt-1 list-disc pl-5">{error.details.fields.map((f: any, i: number) => <li key={i}>{f.path ? `${f.path}: ` : ""}{f.message}</li>)}</ul>}
      {error.correlationId && <p className="mt-1 text-xs opacity-80">Код для поддержки: {error.correlationId}</p>}
    </div>
  );
}

/** Кнопка серверного действия: блокируется на время запроса (повторное нажатие не создаёт дубль), показывает ошибку и обновляет снимок. */
export function Action({ url, body, label, variant = "secondary", confirm, idempotent, redirect, onDone, method = "POST", successText }: {
  url: string; body?: any; label: ReactNode; variant?: "primary" | "secondary" | "danger"; confirm?: string; idempotent?: boolean; redirect?: string; onDone?: (d: any) => void; method?: string; successText?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const key = useRef<string>(newKey());
  return (
    <div className="inline-block">
      <button type="button" className={`btn btn-${variant}`} disabled={busy} aria-busy={busy} onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true); setError(null); setOk(null);
        const r = await api(url, { method, body: idempotent ? { ...(body ?? {}), idempotency_key: key.current } : body ?? {} });
        setBusy(false);
        if (!r.ok) { setError(r.error); return; }
        key.current = newKey();
        if (successText) setOk(successText);
        onDone?.(r.data);
        const to = fillRedirect(redirect, r.data);
        if (to) router.push(to); else router.refresh();
      }}>{busy ? "Выполняется…" : label}</button>
      {ok && <p role="status" className="mt-1 text-sm text-ok">✓ {ok}</p>}
      <ErrorBox error={error} />
    </div>
  );
}

export type FieldDef = { name: string; label: string; type?: "text" | "number" | "email" | "password" | "date" | "textarea" | "select" | "checkbox" | "datetime-local"; options?: { value: string; label: string }[]; required?: boolean; defaultValue?: any; hint?: string; min?: number; max?: number; step?: string; autoComplete?: string };

/** Простая форма с подписями, подсказками и ошибками у полей. */
export function ApiForm({ url, fields, submit, extra, redirect, transform, idempotent, successText, method = "POST", resetOnSuccess, transformEmpty }: {
  url: string; fields: FieldDef[]; submit: string; extra?: Record<string, any>; redirect?: string; transform?: (v: Record<string, any>) => any; idempotent?: boolean; successText?: string; method?: string; resetOnSuccess?: boolean; transformEmpty?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const key = useRef(newKey());
  const fieldErr = (n: string) => error?.details?.fields?.find((f: any) => f.path === n)?.message;
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      const v: Record<string, any> = {};
      for (const f of fields) {
        if (f.type === "checkbox") v[f.name] = fd.get(f.name) === "on";
        else if (f.type === "number") { const s = String(fd.get(f.name) ?? ""); v[f.name] = s === "" ? undefined : Number(s); }
        else { const s = String(fd.get(f.name) ?? ""); v[f.name] = s === "" && !f.required && !transformEmpty ? undefined : s; }
      }
      setBusy(true); setError(null); setOk(null);
      let body = { ...(extra ?? {}), ...(transform ? transform(v) : v) };
      if (idempotent) body = { ...body, idempotency_key: key.current };
      const r = await api(url, { method, body });
      setBusy(false);
      if (!r.ok) { setError(r.error); return; }
      key.current = newKey();
      if (successText) setOk(successText);
      if (resetOnSuccess) form.reset();
      const to = fillRedirect(redirect, r.data);
      if (to) router.push(to); else router.refresh();
    }}>
      {fields.map((f) => {
        const id = `f-${url.replace(/\W/g, "")}-${f.name}`;
        const fe = fieldErr(f.name);
        const common = { id, name: f.name, required: f.required, "aria-invalid": fe ? true : undefined, "aria-describedby": fe ? `${id}-err` : f.hint ? `${id}-hint` : undefined } as any;
        return (
          <div key={f.name}>
            {f.type === "checkbox" ? (
              <label htmlFor={id} className="flex items-start gap-2 text-sm"><input type="checkbox" {...common} defaultChecked={!!f.defaultValue} className="mt-1 h-4 w-4" /><span>{f.label}</span></label>
            ) : (
              <>
                <label htmlFor={id} className="mb-1 block text-sm font-medium">{f.label}{f.required && <span className="text-bad"> *</span>}</label>
                {f.type === "textarea" ? <textarea {...common} defaultValue={f.defaultValue} rows={4} className="field" /> :
                  f.type === "select" ? <select {...common} defaultValue={f.defaultValue} className="field">{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> :
                    <input {...common} type={f.type ?? "text"} defaultValue={f.defaultValue} min={f.min} max={f.max} step={f.step} autoComplete={f.autoComplete} className="field" />}
              </>
            )}
            {f.hint && !fe && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{f.hint}</p>}
            {fe && <p id={`${id}-err`} className="mt-1 text-xs text-bad">✕ {fe}</p>}
          </div>
        );
      })}
      <div><button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? "Отправка…" : submit}</button></div>
      {ok && <p role="status" className="text-sm text-ok">✓ {ok}</p>}
      <ErrorBox error={error} />
    </form>
  );
}

/** Запасной опрос снимка раз в 4 секунды (P0). Пауза, когда вкладка скрыта. */
export function AutoRefresh({ ms = 4000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}

/** Таймер считается от серверного времени: перезагрузка страницы его не сбрасывает. */
export function Countdown({ deadline, serverNow, label }: { deadline: string; serverNow: string; label: string }) {
  const offset = useRef(new Date(serverNow).getTime() - Date.now());
  const [left, setLeft] = useState(() => new Date(deadline).getTime() - new Date(serverNow).getTime());
  useEffect(() => {
    offset.current = new Date(serverNow).getTime() - Date.now();
    const t = setInterval(() => setLeft(new Date(deadline).getTime() - (Date.now() + offset.current)), 1000);
    return () => clearInterval(t);
  }, [deadline, serverNow]);
  const s = Math.max(0, Math.floor(left / 1000));
  const txt = s >= 3600 ? `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин` : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return <span className="num" aria-live="off">{label}: {s > 0 ? txt : "время истекло"}</span>;
}

export function OrgSwitcher({ orgs, current }: { orgs: { id: string; name: string; role: string }[]; current?: string }) {
  const router = useRouter();
  if (orgs.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm"><span className="sr-only">Организация</span>
      <select className="field !w-auto !py-1" value={current} onChange={async (e) => { const r = await api("/api/auth/switch-org", { body: { orgId: e.target.value } }); if (r.ok) router.push("/go"); }}>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}
      </select>
    </label>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return <button className="btn btn-secondary !min-h-0 !py-1" onClick={async () => { await api("/api/auth/logout", { body: {} }); router.push("/login"); router.refresh(); }}>Выйти</button>;
}

/** Cookie-настройки с реальным эффектом: необязательная аналитика пишется только при согласии (AC28). */
export function CookieBanner({ loggedIn }: { loggedIn: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!document.cookie.includes("tcookie=")) setShown(true); }, []);
  const choose = async (analytics: boolean) => {
    document.cookie = `tcookie=${analytics ? "analytics" : "necessary"}; path=/; max-age=${365 * 86400}; samesite=lax`;
    if (loggedIn) await api("/api/consents", { body: { purpose: "COOKIES_ANALYTICS", granted: analytics } });
    setShown(false);
  };
  if (!shown) return null;
  return (
    <div role="region" aria-label="Настройки cookie" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white p-4 shadow-lg">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">Мы используем обязательные cookie (сессия, защита от CSRF). Необязательная аналитика просмотров включается только с вашего согласия. <a href="/legal#cookies">Подробнее</a></p>
        <div className="flex gap-2"><button className="btn btn-secondary" onClick={() => choose(false)}>Только обязательные</button><button className="btn btn-primary" onClick={() => choose(true)}>Разрешить аналитику</button></div>
      </div>
    </div>
  );
}

export function PageView() {
  const path = usePathname();
  useEffect(() => { if (document.cookie.includes("tcookie=analytics")) api("/api/analytics", { body: { name: "page_view", path } }); }, [path]);
  return null;
}

/** Скачивание через короткоживущую подписанную ссылку: права проверяются при выдаче ссылки и при скачивании. */
export function DocLink({ id, title, inline }: { id: string; title: string; inline?: boolean }) {
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <span>
      <button type="button" className="text-left text-accent underline" onClick={async () => {
        setError(null);
        const r = await api(`/api/documents/${id}/link`);
        if (!r.ok) return setError(r.error);
        window.open(r.data.url + (inline ? "&inline=1" : ""), "_blank", "noopener");
      }}>{title}</button>
      <ErrorBox error={error} />
    </span>
  );
}

/** Ввод значения с отправкой (код подтверждения, сообщение и т.п.). */
export function InlineInput({ url, name, label, submit, pattern, inputMode, extra, autoComplete, textarea, placeholder }: { url: string; name: string; label: string; submit: string; pattern?: string; inputMode?: "numeric" | "text"; extra?: Record<string, any>; autoComplete?: string; textarea?: boolean; placeholder?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form);
      setBusy(true); setError(null);
      const r = await api(url, { body: { ...(extra ?? {}), [name]: String(fd.get(name) ?? "") } });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      form.reset(); router.refresh();
    }}>
      <label htmlFor={`ii-${name}`} className="block text-sm font-medium">{label}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        {textarea ? <textarea id={`ii-${name}`} name={name} rows={2} className="field" placeholder={placeholder} required /> : <input id={`ii-${name}`} name={name} className="field sm:max-w-xs" inputMode={inputMode} pattern={pattern} autoComplete={autoComplete} placeholder={placeholder} required />}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Отправка…" : submit}</button>
      </div>
      <ErrorBox error={error} />
    </form>
  );
}

export function PayButton({ checkoutId, label }: { checkoutId: string; label: string }) {
  const router = useRouter();
  const key = useRef(newKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        const r = await api(`/api/checkouts/${checkoutId}/pay`, { body: { idempotency_key: key.current } });
        setBusy(false);
        if (!r.ok) { setError(r.error); router.refresh(); return; }
        router.push(r.data.confirmationUrl);
      }}>{busy ? "Создаём оплату…" : label}</button>
      <ErrorBox error={error} />
    </div>
  );
}

export function CodeForm({ checkoutId }: { checkoutId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget);
      setBusy(true); setError(null); setMsg(null);
      const r = await api(`/api/checkouts/${checkoutId}/verify`, { body: { code: String(fd.get("code") ?? "").trim() } });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      if (r.data.ok === false) { setMsg(r.data.reason); router.refresh(); return; }
      router.refresh();
    }}>
      <label htmlFor="otp" className="block text-sm font-medium">Код подтверждения из демопочты</label>
      <div className="flex flex-col gap-2 sm:flex-row"><input id="otp" name="code" className="field sm:max-w-[10rem]" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required aria-describedby="otp-h" />
        <button className="btn btn-primary" disabled={busy}>{busy ? "Проверяем…" : "Подтвердить"}</button></div>
      <p id="otp-h" className="text-xs text-muted">6 цифр, действует 10 минут, не больше 5 попыток. Демонстрационный код не является электронной подписью.</p>
      {msg && <p role="alert" className="text-sm text-bad">✕ {msg}</p>}
      <ErrorBox error={error} />
    </form>
  );
}

export function FileUpload({ url, label = "Приложить файл" }: { url: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const id = `up-${url.replace(/\W/g, "")}`;
  return (
    <div>
      <label htmlFor={id} className="btn btn-secondary cursor-pointer">{busy ? "Загрузка…" : label}</label>
      <input id={id} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={busy} onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        const fd = new FormData(); fd.append("file", f);
        setBusy(true); setError(null);
        const r = await api(url, { form: fd });
        setBusy(false); e.target.value = "";
        if (!r.ok) return setError(r.error);
        router.refresh();
      }} />
      <p className="mt-1 text-xs text-muted">PDF, JPEG или PNG до 15 МБ. Файл проверяется антивирусом.</p>
      <ErrorBox error={error} />
    </div>
  );
}
