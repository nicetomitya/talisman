/**
 * Симулятор цены бинарного контракта по глубине стакана (ТЗ v2, п. 5, 8.1). Только целые числа.
 * Единица выплаты — $1 (100 центов) за долю; цена доли — 1..99 центов.
 * gross_payout = units × 100; total = Σ(q×p) + fees; max_loss = total (полностью оплаченная позиция без плеча).
 */
export type Level = [priceCents: number, units: number];
export type Side = "YES" | "NO";
export const UNIT_PAYOUT_CENTS = 100;

/** Демонстрационная комиссия симулированной площадки: 1 цент за каждые 10 долей (с округлением вверх). Не тариф реальной площадки. */
export const SIM_VENUE_FEE_RULE = "Illustrative simulated venue fee: $0.01 per 10 units, rounded up. Not a real fee schedule.";
export const simVenueFee = (units: number) => Math.ceil(units / 10);
/** Talisman не берёт комиссию: утверждённого партнёрского тарифа нет (ТЗ v2, крит. 22). */
export const TALISMAN_FEE_CENTS = 0;

export function walk(asks: Level[], wantUnits: number) {
  const sorted = [...asks].filter(([p, q]) => p >= 1 && p <= 99 && q > 0).sort((a, b) => a[0] - b[0]);
  const fills: { priceCents: number; units: number }[] = [];
  let left = wantUnits; let cost = 0;
  for (const [p, q] of sorted) {
    if (left <= 0) break;
    const take = Math.min(q, left);
    fills.push({ priceCents: p, units: take });
    cost += take * p; left -= take;
  }
  const filled = wantUnits - left;
  return { fills, filledUnits: filled, costCents: cost, availableUnits: sorted.reduce((s, [, q]) => s + q, 0) };
}

/** Целочисленное деление с округлением половины вверх. */
const divRound = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));

export type QuoteCalc = {
  side: Side; requestedUnits: number; filledUnits: number; fillPct: number; partial: boolean; fills: { priceCents: number; units: number }[];
  bestAskCents: number | null; vwapX100: number | null; costCents: number; venueFeeCents: number; talismanFeeCents: number; totalCents: number;
  maxLossCents: number; grossPayoutCents: number;
  scenarios: { eventHappens: { grossCents: number; netCents: number }; eventDoesNotHappen: { grossCents: number; netCents: number } };
};

export function priceFor(side: Side, asks: Level[], targetPayoutCents: number): QuoteCalc {
  const requestedUnits = Math.floor(targetPayoutCents / UNIT_PAYOUT_CENTS);
  return priceUnits(side, asks, requestedUnits);
}

export function priceUnits(side: Side, asks: Level[], requestedUnits: number): QuoteCalc {
  const w = walk(asks, requestedUnits);
  const venueFeeCents = w.filledUnits ? simVenueFee(w.filledUnits) : 0;
  const totalCents = w.costCents + venueFeeCents + TALISMAN_FEE_CENTS;
  const gross = w.filledUnits * UNIT_PAYOUT_CENTS;
  const pays = { grossCents: gross, netCents: gross - totalCents };
  const zero = { grossCents: 0, netCents: -totalCents };
  const best = [...asks].filter(([, q]) => q > 0).sort((a, b) => a[0] - b[0])[0]?.[0] ?? null;
  return {
    side, requestedUnits, filledUnits: w.filledUnits, fillPct: requestedUnits ? Math.floor((w.filledUnits * 100) / requestedUnits) : 0,
    partial: w.filledUnits < requestedUnits, fills: w.fills, bestAskCents: best,
    vwapX100: w.filledUnits ? divRound(w.costCents * 100, w.filledUnits) : null,
    costCents: w.costCents, venueFeeCents, talismanFeeCents: TALISMAN_FEE_CENTS, totalCents, maxLossCents: totalCents, grossPayoutCents: gross,
    scenarios: side === "YES" ? { eventHappens: pays, eventDoesNotHappen: zero } : { eventHappens: zero, eventDoesNotHappen: pays },
  };
}

/** Сколько долей можно купить на бюджет (с комиссией), не больше доступной глубины. */
export function unitsForBudget(asks: Level[], budgetCents: number): number {
  let lo = 0; let hi = asks.reduce((s, [, q]) => s + q, 0);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const w = walk(asks, mid);
    if (w.filledUnits === mid && w.costCents + simVenueFee(mid) <= budgetCents) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Спред: лучшая цена YES + лучшая цена NO − $1 (в центах). */
export function spreadCents(yes: Level[], no: Level[]): number | null {
  const y = [...yes].sort((a, b) => a[0] - b[0])[0]?.[0]; const n = [...no].sort((a, b) => a[0] - b[0])[0]?.[0];
  return y && n ? y + n - UNIT_PAYOUT_CENTS : null;
}
