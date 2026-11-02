"use client";
/** Клиентский вызов API: CSRF-заголовок, ключ идемпотентности, единый формат ошибок. */
export type ApiError = { code: string; message: string; nextAction?: string | null; details?: any; correlationId?: string };

function csrf() {
  const m = document.cookie.match(/(?:^|; )tcsrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
export function newKey() { return (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36); }

export async function api<T = any>(url: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<{ ok: true; data: T } | { ok: false; error: ApiError; status: number }> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
      headers: { "x-csrf-token": csrf(), ...(opts.form ? {} : { "content-type": "application/json" }) },
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      credentials: "same-origin",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: json.error ?? { code: "UNKNOWN", message: `Ошибка ${res.status}` } };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: { code: "NETWORK", message: "Нет соединения с сервером. Повторите — повторное нажатие не создаст дубль." } };
  }
}
