"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, newKey, type ApiError } from "@/lib/client";
import { ErrorBox } from "./client";

const rub = (k: number) => (k / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";

/** Калькулятор агента: только утверждённая тарифная сетка; цена — в допустимых пределах; итог проверяется сервером повторно. */
export function QuoteCalculator({ requestId, requestVersion, products, deductible, altAllowed, open }: { requestId: string; requestVersion: number; products: { id: string; title: string; mandate: boolean }[]; deductible: number; altAllowed: boolean; open: boolean }) {
  const router = useRouter();
  const [productId, setProductId] = useState(products.find((p) => p.mandate)?.id ?? products[0]?.id ?? "");
  const [ded, setDed] = useState(deductible);
  const [calc, setCalc] = useState<any>(null);
  const [premium, setPremium] = useState<string>("");
  const [discount, setDiscount] = useState<string>("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef(newKey());
  const run = async () => {
    setBusy(true); setError(null); setDone(null);
    const r = await api("/api/agency/calc", { body: { requestId, productId, deductibleRub: ded } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setCalc(r.data);
    if (r.data.ok) setPremium(String(r.data.basePremiumKop / 100));
  };
  const premiumKop = Math.round(Number(premium.replace(",", ".")) * 100) || 0;
  const discountKop = Math.round(Number(discount.replace(",", ".")) * 100) || 0;
  const submit = async (publish: boolean) => {
    setBusy(true); setError(null); setDone(null);
    const r = await api("/api/agency/quote", { body: { requestId, requestVersion, productId, premiumKop, deductibleRub: ded, discountKop, discountPayer: discountKop ? "AGENCY_COMMISSION" : null, publish, idempotency_key: key.current } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    key.current = newKey();
    setDone(publish ? "Предложение опубликовано" : "Черновик сохранён");
    router.refresh();
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="qc-p" className="mb-1 block text-sm font-medium">Продукт страховщика</label>
          <select id="qc-p" className="field" value={productId} onChange={(e) => { setProductId(e.target.value); setCalc(null); }}>{products.map((p) => <option key={p.id} value={p.id}>{p.title}{p.mandate ? "" : " (нет полномочия)"}</option>)}</select></div>
        <div><label htmlFor="qc-d" className="mb-1 block text-sm font-medium">Франшиза, ₽</label>
          <select id="qc-d" className="field" value={ded} onChange={(e) => { setDed(Number(e.target.value)); setCalc(null); }}>{[0, 5000, 10000, 15000, 30000].map((d) => <option key={d} value={d} disabled={d !== deductible && !altAllowed}>{d.toLocaleString("ru-RU")}{d === deductible ? " (как в заявке)" : altAllowed ? " (альтернатива)" : " (клиент не допускает)"}</option>)}</select></div>
      </div>
      <button className="btn btn-secondary" disabled={busy || !productId} onClick={run}>Рассчитать по тарифу</button>
      {calc && !calc.ok && <p role="alert" className="text-sm text-bad">✕ {calc.reason}</p>}
      {calc?.ok && (
        <div className="rounded-md border border-line p-3 text-sm">
          {!calc.mandate && <p className="mb-2 text-bad">✕ У агентства нет действующего полномочия по этому продукту: опубликовать предложение нельзя.</p>}
          {calc.stale && <p className="mb-2 text-warn">! Тариф устарел: {calc.staleReason}</p>}
          <ul className="space-y-0.5">{calc.breakdown.map((b: any, i: number) => <li key={i}>{b.label}: {b.value}</li>)}</ul>
          <p className="mt-2">Базовая премия: <strong className="num">{rub(calc.basePremiumKop)}</strong>. Допустимо: <span className="num">{rub(calc.minPremiumKop)} – {rub(calc.maxPremiumKop)}</span> (тариф v{calc.tariffVersion}).</p>
          <p>Вознаграждение агентства: {(calc.commissionBp / 100).toFixed(1)} % = <span className="num">{rub(calc.commissionKop)}</span>, из них доля платформы <span className="num">{rub(calc.platformKop)}</span>, агентству <span className="num">{rub(calc.agencyKop)}</span>.</p>
          {calc.inspectionRequired && <p className="text-warn">! Потребуется осмотр.</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="qc-pr" className="mb-1 block font-medium">Страховая премия, ₽</label><input id="qc-pr" className="field" inputMode="decimal" value={premium} onChange={(e) => setPremium(e.target.value)} /></div>
            <div><label htmlFor="qc-ds" className="mb-1 block font-medium">Скидка за счёт комиссии агентства, ₽</label><input id="qc-ds" className="field" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          </div>
          <p className="mt-2">Клиент увидит итог: <strong className="num">{rub(Math.max(0, premiumKop - discountKop))}</strong>. Скрытые сборы не допускаются, итог пересчитывается сервером.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy || !open || !calc.mandate} onClick={() => submit(true)}>{busy ? "Отправка…" : "Опубликовать предложение"}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => submit(false)}>Сохранить черновик</button>
          </div>
          {!open && <p className="mt-1 text-xs text-muted">Приём предложений закрыт.</p>}
        </div>
      )}
      {done && <p role="status" className="text-sm text-ok">✓ {done}</p>}
      <ErrorBox error={error} />
    </div>
  );
}

export function RuleForm({ rule, canAuto }: { rule: any; canAuto: boolean }) {
  const router = useRouter();
  const [r, setR] = useState({ mode: rule.mode, productCodes: rule.productCodes, territories: rule.territories, maxSumInsuredRub: rule.maxSumInsuredRub, maxVehicleAge: rule.maxVehicleAge, tariffMaxAgeDays: rule.tariffMaxAgeDays, maxContractsPerDay: rule.maxContractsPerDay, dailyResponseLimit: rule.dailyResponseLimit, minCommissionBp: rule.minCommissionBp, improveMode: rule.improveMode, manualReasons: rule.manualReasons });
  const [error, setError] = useState<ApiError | null>(null);
  const [ok, setOk] = useState(false);
  const set = (k: string, v: any) => { setR({ ...r, [k]: v }); setOk(false); };
  const toggle = (k: "productCodes" | "manualReasons" | "territories", v: string) => set(k, (r as any)[k].includes(v) ? (r as any)[k].filter((x: string) => x !== v) : [...(r as any)[k], v]);
  const REASONS: Record<string, string> = { TAXI_OR_RENTAL: "Такси или аренда", YOUNG_DRIVER: "Молодой водитель", PRIOR_CLAIMS: "Были страховые случаи", INSPECTION_REQUIRED: "Нужен осмотр", RENT_OUT: "Жильё сдаётся" };
  const num = (k: string, label: string, hint?: string) => <div><label htmlFor={`rf-${k}`} className="mb-1 block text-sm font-medium">{label}</label><input id={`rf-${k}`} type="number" className="field" value={(r as any)[k]} onChange={(e) => set(k, Number(e.target.value))} />{hint && <p className="mt-1 text-xs text-muted">{hint}</p>}</div>;
  return (
    <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setError(null); const x = await api("/api/agency/automation", { body: r }); if (!x.ok) return setError(x.error); setOk(true); router.refresh(); }}>
      <fieldset><legend className="text-sm font-medium">Режим</legend>
        <div className="mt-1 space-y-1 text-sm">
          <label className="flex gap-2"><input type="radio" name="mode" checked={r.mode === "MANUAL"} onChange={() => set("mode", "MANUAL")} />Вручную: агент сам рассчитывает и публикует</label>
          <label className="flex gap-2"><input type="radio" name="mode" checked={r.mode === "CONFIRM"} onChange={() => set("mode", "CONFIRM")} />С подтверждением: система готовит черновик, агент публикует</label>
          <label className="flex gap-2"><input type="radio" name="mode" checked={r.mode === "AUTO"} disabled={!canAuto} onChange={() => set("mode", "AUTO")} />Автоматически в пределах правил{!canAuto && " (доступно на тарифе «Команда»)"}</label>
        </div></fieldset>
      <fieldset><legend className="text-sm font-medium">Продукты</legend><div className="mt-1 flex gap-3 text-sm">{["KASKO", "PROPERTY"].map((p) => <label key={p} className="flex gap-2"><input type="checkbox" checked={r.productCodes.includes(p)} onChange={() => toggle("productCodes", p)} />{p === "KASKO" ? "Каско" : "Квартира или дом"}</label>)}</div></fieldset>
      <fieldset><legend className="text-sm font-medium">Территории</legend><div className="mt-1 flex flex-wrap gap-3 text-sm">{[["RU-MOW", "Москва"], ["RU-SPE", "Санкт-Петербург"], ["RU-KDA", "Краснодарский край"]].map(([v, l]) => <label key={v} className="flex gap-2"><input type="checkbox" checked={r.territories.includes(v)} onChange={() => toggle("territories", v)} />{l}</label>)}</div><p className="mt-1 text-xs text-muted">Пусто: все территории полномочий</p></fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        {num("maxSumInsuredRub", "Макс. страховая сумма, ₽")}{num("maxVehicleAge", "Макс. возраст авто, лет")}{num("tariffMaxAgeDays", "Тариф не старше, дней")}
        {num("maxContractsPerDay", "Договоров в день, не больше")}{num("dailyResponseLimit", "Ответов в день, не больше")}{num("minCommissionBp", "Мин. комиссия, б.п.", "1000 = 10 %")}
      </div>
      <fieldset><legend className="text-sm font-medium">Улучшение цены автоматически</legend><select className="field mt-1 max-w-xs" value={r.improveMode} onChange={(e) => set("improveMode", e.target.value)} aria-label="Улучшение цены"><option value="NONE">Не улучшать</option><option value="ONE_STEP">Один шаг в пределах тарифа</option></select></fieldset>
      <fieldset><legend className="text-sm font-medium">Всегда передавать человеку</legend><div className="mt-1 flex flex-wrap gap-3 text-sm">{Object.entries(REASONS).map(([k, l]) => <label key={k} className="flex gap-2"><input type="checkbox" checked={r.manualReasons.includes(k)} onChange={() => toggle("manualReasons", k)} />{l}</label>)}</div></fieldset>
      <button className="btn btn-primary">Сохранить правила</button>{ok && <span role="status" className="ml-2 text-sm text-ok">✓ Сохранено</span>}
      <ErrorBox error={error} />
    </form>
  );
}
