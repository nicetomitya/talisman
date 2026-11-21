import { DateTime } from "luxon";
import { createHash } from "node:crypto";
import { findPlace, placeByKey, stationOf, type Place } from "./geo";
import { CATEGORY_TEMPLATE, TEMPLATES, type TemplateCode } from "./templates";
import { parseDecimalX100, parseUsdToCents } from "@/lib/usd";
import { stableStringify } from "../idempotency";

/**
 * AI Event Builder — детерминированный эмулятор извлечения условий из английского текста (ТЗ v2, п. 6).
 * Текст пользователя — данные, не команды: из него только извлекаются поля; ни одна фраза не вызывает действий.
 * Станция наблюдения никогда не выбирается автоматически.
 */
export const EXTRACTOR_VERSION = "ev-intake-emu-1";

export type IntentFields = {
  category: string;
  placeKey: string | null; placeText: string | null; stationId: string | null;
  windowStartLocal: string | null; windowEndLocal: string | null; timezone: string | null; monthHint: string | null;
  operator: "BELOW" | "ABOVE" | null; thresholdX100: number | null; unit: string | null; metric: string | null;
  desiredPayoutCents: number | null; budgetCents: number | null;
};
export type Unresolved = { field: string; question: string };
export type BuiltIntent = IntentFields & {
  templateCode: TemplateCode | null; startUtc: Date | null; endUtc: Date | null; unresolved: Unresolved[]; basisRisk: string[];
  manipulationRisk: boolean; confidence: number; status: "NEEDS_CLARIFICATION" | "READY_FOR_REVIEW";
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIdx = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3))) + 1;

export function detectCategory(t: string): string {
  const s = t.toLowerCase();
  if (/\b(construction|builder|developer|closing date|move-in|certificate of occupancy|new home|house (?:delivery|completion))\b/.test(s)) return "CONSTRUCTION_DELAY";
  if (/\bflight|airline\b/.test(s)) return "FLIGHT_DELAY";
  if (/\bpower outage|blackout\b/.test(s)) return "POWER_OUTAGE";
  if (/\b(wind|windless|calm|breeze|regatta|sail(?:ing)?|kite)/.test(s)) return "WEATHER_WIND";
  if (/\b(rain|rainy|wet|storm|downpour|precipitation)/.test(s)) return "WEATHER_RAIN";
  if (/\b(heat|hot|temperature|heatwave|degrees)\b/.test(s)) return "WEATHER_TEMP";
  return "OTHER";
}

const iso = (y: number, m: number, d: number) => DateTime.fromObject({ year: y, month: m, day: d }).toISODate();
function upcomingYear(month: number, day: number, today: DateTime): number {
  const thisYear = DateTime.fromObject({ year: today.year, month, day });
  return thisYear.startOf("day") >= today.startOf("day") ? today.year : today.year + 1;
}

/** Даты окна: «August 10-12, 2027», «Aug 10 to Aug 12», «May 8, 2027», «2027-08-10 to 2027-08-12», «next August». */
export function detectWindow(t: string, today: DateTime): { start: string | null; end: string | null; monthHint: string | null } {
  const s = t.toLowerCase();
  const isoR = s.match(/(\d{4}-\d{2}-\d{2})(?:\s*(?:to|-|–|through|until)\s*(\d{4}-\d{2}-\d{2}))?/);
  if (isoR) return { start: isoR[1], end: isoR[2] ?? isoR[1], monthHint: null };
  const range = s.match(new RegExp(`${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to|through)\\s*(?:${MON_RE}\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`));
  if (range) {
    const m1 = monthIdx(range[1]); const m2 = range[3] ? monthIdx(range[3]) : m1;
    const d1 = Number(range[2]); const d2 = Number(range[4]);
    const y = range[5] ? Number(range[5]) : upcomingYear(m1, d1, today);
    const y2 = m2 < m1 ? y + 1 : y;
    const a = iso(y, m1, d1); const b = iso(y2, m2, d2);
    if (a && b) return { start: a, end: b, monthHint: null };
  }
  const single = s.match(new RegExp(`${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`));
  if (single && Number(single[2]) <= 31) {
    const m = monthIdx(single[1]); const d = Number(single[2]);
    const y = single[3] ? Number(single[3]) : upcomingYear(m, d, today);
    const a = iso(y, m, d);
    if (a) return { start: a, end: a, monthHint: null };
  }
  const month = s.match(new RegExp(`(?:next|in|this|during)\\s+${MON_RE}(?:\\s+(\\d{4}))?`));
  if (month) {
    const m = monthIdx(month[1]);
    const y = month[2] ? Number(month[2]) : (m > today.month ? today.year : today.year + 1);
    return { start: null, end: null, monthHint: `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}` };
  }
  return { start: null, end: null, monthHint: null };
}

