import { DateTime } from "luxon";

/**
 * Демонстрационное определение исхода по суточным наблюдениям (ТЗ v2, п. 7.3). Наблюдение ≠ юридический исход:
 * результат — PROPOSED с окном спора; NEEDS_DATA, если хотя бы день отсутствует и у основной, и у резервной станции.
 */
export type DayObs = { day: string; valueX100: number | null; sourceId: string; isFallback: boolean };

export function windowDays(startLocal: string, endLocal: string): string[] {
  const out: string[] = [];
  for (let d = DateTime.fromISO(startLocal); d <= DateTime.fromISO(endLocal); d = d.plus({ days: 1 })) out.push(d.toISODate()!);
  return out;
}

export function pickObservations(days: string[], primary: Record<string, number | null>, fallback: Record<string, number | null> | undefined, primaryId: string, fallbackId: string | null): DayObs[] {
  return days.map((day) => {
    const p = primary[day];
    if (p !== undefined && p !== null) return { day, valueX100: p, sourceId: primaryId, isFallback: false };
    const f = fallback?.[day];
    if (fallbackId && f !== undefined && f !== null) return { day, valueX100: f, sourceId: fallbackId, isFallback: true };
    return { day, valueX100: null, sourceId: primaryId, isFallback: false };
  });
}

export function decide(templateCode: string, operator: string, thresholdX100: number, obs: DayObs[]): { status: "NEEDS_DATA"; missing: string[] } | { status: "PROPOSED"; outcome: "YES" | "NO"; indexX100: number; method: string } {
  if (templateCode === "CONSTRUCTION_DELAY") return { status: "NEEDS_DATA", missing: ["manual review of the public permit registry"] };
  const missing = obs.filter((o) => o.valueX100 === null).map((o) => o.day);
  if (missing.length || obs.length === 0) return { status: "NEEDS_DATA", missing: missing.length ? missing : ["no observations"] };
  const vals = obs.map((o) => o.valueX100!);
  let index: number; let method: string;
  if (templateCode === "WIND_LOW") { const sum = vals.reduce((a, b) => a + b, 0); index = Math.floor((2 * sum + vals.length) / (2 * vals.length)); method = "average of daily means"; }
  else if (templateCode === "RAIN_HIGH") { index = vals.reduce((a, b) => a + b, 0); method = "total over window"; }
  else { index = Math.max(...vals); method = "highest daily maximum"; }
  const yes = operator === "BELOW" ? index < thresholdX100 : index > thresholdX100;
  return { status: "PROPOSED", outcome: yes ? "YES" : "NO", indexX100: index, method };
}

/** Оценка Брайера в базисных пунктах: (p − o)² / 10000, где p и o в bp. 0 — идеально, 10000 — хуже всего. */
export const brierBp = (probabilityBp: number, outcomeYes: boolean) => { const d = probabilityBp - (outcomeYes ? 10000 : 0); return Math.floor((d * d) / 10000); };
