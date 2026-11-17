"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

import { BASES, CHANNELS } from "@/lib/crmconst";

function CopyBox({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <label className="mb-1 block text-sm font-medium" htmlFor={`copy-${label}`}>{label}</label>
      <textarea id={`copy-${label}`} readOnly value={text} rows={Math.min(10, text.split("\n").length + 2)} className="field font-mono text-xs" />
      <button type="button" className="btn btn-secondary mt-1" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }}>Скопировать</button>
      {copied && <span role="status" className="ml-2 text-sm text-ok">✓ Скопировано</span>}
    </div>
  );
}

/** Импорт CSV: файл читается в браузере как текст и отправляется на сервер; ничего не рассылается контактам. */
export function CrmImport({ members }: { members: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [res, setRes] = useState<any>(null);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const file = fd.get("file") as File | null;
      const pasted = String(fd.get("csv") ?? "");
      const csv = file && file.size > 0 ? await file.text() : pasted;
      setBusy(true); setError(null); setRes(null);
      const r = await api("/api/crm/import", { body: { fileName: file && file.size > 0 ? file.name : "вставка.csv", csv, legalBasis: fd.get("legalBasis"), confirmBasis: fd.get("confirmBasis") === "on" ? true : false, responsibleUserId: fd.get("responsible") || null } });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      setRes(r.data); router.refresh();
    }}>
      <div><label htmlFor="crm-file" className="mb-1 block text-sm font-medium">Файл CSV (UTF-8, разделитель «;» или «,»)</label><input id="crm-file" name="file" type="file" accept=".csv,text/csv" className="field" aria-describedby="crm-file-hint" />
        <p id="crm-file-hint" className="mt-1 text-xs text-muted">Колонки: Имя, Телефон, Email, Вид, Страховщик, Номер полиса, Объект, Дата окончания, Премия, Примечание, Ответственный (email сотрудника). Обязательны имя и телефон или email. XLSX сохраните как CSV.</p></div>
      <div><label htmlFor="crm-csv" className="mb-1 block text-sm font-medium">…или вставьте строки</label><textarea id="crm-csv" name="csv" rows={4} className="field font-mono text-xs" placeholder={"Имя;Телефон;Email;Вид;Страховщик;Дата окончания\nИрина Соколова;+7 900 123-45-67;;КАСКО;Северный щит;15.03.2027"} /></div>
      <div><label htmlFor="crm-basis" className="mb-1 block text-sm font-medium">Основание обработки данных <span className="text-bad">*</span></label><select id="crm-basis" name="legalBasis" className="field">{BASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      {members.length > 1 && <div><label htmlFor="crm-resp" className="mb-1 block text-sm font-medium">Ответственный по умолчанию</label><select id="crm-resp" name="responsible" className="field"><option value="">Не назначен</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>}
      <label htmlFor="crm-confirm" className="flex items-start gap-2 text-sm"><input id="crm-confirm" name="confirmBasis" type="checkbox" className="mt-1 h-4 w-4" /><span>Подтверждаю, что у агентства есть указанное основание для обработки этих данных. Импорт не создаёт аккаунтов и ничего не отправляет контактам.</span></label>
      <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? "Загрузка…" : "Импортировать"}</button>
      <ErrorBox error={error} />
      {res && <div role="status" className="rounded-md border border-ok/30 bg-ok-soft p-3 text-sm">✓ Строк: {res.total}. Создано карточек: {res.created}, дублей пропущено: {res.duplicates}, отклонено: {res.rejected}. Полисов: {res.policies}, задач на продление: {res.tasks}.
        {res.errors?.length > 0 && <ul className="mt-1 list-disc pl-5">{res.errors.slice(0, 10).map((x: any, i: number) => <li key={i}>Строка {x.row}: {x.message}</li>)}</ul>}</div>}
    </form>
  );
}

/** Приглашение: персональная ссылка и текст, который агент отправляет сам. */
export function CrmInvite({ contactId, state }: { contactId: string; state: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [inv, setInv] = useState<{ link: string; text: string; expiresAt: string } | null>(null);
  const canPrepare = ["NOT_INVITED", "PREPARED", "SENT", "REVOKED"].includes(state);
  const canMarkSent = ["PREPARED", "SENT"].includes(state);
  return (
    <div className="space-y-3">
      {canPrepare && <button type="button" className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        const r = await api("/api/crm/invite-prepare", { body: { contactId } });
        setBusy(false);
        if (!r.ok) return setError(r.error);
        setInv(r.data); router.refresh();
      }}>{state === "NOT_INVITED" ? "Подготовить приглашение" : state === "REVOKED" ? "Подготовить новое приглашение" : "Подготовить новую ссылку"}</button>}
      {state !== "NOT_INVITED" && state !== "REVOKED" && !inv && canPrepare && <p className="text-xs text-muted">Ссылка показывается один раз. Новая ссылка отменяет прежнюю.</p>}
      {inv && <><CopyBox label="Текст приглашения" text={inv.text} /><p className="text-xs text-muted">Отправьте сами в удобном клиенту канале. Платформа ничего не отправляет автоматически.</p></>}
      {canMarkSent && <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
        e.preventDefault(); const fd = new FormData(e.currentTarget);
        setBusy(true); setError(null);
        const r = await api("/api/crm/invite-sent", { body: { contactId, channel: fd.get("channel") } });
        setBusy(false);
        if (!r.ok) return setError(r.error);
        router.refresh();
      }}><div><label htmlFor={`ch-${contactId}`} className="mb-1 block text-sm font-medium">Отправил вручную через</label><select id={`ch-${contactId}`} name="channel" className="field">{CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div><button className="btn btn-secondary" disabled={busy}>Отметить отправленным</button></form>}
      <ErrorBox error={error} />
    </div>
  );
}

/** Подготовка текста помощником: агент копирует и отправляет сам. */
export function CrmDraft({ contactId }: { contactId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [text, setText] = useState<string | null>(null);
  const run = async (purpose: string) => {
    setBusy(true); setError(null);
    const r = await api("/api/crm/draft", { body: { contactId, purpose } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setText(r.data.text);
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run("RENEWAL")}>Текст о продлении</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run("CHECKIN")}>Текст «как дела»</button></div>
      {text && <CopyBox label="Подготовленный текст" text={text} />}
      <ErrorBox error={error} />
    </div>
  );
}

