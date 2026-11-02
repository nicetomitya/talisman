"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

const rub = (k: number) => (k / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";

export function Terminate({ policyId }: { policyId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<any>(null);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div><label htmlFor="td" className="mb-1 block text-sm font-medium">Дата прекращения</label><input id="td" type="date" className="field" value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} /><p className="mt-1 text-xs text-muted">Пусто: с текущей даты</p></div>
        <div><label htmlFor="tr" className="mb-1 block text-sm font-medium">Причина</label><input id="tr" className="field" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      {!preview ? <button className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); setError(null); const r = await api(`/api/policies/${policyId}/termination-preview`, { body: date ? { date } : {} }); setBusy(false); if (!r.ok) return setError(r.error); setPreview(r.data); }}>Рассчитать возврат</button> : (
        <div className="rounded-md border border-warn/30 bg-warn-soft p-3 text-sm">
          <p>Возврат: <strong className="num">{rub(preview.refundKop)}</strong>{preview.coolingOff ? " (период охлаждения: полный возврат)" : " (пропорционально неистёкшему сроку)"}.</p>
          <p>Дата прекращения: {new Date(preview.effectiveAt).toLocaleDateString("ru-RU")}. {preview.consequences}</p>
          <p className="mt-1 text-xs">Возврат выполняет страховщик отдельной операцией на исходный способ оплаты (демо).</p>
          <button className="btn btn-danger mt-2" disabled={busy} onClick={async () => { setBusy(true); setError(null); const r = await api(`/api/policies/${policyId}/terminate`, { body: { ...(date ? { date } : {}), reason: reason || "По желанию клиента", confirm: true } }); setBusy(false); if (!r.ok) return setError(r.error); router.refresh(); }}>Подтвердить прекращение</button>
        </div>)}
      <ErrorBox error={error} />
    </div>
  );
}

export function Rating({ policyId, stage }: { policyId: string; stage: "SALE" | "CLAIM" }) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [error, setError] = useState<ApiError | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setError(null); const r = await api(`/api/policies/${policyId}/review`, { body: { stage, rating, text: String(fd.get("text") ?? "") } }); if (!r.ok) return setError(r.error); setOk(true); router.refresh(); }}>
      <fieldset><legend className="text-sm font-medium">Оценка {stage === "CLAIM" ? "урегулирования" : "покупки"}</legend>
        <div className="mt-1 flex gap-1">{[1, 2, 3, 4, 5].map((n) => <label key={n} className={`btn !min-h-0 !px-3 !py-1 ${rating === n ? "btn-primary" : "btn-secondary"}`}><input type="radio" name="r" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />{n}</label>)}</div></fieldset>
      <label htmlFor={`rv-${stage}`} className="block text-sm font-medium">Отзыв</label><textarea id={`rv-${stage}`} name="text" rows={2} className="field" required minLength={3} />
      <p className="text-xs text-muted">Не указывайте персональные данные. Отзыв привязан к завершённой сделке.</p>
      <button className="btn btn-secondary">Сохранить отзыв</button>{ok && <span role="status" className="ml-2 text-sm text-ok">✓ Сохранено</span>}
      <ErrorBox error={error} />
    </form>
  );
}
