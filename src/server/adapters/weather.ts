import { emu, requireEmulatorAllowed } from "./emu";
import { err } from "../errors";

export type StationMeta = { source: string; stationId: string; lat: number; lon: number; metric: "PRECIP_MM" | "WIND_MS"; format: "COUNTER" | "INCREMENT" | "MEAN"; method: string; unit: string };
export type RawReading = { at: string; valueX100: number; quality: "OK" | "SUSPECT" };

export interface WeatherAdapter {
  stations(): StationMeta[];
  fetch(source: string, stationId: string, from: Date, to: Date): Promise<{ meta: StationMeta; readings: RawReading[]; fetchedAt: string }>;
}

/** Метаданные демо-станций. Координаты вымышленные рядом с точкой RAIN01. */
export const DEMO_STATIONS: StationMeta[] = [
  { source: "DEMO_STATION_SPB_01", stationId: "SPB01", lat: 59.9386, lon: 30.3141, metric: "PRECIP_MM", format: "COUNTER", method: "Накопительный счётчик осадков, показания на начало часа", unit: "мм" },
  { source: "DEMO_STATION_SPB_02", stationId: "SPB02", lat: 59.9711, lon: 30.3256, metric: "PRECIP_MM", format: "INCREMENT", method: "Часовые приращения осадков", unit: "мм" },
  { source: "DEMO_WIND_01", stationId: "W01", lat: 59.9862, lon: 30.2135, metric: "WIND_MS", format: "MEAN", method: "Средняя скорость за час, высота 10 м, усреднение 10-минутных значений", unit: "м/с" },
  { source: "DEMO_WIND_02", stationId: "W02", lat: 59.9550, lon: 30.1900, metric: "WIND_MS", format: "MEAN", method: "Средняя скорость за час, высота 10 м", unit: "м/с" },
];

/**
 * Воспроизводимые наборы наблюдений (только для проверки программы, не реальная погода).
 * Последовательности привязаны к началу запрошенного окна, по часам. null — отсутствующий интервал.
 */
export const FIXTURES: Record<string, { label: string; primary: (number | null)[]; backup: (number | null)[] }> = {
  // RAIN01: приращения, мм ×100
  r52: { label: "5.2 мм (0.0, 0.4, 1.2, 2.0, 1.0, 0.6)", primary: [0, 40, 120, 200, 100, 60], backup: [0, 30, 130, 190, 110, 60] },
  r50: { label: "ровно 5.0 мм", primary: [0, 40, 120, 200, 100, 40], backup: [0, 40, 120, 200, 100, 40] },
  r49: { label: "4.9 мм — порог не достигнут", primary: [0, 40, 120, 200, 100, 30], backup: [0, 40, 120, 200, 100, 30] },
  r_gap_backup: { label: "Пропуск 17–18 ч в основном, есть в резервном", primary: [0, 40, 120, null, 100, 60], backup: [0, 30, 130, 200, 110, 60] },
  r_gap_both: { label: "Пропуск 17–18 ч в обоих источниках", primary: [0, 40, 120, null, 100, 60], backup: [0, 30, 130, null, 110, 60] },
  // WIND01: средние, м/с ×100
  w_met: { label: "2.1, 2.8, 3.2, 2.5 м/с — условие выполнено", primary: [210, 280, 320, 250], backup: [220, 270, 330, 260] },
  w_exact3: { label: "3.0, 2.8, 3.2, 2.5 — ровно 3.0 не ниже порога", primary: [300, 280, 320, 250], backup: [300, 290, 320, 260] },
  w_missing: { label: "Пропуск второго часа в обоих источниках", primary: [210, null, 320, 250], backup: [220, null, 330, 260] },
  w_conflict: { label: "Резервный источник противоречит основному", primary: [210, 280, 320, 250], backup: [350, 360, 320, 340] },
};

export const weatherEmulator: WeatherAdapter = {
  stations: () => DEMO_STATIONS,
  async fetch(source, stationId, from, to) {
    requireEmulatorAllowed("Weather");
    const s = await emu();
    if (s.weather.unavailable.includes(source)) throw err("SOURCE_UNAVAILABLE", `Источник ${source} недоступен (эмуляция)`);
    const meta = DEMO_STATIONS.find((m) => m.source === source && m.stationId === stationId);
    if (!meta) throw err("NOT_FOUND", "Неизвестная станция");
    const variant = FIXTURES[meta.metric === "PRECIP_MM" ? s.weather.RAIN01 : s.weather.WIND01];
    const isBackup = source.endsWith("_02");
    const seq = variant ? (isBackup ? variant.backup : variant.primary) : [];
    const hours = Math.round((to.getTime() - from.getTime()) / 3600_000);
    const readings: RawReading[] = [];
    if (meta.format === "COUNTER") {
      // Накопительный счётчик: показание на начало каждого часа, включая конец окна. Пропуск интервала — нет показания на его конце.
      let counter = 0;
      readings.push({ at: from.toISOString(), valueX100: counter, quality: "OK" });
      for (let i = 0; i < hours; i++) {
        const v = seq[i];
        if (v === null || v === undefined) { counter += 0; continue; }
        counter += v;
        // Если предыдущий интервал пропущен, показание на начало текущего тоже отсутствует → разрыв сохраняется.
        readings.push({ at: new Date(from.getTime() + (i + 1) * 3600_000).toISOString(), valueX100: counter, quality: "OK" });
      }
    } else {
      for (let i = 0; i < hours; i++) {
        const v = seq[i];
        if (v === null || v === undefined) continue;
        readings.push({ at: new Date(from.getTime() + i * 3600_000).toISOString(), valueX100: v, quality: "OK" });
      }
    }
    return { meta, readings, fetchedAt: new Date().toISOString() };
  },
};