const UNIT_NORM: [RegExp, string][] = [[/^(knots?|kn|kts?)$/, "kn"], [/^(in|inch|inches|")$/, "in"], [/^(°?\s?f|degrees?(?: f(?:ahrenheit)?)?|fahrenheit)$/, "°F"], [/^mph$/, "mph"]];
export function detectThreshold(t: string): { operator: "BELOW" | "ABOVE" | null; thresholdX100: number | null; unit: string | null } {
  const s = t.toLowerCase();
  const m = s.match(/\b(below|under|less than|lower than|weaker than|above|over|more than|greater than|exceeds?|exceeding|at least|higher than)\s+(\d{1,4}(?:\.\d{1,2})?)\s*(knots?|kn|kts?|inches|inch|in\b|"|°\s?f|degrees(?: f(?:ahrenheit)?)?|fahrenheit|mph)?/);
  let operator: "BELOW" | "ABOVE" | null = null;
  if (/too (weak|calm|light)|no wind|windless|not enough wind|calm/.test(s)) operator = "BELOW";
  if (/too (hot|much rain|wet)|heavy rain|heatwave|rain(s|ed)? (on|out)/.test(s)) operator = "ABOVE";
  if (!m) return { operator, thresholdX100: null, unit: null };
  operator = /below|under|less|lower|weaker/.test(m[1]) ? "BELOW" : "ABOVE";
  let unit: string | null = null;
  if (m[3]) for (const [re, u] of UNIT_NORM) if (re.test(m[3].trim())) unit = u;
  return { operator, thresholdX100: parseDecimalX100(m[2]), unit };
}

export function detectMoney(t: string): { desiredPayoutCents: number | null; budgetCents: number | null } {
  let payout: number | null = null; let budget: number | null = null;
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\s*(k\b)?/gi;
  for (const m of t.matchAll(re)) {
    let cents = parseUsdToCents(`${m[1]}${m[2] ? "." + m[2] : ""}`);
    if (cents === null) continue;
    if (m[3]) cents *= 1000;
    const before = t.slice(Math.max(0, (m.index ?? 0) - 40), m.index).toLowerCase();
    if (/budget|spend|pay (?:up to|at most)|up to|no more than|at most|afford/.test(before) && budget === null) budget = cents;
    else if (payout === null) payout = cents;
  }
  return { desiredPayoutCents: payout, budgetCents: budget };
}

export function extract(text: string, today: DateTime): IntentFields {
  const category = detectCategory(text);
  const place = findPlace(text);
  const w = detectWindow(text, today);
  const th = detectThreshold(text);
  const money = detectMoney(text);
  const tpl = CATEGORY_TEMPLATE[category] ? TEMPLATES[CATEGORY_TEMPLATE[category]!] : null;
  return {
    category, placeKey: place?.key ?? null, placeText: place?.name ?? null, stationId: null,
    windowStartLocal: w.start, windowEndLocal: w.end, timezone: place?.timezone ?? null, monthHint: w.monthHint,
    operator: th.operator ?? tpl?.operator ?? null, thresholdX100: th.thresholdX100, unit: th.unit ?? tpl?.unit ?? null, metric: tpl?.metric ?? null,
    ...money,
  };
}

/** Локальные даты окна → UTC: начало первого дня и начало дня после последнего, в часовом поясе события. */
export function windowToUtc(startLocal: string, endLocal: string, tz: string): { startUtc: Date; endUtc: Date } {
  const a = DateTime.fromISO(startLocal, { zone: tz }).startOf("day");
  const b = DateTime.fromISO(endLocal, { zone: tz }).startOf("day").plus({ days: 1 });
  return { startUtc: a.toUTC().toJSDate(), endUtc: b.toUTC().toJSDate() };
}
export const utcToLocalDate = (d: Date, tz: string) => DateTime.fromJSDate(d).setZone(tz).toISODate();

/** Сборка намерения: незаполненные поля, базисный риск, статус. Сервер всегда пересчитывает это сам. */
export function build(f: IntentFields, today: DateTime): BuiltIntent {
  const templateCode = CATEGORY_TEMPLATE[f.category] ?? null;
  const tpl = templateCode ? TEMPLATES[templateCode] : null;
  const place: Place | null = placeByKey(f.placeKey);
  const unresolved: Unresolved[] = [];
  const basisRisk: string[] = [];
  if (!tpl) unresolved.push({ field: "category", question: "We support wind, rain and temperature events in simulation. Which weather outcome worries you?" });
  if (!place) unresolved.push({ field: "place", question: "Where is the event? Pick a supported location." });
  const station = place ? stationOf(place.key, f.stationId) : null;
  if (place && !station) unresolved.push({ field: "station", question: `Which observation station should decide the outcome? We will not pick one for you. Options near ${place.name}: ${place.stations.map((s) => s.id).join(", ")}.` });
  let startUtc: Date | null = null; let endUtc: Date | null = null;
  if (!f.windowStartLocal || !f.windowEndLocal) unresolved.push({ field: "window", question: f.monthHint ? `Which exact days in ${f.monthHint}?` : "What are the exact start and end dates?" });
  else {
    const a = DateTime.fromISO(f.windowStartLocal); const b = DateTime.fromISO(f.windowEndLocal);
    if (!a.isValid || !b.isValid || b < a) unresolved.push({ field: "window", question: "The end date must be on or after the start date." });
    else if (b.diff(a, "days").days > 30) unresolved.push({ field: "window", question: "Simulation windows are limited to 31 days." });
    else if (a < today.startOf("day")) unresolved.push({ field: "window", question: "The window must start today or later." });
    else if (place) ({ startUtc, endUtc } = windowToUtc(f.windowStartLocal, f.windowEndLocal, place.timezone));
  }
  if (tpl && f.thresholdX100 === null) unresolved.push({ field: "threshold", question: tpl.code === "WIND_LOW" ? "Below what average wind speed (knots) would the event count as too calm?" : tpl.code === "RAIN_HIGH" ? "Above how many inches of rain would it count?" : "Above what temperature (°F) would it count?" });
  if (tpl && tpl.code !== "CONSTRUCTION_DELAY" && f.unit && f.unit !== tpl.unit) unresolved.push({ field: "unit", question: `This template measures in ${tpl.unit}. Please restate the threshold in ${tpl.unit}.` });
  if (f.desiredPayoutCents === null) unresolved.push({ field: "payout", question: "How much would you like to receive if the event happens?" });
  if (station) basisRisk.push(station.note);
  basisRisk.push("A payout depends only on the official index at the chosen station, not on your actual costs or losses.");
  if (place && f.placeText && place.name !== f.placeText) basisRisk.push(`You mentioned "${f.placeText}"; the contract is measured for ${place.name}.`);
  const manipulationRisk = !!tpl?.manipulationRisk;
  const confidence = Math.max(10, 100 - unresolved.length * 15);
  return {
    ...f, timezone: place?.timezone ?? f.timezone, operator: tpl?.operator ?? f.operator, unit: tpl?.unit ?? f.unit, metric: tpl?.metric ?? f.metric,
    templateCode, startUtc, endUtc, unresolved, basisRisk, manipulationRisk, confidence,
    status: unresolved.length ? "NEEDS_CLARIFICATION" : "READY_FOR_REVIEW",
  };
}

export function canonicalTerms(b: { templateCode: string | null; stationId: string | null; operator: string | null; thresholdX100: number | null; windowStartLocal: string | null; windowEndLocal: string | null; timezone: string | null }) {
  return { template: b.templateCode, station: b.stationId, operator: b.operator, thresholdX100: b.thresholdX100, start: b.windowStartLocal, end: b.windowEndLocal, timezone: b.timezone };
}
export const termsHashOf = (o: unknown) => createHash("sha256").update(stableStringify(o)).digest("hex").slice(0, 32);
export const canonicalKeyOf = (b: Parameters<typeof canonicalTerms>[0]) => [b.templateCode, b.stationId, b.operator, b.thresholdX100, b.windowStartLocal, b.windowEndLocal].join(":");
