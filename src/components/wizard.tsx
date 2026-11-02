"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

type F = { key: string; label: string; type: string; required: boolean; keyField?: boolean; essential?: boolean; visibility: string; purpose: string; options?: { value: string; label: string }[]; min?: number; max?: number; hint?: string; step?: string; pattern?: string };
type Doc = { id: string; title: string; status: string; scanNote: string | null; suggestions: { key: string; value: any; confidence: number; source: string }[]; untrusted: string[]; note: string | null };
const VIS: Record<string, string> = { PUBLIC: "Видно агентствам до выбора (без ваших контактов)", AFTER_SELECTION: "Только выбранному агентству и страховщику", PRIVATE: "Только страховщику при оформлении" };
const CONF: Record<string, [string, string]> = { CONFIRMED: ["✓ Подтверждено вами", "text-ok"], SUGGESTED: ["Распознано, проверьте и подтвердите", "text-warn"], LOW_CONFIDENCE: ["Низкая уверенность распознавания: проверьте внимательно", "text-bad"], UNCONFIRMED: ["Не подтверждено", "text-warn"], NEEDS_RECHECK: ["Из сохранённого объекта: перепроверьте", "text-warn"] };

export function RequestWizard({ req, sections, docs, initialIssues, published }: {
  req: { id: string; version: number; status: string; data: Record<string, any>; confirmed: Record<string, any>; kind: string };
  sections: { title: string; fields: F[] }[]; docs: Doc[]; initialIssues: { key: string; message: string }[]; published: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<Record<string, any>>(req.data);
  const [confirmed, setConfirmed] = useState<Record<string, any>>(req.confirmed);
  const [issues, setIssues] = useState(initialIssues);
  const [save, setSave] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const version = useRef(req.version);
  const pending = useRef<Record<string, any>>({});
  const timer = useRef<any>(null);

  async function flush(): Promise<boolean> {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (!Object.keys(patch).length) return true;
    pending.current = {};
    setSave("saving");
    const r = await api(`/api/requests/${req.id}`, { method: "PATCH", body: { data: patch, version: version.current } });
    if (!r.ok) { setSave("error"); setError(r.error); pending.current = { ...patch, ...pending.current }; return false; }
    version.current = r.data.version;
    setConfirmed(r.data.confirmed);
    setIssues((prev) => [...prev.filter((i) => !(i.key in patch)), ...r.data.issues]);
    setSave("saved"); setError(null);
    if (r.data.requiresRepublish) { setNotice(`Вы изменили существенные данные: прежние предложения (${r.data.invalidatedQuotes}) больше не действуют. Опубликуйте новую версию заявки.`); router.refresh(); }
    return true;
  }
  const change = (k: string, v: any) => {
    setData((d) => ({ ...d, [k]: v }));
    pending.current[k] = v;
    setSave("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, []);

  const call = async (url: string, body: any) => {
    if (!(await flush())) return null;
    setBusy(true); setError(null);
    const r = await api(url, { body: { ...body, version: version.current } });
    setBusy(false);
    if (!r.ok) { setError(r.error); if (r.error.details?.fields) setIssues(r.error.details.fields.map((f: any) => ({ key: f.path, message: f.message }))); return null; }
    if (r.data.version) version.current = r.data.version;
    if (r.data.confirmed) setConfirmed(r.data.confirmed);
    if (r.data.data) setData(r.data.data);
    return r.data;
  };
  const keyUnconfirmed = sections.flatMap((s) => s.fields).filter((f) => f.keyField && data[f.key] !== undefined && data[f.key] !== "" && confirmed[f.key]?.status !== "CONFIRMED");
  const issueFor = (k: string) => issues.find((i) => i.key === k)?.message;

  return (
    <div className="space-y-4">
      <p className="text-sm" role="status" aria-live="polite">{save === "saving" ? "Сохраняем…" : save === "saved" ? "✓ Черновик сохранён" : save === "dirty" ? "Есть несохранённые изменения" : save === "error" ? "✕ Не сохранено" : "Черновик сохраняется автоматически"}</p>
      {notice && <div role="alert" className="rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn">{notice}</div>}
      {issues.length > 0 && <div role="alert" className="rounded-md border border-bad/30 bg-bad-soft p-3 text-sm text-bad"><p className="font-semibold">Чтобы опубликовать заявку, исправьте:</p><ul className="mt-1 list-disc pl-5">{issues.map((i, n) => <li key={n}><a href={`#fld-${i.key}`}>{sections.flatMap((s) => s.fields).find((f) => f.key === i.key)?.label ?? i.key}</a>: {i.message}</li>)}</ul></div>}

      <section className="card" aria-labelledby="docs-h">
        <h2 id="docs-h" className="font-semibold">Документы для распознавания</h2>
        <p className="mt-1 text-sm text-muted">PDF, JPEG или PNG до 15 МБ, не больше 10 файлов. Файл сначала проверяется антивирусом. Распознанные значения не подставляются молча: вы проверяете и подтверждаете каждое ключевое поле.</p>
        <Uploader requestId={req.id} onDone={() => router.refresh()} />
        {docs.length > 0 && <ul className="mt-3 space-y-3">{docs.map((d) => (
          <li key={d.id} className="rounded-md border border-line p-3 text-sm">
            <p><strong>{d.title}</strong> · {d.status === "QUARANTINE" ? "проверяется антивирусом…" : d.status === "REJECTED" ? `✕ отклонён: ${d.scanNote}` : "✓ проверен"}</p>
            {d.untrusted.length > 0 && <p className="mt-1 rounded bg-warn-soft p-2 text-warn">! В документе найден текст, похожий на инструкции («{d.untrusted[0].slice(0, 80)}…»). Он проигнорирован: содержимое документов не может менять права, суммы или действия.</p>}
            {d.note && d.status === "CLEAN" && <p className="mt-1 text-muted">{d.note}</p>}
            {d.suggestions.length > 0 && <ul className="mt-2 space-y-1">{d.suggestions.map((s) => {
              const f = sections.flatMap((x) => x.fields).find((x) => x.key === s.key);
              if (!f) return null;
              const applied = String(data[s.key] ?? "") === String(s.value);
              return <li key={s.key} className="flex flex-wrap items-center justify-between gap-2"><span>{f.label}: <strong>{String(s.value)}</strong> <span className={s.confidence < 0.85 ? "text-bad" : "text-muted"}>(уверенность {Math.round(s.confidence * 100)} %{s.confidence < 0.85 ? ", низкая" : ""})</span></span>
                {applied ? <span className="text-xs text-muted">подставлено</span> : <button type="button" className="btn btn-secondary !min-h-0 !py-1" disabled={busy} onClick={async () => { const r = await call(`/api/requests/${req.id}/suggestion`, { documentId: d.id, key: s.key }); if (r) router.refresh(); }}>Подставить</button>}</li>;
            })}</ul>}
          </li>))}</ul>}
      </section>

      {sections.map((s) => (
        <fieldset key={s.title} className="card">
          <legend className="px-1 font-semibold">{s.title}</legend>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {s.fields.map((f) => {
              const id = `fld-${f.key}`; const e = issueFor(f.key); const c = confirmed[f.key]?.status as string | undefined;
              const desc = `${id}-d`;
              return (
                <div key={f.key} className={f.type === "multiselect" || f.type === "textarea" ? "sm:col-span-2" : ""}>
                  {f.type !== "boolean" && f.type !== "multiselect" && <label htmlFor={id} className="mb-1 block text-sm font-medium">{f.label}{f.required && <span className="text-bad" aria-hidden> *</span>}{f.required && <span className="sr-only"> (обязательно)</span>}</label>}
                  <Input f={f} id={id} desc={desc} value={data[f.key]} invalid={!!e} onChange={(v) => change(f.key, v)} />
                  <p id={desc} className="mt-1 text-xs text-muted">{f.hint ? `${f.hint}. ` : ""}Зачем: {f.purpose}. {VIS[f.visibility]}.</p>
                  {f.keyField && data[f.key] !== undefined && data[f.key] !== "" && <p className={`mt-1 text-xs ${CONF[c ?? "UNCONFIRMED"]?.[1]}`}>{CONF[c ?? "UNCONFIRMED"]?.[0]}{c !== "CONFIRMED" && <> · <button type="button" className="underline" disabled={busy} onClick={() => call(`/api/requests/${req.id}/confirm`, { keys: [f.key] })}>Подтвердить</button></>}</p>}
                  {e && <p className="mt-1 text-xs text-bad" role="alert">✕ {e}</p>}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="card space-y-3">
        {keyUnconfirmed.length > 0 && <div><p className="text-sm">Ключевые поля ждут вашего подтверждения: {keyUnconfirmed.map((f) => f.label).join(", ")}.</p><button type="button" className="btn btn-secondary mt-2" disabled={busy} onClick={() => call(`/api/requests/${req.id}/confirm`, { keys: keyUnconfirmed.map((f) => f.key) })}>Я проверил(а) значения, подтвердить все</button></div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={async () => {
            const r = await call(`/api/requests/${req.id}/publish`, {});
            if (!r) return;
            if (r.published === false) { setIssues(r.issues); window.scrollTo({ top: 0, behavior: "smooth" }); router.refresh(); return; }
            router.refresh();
          }}>{busy ? "Выполняется…" : published ? "Опубликовать новую версию" : req.kind === "EVENT" ? "Рассчитать по тарифу" : "Опубликовать заявку"}</button>
          <button type="button" className="btn btn-secondary" onClick={() => flush()}>Сохранить сейчас</button>
        </div>
        <p className="text-xs text-muted">{req.kind === "EVENT" ? "Цена фиксирована утверждённым тарифом страховщика, подбора предложений нет." : "После публикации агентства с полномочиями смогут прислать предложения. Ваши контакты и точные идентификаторы им не видны до выбора."}</p>
        <ErrorBox error={error} />
      </div>
    </div>
  );
}

function Input({ f, id, desc, value, invalid, onChange }: { f: F; id: string; desc: string; value: any; invalid: boolean; onChange: (v: any) => void }) {
  const common = { id, "aria-describedby": desc, "aria-invalid": invalid || undefined, "aria-required": f.required || undefined } as any;
  switch (f.type) {
    case "select": return <select {...common} className="field" value={value ?? ""} onChange={(e) => onChange(e.target.value)}><option value="">— выберите —</option>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
    case "multiselect": return (
      <fieldset aria-describedby={desc}><legend className="mb-1 text-sm font-medium">{f.label}{f.required && <span className="text-bad" aria-hidden> *</span>}</legend>
        <div className="flex flex-wrap gap-3">{f.options!.map((o) => { const arr: string[] = Array.isArray(value) ? value : []; return <label key={o.value} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={arr.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))} />{o.label}</label>; })}</div></fieldset>);
    case "boolean": return <label htmlFor={id} className="flex items-center gap-2 text-sm"><input {...common} type="checkbox" className="h-4 w-4" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{f.label}</label>;
    case "textarea": return <textarea {...common} className="field" rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "number": return <input {...common} className="field" type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step ?? "1"} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
    default: return <input {...common} className="field" type={f.type === "date" ? "date" : f.type === "time" ? "time" : "text"} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

function Uploader({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div className="mt-3">
      <label htmlFor="upl" className="btn btn-secondary cursor-pointer">{busy ? "Загрузка…" : "Загрузить документ"}</label>
      <input id="upl" type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={busy} onChange={async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        const fd = new FormData(); fd.append("file", file);
        setBusy(true); setError(null);
        const r = await api(`/api/requests/${requestId}/upload`, { form: fd });
        setBusy(false); e.target.value = "";
        if (!r.ok) return setError(r.error);
        onDone();
      }} />
      <ErrorBox error={error} />
    </div>
  );
}
