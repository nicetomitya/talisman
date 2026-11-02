"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

const P = [
  { code: "KASKO", title: "Каско", text: "Ущерб, угон, стёкла. Предложения от агентств." },
  { code: "PROPERTY", title: "Квартира или дом", text: "Конструктив, отделка, имущество, ответственность." },
  { code: "RAIN01", title: "Дождь на мероприятии", text: "Фиксированная выплата при осадках от 5 мм за часы мероприятия." },
  { code: "WIND01", title: "Недостаток ветра", text: "Выплата, если на парусном занятии ветер был слабее 3 м/с." },
];
export function NewRequest({ preset, objects }: { preset?: string; objects: { id: string; title: string; kind: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const create = async (body: any) => {
    setBusy(true); setError(null); setHint(null);
    const r = await api("/api/requests", { body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (r.data.needProduct) return setHint(r.data.message);
    router.push(`/c/requests/${r.data.id}`);
  };
  return (
    <div className="space-y-5">
      <section className="card"><h2 className="font-semibold">Опишите своими словами</h2>
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); create({ freeText: String(fd.get("t") ?? "") }); }}>
          <label htmlFor="ft" className="sr-only">Описание</label>
          <textarea id="ft" name="t" rows={3} className="field" placeholder="Например: хочу каско на Kia K5 2022 года или застраховать свадьбу в саду от дождя" required />
          <button className="btn btn-primary" disabled={busy}>Подобрать вид страхования</button>
        </form>
        {hint && <p role="status" className="mt-2 text-sm text-warn">! {hint}</p>}
      </section>
      <section><h2 className="mb-2 font-semibold">Или выберите сами</h2>
        <ul className="grid gap-3 sm:grid-cols-2">{P.map((p) => <li key={p.code}><button type="button" disabled={busy} className={`card w-full text-left hover:border-accent ${preset === p.code ? "ring-2 ring-accent" : ""}`} onClick={() => create({ productCode: p.code })}><span className="block font-semibold">{p.title}</span><span className="mt-1 block text-sm text-muted">{p.text}</span></button></li>)}</ul>
      </section>
      {objects.length > 0 && <section className="card"><h2 className="font-semibold">Из сохранённого объекта</h2><p className="text-sm text-muted">Данные подставятся, ключевые поля нужно будет перепроверить.</p>
        <ul className="mt-2 flex flex-wrap gap-2">{objects.map((o) => <li key={o.id}><button className="btn btn-secondary" disabled={busy} onClick={() => create({ productCode: o.kind === "CAR" ? "KASKO" : o.kind === "PROPERTY" ? "PROPERTY" : "RAIN01", savedObjectId: o.id })}>{o.title}</button></li>)}</ul></section>}
      <ErrorBox error={error} />
    </div>
  );
}
