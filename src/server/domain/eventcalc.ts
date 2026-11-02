import { DateTime } from "luxon";

/**
 * Параметрические условия событийных продуктов. Чистые функции без float-арифметики:
 * значения — целые сотые доли (мм ×100, м/с ×100).
 */
export type EventTerms = {
  metric: "PRECIP_MM" | "WIND_MS";
  unit: string;
  aggregation: "SUM_GTE" | "COUNT_LT";
  thresholdX100: number;
  minIntervals?: number; // для COUNT_LT
  intervalMinutes: number;
  primary: { source: string; stationId: string; lat: number; lon: number };
  backup?: { source: string; stationId: string; lat: number; lon: number } | null;
  maxDistanceKm: number;
  payoutKop: number;
  premiumKop: number;
  conflictToleranceX100: number;
  finalizationDelayHours: number;
  ruleVersion: string;
};

export type Window = { startUtc: Date; endUtc: Date; intervals: { start: Date; end: Date }[]; timezone: string };

export type Disambiguation = "earlier" | "later" | undefined;

/**
 * Местное время события → точные UTC-границы. Неоднозначное (переход на зимнее время) требует явного выбора;
 * несуществующее (переход на летнее) отвергается.
 */
export function buildWindow(date: string, startHHmm: string, endHHmm: string, tz: string, intervalMinutes: number, dis?: Disambiguation): Window {
  const start = resolveLocal(date, startHHmm, tz, dis);
  const end = resolveLocal(date, endHHmm, tz, dis);
  if (end <= start) throw new Error("Окончание должно быть позже начала");
  const intervals: { start: Date; end: Date }[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += intervalMinutes * 60_000) {
    intervals.push({ start: new Date(t), end: new Date(Math.min(t + intervalMinutes * 60_000, end.getTime())) });
  }
  return { startUtc: start, endUtc: end, intervals, timezone: tz };
}

export function resolveLocal(date: string, hhmm: string, tz: string, dis?: Disambiguation): Date {
  const local = DateTime.fromISO(`${date}T${hhmm}`, { zone: tz });
  if (!local.isValid) throw new Error(`Некорректное местное время ${date} ${hhmm} (${tz})`);
  // Несуществующее время: luxon сдвигает вперёд — обнаруживаем по несовпадению часов.
  if (local.toFormat("HH:mm") !== hhmm) throw new Error(`Местного времени ${date} ${hhmm} не существует в ${tz} (переход часов)`);
  const offsets = local.getPossibleOffsets();
  if (offsets.length > 1) {
    if (!dis) throw new Error(`Местное время ${date} ${hhmm} неоднозначно в ${tz}: укажите, до или после перевода часов`);
    const sorted = [...offsets].sort((a, b) => a.toMillis() - b.toMillis());
    return (dis === "earlier" ? sorted[0] : sorted[sorted.length - 1]).toJSDate();
  }
  return local.toJSDate();
}

export type IntervalValue = { start: Date; valueX100: number | null; source: string | null; quality?: string };
export type Evaluation = {
  outcome: "MET" | "NOT_MET" | "NEEDS_DATA" | "CONFLICT";
  aggregateX100: number | null;
  intervals: { start: string; end: string; primary: number | null; backup: number | null; used: number | null; source: string | null; counted?: boolean }[];
  missing: number;
  explanation: string;
};

/**
 * Оценка условия. Правила: пропуск ≠ ноль/штиль; при пропуске основного источника берётся резервный;
 * если резерв тоже отсутствует — NEEDS_DATA (ручная работа или ожидание данных), а не отказ.
 * Если оба источника есть и дают разный итог — CONFLICT (проверка специалистом).
 */
