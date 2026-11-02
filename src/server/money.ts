/** Деньги — целые копейки. Форматирование без float-арифметики. */
export function rub(kop: number | bigint | null | undefined): string {
  if (kop === null || kop === undefined) return "—";
  const n = BigInt(kop);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const r = abs / 100n;
  const k = abs % 100n;
  const rs = r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "−" : ""}${rs}${k ? "," + k.toString().padStart(2, "0") : ""} ₽`;
}
export const rubToKop = (r: number) => Math.round(r) * 100;
/** Доля в базисных пунктах (10000 = 100%), округление к ближайшей копейке, половина — вверх. */
export function applyBp(kop: number, bp: number): number {
  const v = BigInt(kop) * BigInt(bp);
  return Number((v + 5000n) / 10000n);
}
export function rubInt(n: number) { return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽"; }
