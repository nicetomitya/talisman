"use client";
import { useEffect, useRef, useState } from "react";
import { api, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

const ROLE: Record<string, string> = { CLIENT: "Клиент", AGENT: "Агентство", AI: "Помощник (ИИ, демо)", SYSTEM: "Система", SUPPORT: "Поддержка" };

/** Чат: снимок через опрос (4 с), отправка с блокировкой кнопки, ответ помощника — только со ссылками на пункты документов. */
export function Chat({ id, me, allowAssistant }: { id: string; me: string; allowAssistant: boolean }) {
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [offline, setOffline] = useState(false);
  const [maskedNote, setMaskedNote] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const load = async () => {
    const r = await api(`/api/messages/${id}`);
    if (!r.ok) { setOffline(r.status === 0); return; }
    setOffline(false);
    setMsgs((prev) => { if (prev.length !== r.data.messages.length) setTimeout(() => end.current?.scrollIntoView({ block: "nearest" }), 50); return r.data.messages; });
  };
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 4000); return () => clearInterval(t); }, [id]);
  const send = async (ask: boolean) => {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    const r = await api(`/api/messages/${id}`, { body: { body: text, askAssistant: ask } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setMaskedNote(!!r.data.contactsMasked);
    setText(""); load();
  };
  return (
    <div className="card flex flex-col">
      <p className="mb-3 rounded-md bg-bg p-2 text-xs text-muted">Чат для вопросов по оформлению. Условия и цена предложения зафиксированы и здесь не меняются. Общение только через платформу: телефоны, почта и ссылки скрываются автоматически.</p>
      {offline && <p role="status" className="mb-2 rounded bg-warn-soft p-2 text-xs text-warn">Нет соединения. Сообщения обновятся после восстановления.</p>}
      <div className="max-h-[60vh] min-h-[200px] space-y-3 overflow-y-auto" aria-live="polite" aria-label="Сообщения">
        {msgs.length === 0 && <p className="text-sm text-muted">Сообщений пока нет.</p>}
        {msgs.map((m) => {
          const mine = m.authorId === me;
          return (
            <div key={m.id} className={`max-w-[85%] rounded-lg p-2.5 text-sm ${mine ? "ml-auto bg-accent-soft" : m.authorRole === "AI" ? "border border-dashed border-accent bg-white" : "bg-bg"}`}>
              <p className="text-xs text-muted">{m.authorName} · {ROLE[m.authorRole] ?? m.authorRole} · {new Date(m.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
              {Array.isArray(m.citations) && m.citations.length > 0 && <ul className="mt-1 text-xs text-muted">{m.citations.map((c: any, i: number) => <li key={i}>Источник: {c.documentTitle}, пункт «{c.clauseTitle}»</li>)}</ul>}
              {m.handoff && <p className="mt-1 text-xs text-warn">Вопрос передан специалисту.</p>}
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <label htmlFor={`msg-${id}`} className="sr-only">Сообщение</label>
        <textarea id={`msg-${id}`} className="field" rows={2} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="Напишите сообщение" />
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => send(false)}>{busy ? "Отправка…" : "Отправить"}</button>
          {allowAssistant && <button className="btn btn-secondary" disabled={busy || !text.trim()} onClick={() => send(true)}>Спросить помощника по документам</button>}
        </div>
        {allowAssistant && <p className="mt-1 text-xs text-muted">Помощник отвечает только по документам этой сделки со ссылкой на пункт. Если ответа в документах нет, вопрос передаётся специалисту. Помощник не принимает решений о выплатах.</p>}
        {maskedNote && <p role="status" className="mt-1 text-xs text-warn">! Контакты в сообщении скрыты: общение идёт только через платформу.</p>}
        <ErrorBox error={error} />
      </div>
    </div>
  );
}
