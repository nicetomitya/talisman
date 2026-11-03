/** Длительность по-русски: 90 → «1 минута 30 секунд» не нужна; для правил подбора хватает целых единиц. */
const plural = (n: number, one: string, few: string, many: string) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };
export function durationRu(sec: number): string {
  if (sec % 3600 === 0) { const h = sec / 3600; return `${h} ${plural(h, "час", "часа", "часов")}`; }
  if (sec % 60 === 0) { const m = sec / 60; return `${m} ${plural(m, "минута", "минуты", "минут")}`; }
  return `${sec} ${plural(sec, "секунда", "секунды", "секунд")}`;
}