export function evaluate(terms: EventTerms, window: Window, primary: Map<number, number>, backup: Map<number, number>): Evaluation {
  const rows = window.intervals.map((iv) => {
    const k = iv.start.getTime();
    const p = primary.has(k) ? primary.get(k)! : null;
    const b = backup.has(k) ? backup.get(k)! : null;
    const used = p ?? b;
    return { start: iv.start.toISOString(), end: iv.end.toISOString(), primary: p, backup: b, used, source: p !== null ? terms.primary.source : b !== null ? terms.backup?.source ?? null : null };
  });
  const missing = rows.filter((r) => r.used === null).length;
  const unit = terms.unit;
  const fmt = (x: number) => (x / 100).toFixed(1);

  const decide = (vals: (number | null)[]): { outcome: "MET" | "NOT_MET" | "NEEDS_DATA"; agg: number | null } => {
    if (terms.aggregation === "SUM_GTE") {
      if (vals.some((v) => v === null)) return { outcome: "NEEDS_DATA", agg: null };
      const sum = (vals as number[]).reduce((s, v) => s + v, 0);
      return { outcome: sum >= terms.thresholdX100 ? "MET" : "NOT_MET", agg: sum };
    }
    const need = terms.minIntervals ?? vals.length;
    const below = vals.filter((v) => v !== null && v < terms.thresholdX100).length;
    const unknown = vals.filter((v) => v === null).length;
    if (below >= need) return { outcome: "MET", agg: below };
    if (below + unknown >= need) return { outcome: "NEEDS_DATA", agg: below };
    return { outcome: "NOT_MET", agg: below };
  };

  const main = decide(rows.map((r) => r.used));
  const out: Evaluation = { outcome: main.outcome, aggregateX100: main.agg, intervals: rows, missing, explanation: "" };
  if (terms.aggregation === "COUNT_LT") {
    for (const r of out.intervals) r.counted = r.used !== null && r.used < terms.thresholdX100;
  }

  // Сверка с резервным источником, если он полностью покрывает окно.
  const backupFull = rows.every((r) => r.backup !== null);
  if (main.outcome !== "NEEDS_DATA" && backupFull && rows.some((r) => r.primary !== null)) {
    const alt = decide(rows.map((r) => r.backup));
    const maxDiff = Math.max(...rows.filter((r) => r.primary !== null).map((r) => Math.abs((r.primary as number) - (r.backup as number))));
    if (alt.outcome !== main.outcome && maxDiff > terms.conflictToleranceX100) {
      out.outcome = "CONFLICT";
      out.explanation = `Основной (${terms.primary.source}) и резервный (${terms.backup?.source}) источники дают разный результат; нужна проверка специалистом.`;
      return out;
    }
  }

  if (out.outcome === "NEEDS_DATA") {
    out.explanation = `Нет данных за ${missing} из ${rows.length} интервалов ни в основном, ни в резервном источнике. Статус: «Проверяем данные». Отсутствие наблюдений не считается отсутствием события.`;
  } else if (terms.aggregation === "SUM_GTE") {
    out.explanation = `Сумма осадков ${fmt(main.agg!)} ${unit} при пороге ${fmt(terms.thresholdX100)} ${unit}: условие ${main.outcome === "MET" ? "выполнено" : "не выполнено"}.`;
  } else {
    out.explanation = `Интервалов со средней скоростью ниже ${fmt(terms.thresholdX100)} ${unit}: ${main.agg} из ${rows.length} (нужно не меньше ${terms.minIntervals}). Условие ${main.outcome === "MET" ? "выполнено" : "не выполнено"}.`;
  }
  return out;
}

/** Нормализация накопительного счётчика осадков в приращения за интервалы (без повторного суммирования). */
export function counterToIncrements(readings: { at: Date; counterX100: number }[], intervalMinutes: number): { start: Date; valueX100: number }[] {
  const sorted = [...readings].sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: { start: Date; valueX100: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (b.at.getTime() - a.at.getTime() !== intervalMinutes * 60_000) continue; // разрыв — интервал не восстанавливаем
    const inc = b.counterX100 - a.counterX100;
    if (inc < 0) continue; // сброс счётчика — интервал считается отсутствующим
    out.push({ start: a.at, valueX100: inc });
  }
  return out;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
