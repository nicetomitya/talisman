"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, newKey, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

const rub = (k: number) => (k / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ₽";
const SOURCE: Record<string, string> = { TARIFF_GRID: "Расчёт по утверждённой тарифной сетке страховщика", CARRIER_QUOTE: "Котировка страховщика", EVENT_TARIFF: "Фиксированный тариф продукта" };

export function OfferCompare({ requestId, requestVersion, groups, canSelect }: { requestId: string; requestVersion: number; groups: any[]; canSelect: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const keys = useRef<Record<string, string>>({});
  const select = async (o: any) => {
    setBusy(o.id); setError(null);
    keys.current[o.id] ??= newKey();
    const r = await api("/api/checkouts", { body: { request_id: requestId, request_version: requestVersion, quote_id: o.id, quote_version: o.seq, idempotency_key: keys.current[o.id] } });
    setBusy(null);
    if (!r.ok) {
      if (r.error.code === "ALREADY_DONE" && r.error.details?.checkoutId) return router.push(`/c/checkouts/${r.error.details.checkoutId}`);
      setError(r.error); router.refresh(); return;
    }
    router.push(`/c/checkouts/${r.data.checkout_id}`);
  };
  return (
    <div className="space-y-5">
      <ErrorBox error={error} />
      {groups.map((g, gi) => (
        <section key={g.fingerprint} aria-labelledby={`g-${gi}`} className="space-y-2">
          <h3 id={`g-${gi}`} className="font-semibold">{g.matchesRequest ? "Условия как в вашей заявке" : "Альтернатива с другими условиями"}{g.offers.length > 1 ? ` · ${g.offers.length} предложения, по возрастанию общей цены` : ""}</h3>
          {!g.matchesRequest && <p className="rounded-md border border-warn/30 bg-warn-soft p-2 text-sm text-warn">! Отличается от заявки: {g.differences.join("; ")}. Цены этой группы не сравниваются с основной.</p>}
          <ul className="grid gap-3 md:grid-cols-2">
            {g.offers.map((o: any) => (
              <li key={o.id} className={`card ${o.status === "SELECTED" ? "ring-2 ring-accent" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="text-xl font-semibold num">{rub(o.totalKop)}</p><p className="text-xs text-muted">Итого к оплате страховщику</p></div>
                  {g.offers.length > 1 && <span className="rounded bg-bg px-2 py-0.5 text-xs">{o.rankInGroup} место по цене в группе</span>}
                </div>
                <dl className="mt-3 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">Страховая премия</dt><dd className="num">{rub(o.premiumKop)}</dd>
                  <dt className="text-muted">Сборы</dt><dd className="num">{rub(o.feesKop)}</dd>
                  <dt className="text-muted">Скидка</dt><dd className="num">{o.discountKop ? `− ${rub(o.discountKop)} (за счёт ${o.discountPayer === "AGENCY" ? "комиссии агентства" : "страховщика"})` : "нет"}</dd>
                  <dt className="text-muted">Страховщик</dt><dd>{o.carrier.name}</dd>
                  <dt className="text-muted">Агентство</dt><dd>{o.agency ? <a href={`/agents/${o.agency.id}`} target="_blank">{o.agency.name}</a> : "напрямую от страховщика"}{o.rating ? ` · ${o.rating.avg.toFixed(1)}/5 (${o.rating.count})` : ""}</dd>
                  <dt className="text-muted">Франшиза</dt><dd className="num">{(o.terms.deductibleRub ?? 0).toLocaleString("ru-RU")} ₽</dd>
                  <dt className="text-muted">Основание цены</dt><dd>{SOURCE[o.sourceType] ?? o.sourceType}</dd>
                  <dt className="text-muted">Цена действует до</dt><dd>{new Date(o.expiresAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</dd>
                </dl>
                {o.sameCarrierOtherAgents && <p className="mt-2 text-xs text-muted">Этот же продукт страховщика предлагают несколько агентств: страховое покрытие одинаковое, различаются цена и сервис.</p>}
                {o.inspectionRequired && <p className="mt-2 text-xs text-warn">! Нужен осмотр объекта до начала действия.</p>}
                {o.isPreliminary && <p className="mt-2 text-xs text-warn">! Предварительная оценка: оформить нельзя.</p>}
                {o.expired && <p className="mt-2 text-xs text-bad">✕ Срок действия цены истёк.</p>}
                <details className="mt-2 text-sm"><summary className="cursor-pointer">Исключения и урегулирование</summary><ul className="mt-1 list-disc pl-5">{(o.terms.exclusions ?? []).map((e: any) => <li key={e.code}>{e.title}</li>)}</ul><p className="mt-1">{o.terms.settlement}</p></details>
                {canSelect && o.status === "PUBLISHED" && !o.expired && !o.isPreliminary && <button type="button" className="btn btn-primary mt-3 w-full sm:w-auto" disabled={!!busy} onClick={() => select(o)}>{busy === o.id ? "Резервируем…" : "Выбрать это предложение"}</button>}
                {o.status === "SELECTED" && <p className="mt-3 text-sm font-medium text-accent">✓ Выбрано вами</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
