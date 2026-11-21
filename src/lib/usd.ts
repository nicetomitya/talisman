/** Форматирование долларов из целых центов и величин из целых сотых (без float в расчётах; ТЗ v2, п. 13.3). */
export function fmtUsd(cents: number, opts: { sign?: boolean } = {}): string {
  const neg = cents < 0; const a = Math.abs(cents);
  const d = Math.trunc(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const c = (a % 100).toString().padStart(2, "0");
  const s = `$${d}.${c}`;
  return neg ? `−${s}` : opts.sign && cents > 0 ? `+${s}` : s;
}
/** Цена доли в центах (1..99) — «$0.20». */
export const fmtPrice = (cents: number) => `$0.${String(cents).padStart(2, "0")}`;
/** Средняя цена в сотых долях цента — «$0.2110». */
export function fmtVwap(x100: number): string {
  const cents = Math.trunc(x100 / 100); const frac = x100 % 100;
  return `$0.${String(cents).padStart(2, "0")}${String(frac).padStart(2, "0")}`;
}
export function fmtX100(v: number | null | undefined, unit?: string | null): string {
  if (v === null || v === undefined) return "—";
  const neg = v < 0; const a = Math.abs(v);
  const s = `${Math.trunc(a / 100)}.${String(a % 100).padStart(2, "0")}`.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${neg ? "−" : ""}${s}${unit ? (unit.startsWith("°") ? unit : ` ${unit}`) : ""}`;
}
/** «1,500.50» / «$1,500» → центы; без float. */
export function parseUsdToCents(s: string): number | null {
  const m = String(s).replace(/[$,\s]/g, "").match(/^(\d{1,9})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
/** «0.5» → 50, «8» → 800, «95.25» → 9525; без float. */
export function parseDecimalX100(s: string): number | null {
  const m = String(s).trim().match(/^(-?)(\d{1,6})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const v = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -v : v;
}
export const OP_LABEL: Record<string, string> = { BELOW: "below", ABOVE: "above" };
