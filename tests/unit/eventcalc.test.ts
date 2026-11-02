import { describe, it, expect } from "vitest";
import { buildWindow, evaluate, counterToIncrements, type EventTerms } from "@/server/domain/eventcalc";

const rain: EventTerms = { metric: "PRECIP_MM", unit: "мм", aggregation: "SUM_GTE", thresholdX100: 500, intervalMinutes: 60, primary: { source: "P", stationId: "1", lat: 0, lon: 0 }, backup: { source: "B", stationId: "2", lat: 0, lon: 0 }, maxDistanceKm: 10, payoutKop: 1, premiumKop: 1, conflictToleranceX100: 50, finalizationDelayHours: 24, ruleVersion: "t" };
const wind: EventTerms = { ...rain, metric: "WIND_MS", unit: "м/с", aggregation: "COUNT_LT", thresholdX100: 300, minIntervals: 3 };
const w = buildWindow("2027-06-19", "14:00", "20:00", "Europe/Moscow", 60); // 6 интервалов
const map = (vals: (number | null)[], win = w) => new Map(win.intervals.map((iv, i) => [iv.start.getTime(), vals[i]] as [number, number | null]).filter(([, v]) => v !== null) as [number, number][]);

describe("RAIN01: сумма осадков ≥ 5.0 мм", () => {
  it("5.2 мм — условие выполнено", () => expect(evaluate(rain, w, map([100, 100, 100, 100, 100, 20]), new Map()).outcome).toBe("MET"));
  it("ровно 5.0 мм — выполнено (граница включительно)", () => expect(evaluate(rain, w, map([100, 100, 100, 100, 100, 0]), new Map()).outcome).toBe("MET"));
  it("4.9 мм — не выполнено", () => { const e = evaluate(rain, w, map([100, 100, 100, 100, 90, 0]), new Map()); expect(e.outcome).toBe("NOT_MET"); expect(e.aggregateX100).toBe(490); });
  it("пропуск основного источника закрывается резервным", () => {
    const e = evaluate(rain, w, map([100, null, 100, 100, 100, 20]), map([null, 100, null, null, null, null]));
    expect(e.outcome).toBe("MET");
    expect(e.intervals[1].source).toBe("B");
  });
  it("пропуск в обоих источниках — NEEDS_DATA, а не отказ (пропуск ≠ ноль)", () => expect(evaluate(rain, w, map([100, null, 100, 100, 100, 20]), new Map()).outcome).toBe("NEEDS_DATA"));
  it("расхождение источников с разным итогом — CONFLICT", () => expect(evaluate(rain, w, map([100, 100, 100, 100, 100, 20]), map([0, 0, 0, 0, 0, 0])).outcome).toBe("CONFLICT"));
  it("накопительный счётчик переводится в приращения без двойного суммирования", () => {
    const base = w.intervals[0].start.getTime();
    const inc = counterToIncrements([0, 1, 2, 3].map((i) => ({ at: new Date(base + i * 3600_000), counterX100: [1000, 1100, 1250, 1250][i] })), 60);
    expect(inc.map((x) => x.valueX100)).toEqual([100, 150, 0]);
  });
});

describe("WIND01: ветер < 3.0 м/с минимум в 3 из 4 часов", () => {
  const w4 = buildWindow("2027-06-20", "11:00", "15:00", "Europe/Moscow", 60);
  it("три часа слабее порога — выполнено", () => expect(evaluate(wind, w4, map([200, 250, 290, 500], w4), new Map()).outcome).toBe("MET"));
  it("ровно 3.0 м/с не считается «слабее»", () => expect(evaluate(wind, w4, map([300, 300, 250, 250], w4), new Map()).outcome).toBe("NOT_MET"));
  it("пропуск данных не трактуется как штиль", () => expect(evaluate(wind, w4, map([200, 250, null, 500], w4), new Map()).outcome).toBe("NEEDS_DATA"));
});

describe("Часовые пояса и переход часов", () => {
  it("окно Москвы переводится в UTC точно", () => { expect(w.startUtc.toISOString()).toBe("2027-06-19T11:00:00.000Z"); expect(w.intervals).toHaveLength(6); });
  it("несуществующее местное время отвергается", () => expect(() => buildWindow("2027-03-28", "02:30", "04:00", "Europe/Berlin", 60)).toThrow(/не существует/));
  it("неоднозначное время требует явного выбора", () => {
    expect(() => buildWindow("2027-10-31", "02:30", "05:00", "Europe/Berlin", 60)).toThrow(/неоднозначно/);
    const a = buildWindow("2027-10-31", "02:30", "05:00", "Europe/Berlin", 60, "earlier");
    const b = buildWindow("2027-10-31", "02:30", "05:00", "Europe/Berlin", 60, "later");
    expect(b.startUtc.getTime() - a.startUtc.getTime()).toBe(3600_000);
  });
});
