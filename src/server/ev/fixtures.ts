import type { Level } from "./pricing";
import type { TemplateCode } from "./templates";

/**
 * Воспроизводимые рынки MockVenue (ТЗ v2, п. 13.2). Всё здесь — симуляция: цены и глубина вымышлены
 * и не являются котировками какой-либо реальной площадки. Наблюдения оракула — тоже демонстрационные.
 */
export type FixtureMarket = {
  venueMarketId: string; title: string; templateCode: TemplateCode; placeKey: string; stationId: string; fallbackStationId: string | null;
  operator: "BELOW" | "ABOVE"; thresholdX100: number; unit: string; windowStartLocal: string; windowEndLocal: string; timezone: string;
  eventRootKey: string; objectKey?: string; status: "OPEN" | "SUSPENDED"; complianceStatus: "SIM_ALLOWED" | "RESTRICTED" | "RESEARCH_ONLY";
  regulatoryNote: string; yesAsks: Level[]; noAsks: Level[]; frozenQuoteAt?: string;
  /** Демонстрационные суточные значения (сотые единицы) по дням окна; null — данных нет. */
  observations: Record<string, number | null>; fallbackObservations?: Record<string, number | null>;
};

const SIM_NOTE = "Simulation only. Not listed on any regulated exchange. No real money, no real orders.";

export const FIXTURE_MARKETS: FixtureMarket[] = [
  {
    venueMarketId: "SIM-WIND-NPT-20270810-8KN", title: "Newport, RI: average wind below 8 kn, Aug 10–12, 2027", templateCode: "WIND_LOW",
    placeKey: "newport-ri", stationId: "KUUU", fallbackStationId: "KPVD", operator: "BELOW", thresholdX100: 800, unit: "kn",
    windowStartLocal: "2027-08-10", windowEndLocal: "2027-08-12", timezone: "America/New_York", eventRootKey: "wind:newport-ri:2027-08-10",
    status: "OPEN", complianceStatus: "SIM_ALLOWED", regulatoryNote: SIM_NOTE,
    yesAsks: [[20, 3000], [22, 1500], [25, 1000]], noAsks: [[80, 4000], [82, 2000]],
    observations: { "2027-08-10": 650, "2027-08-11": 720, "2027-08-12": 910 }, fallbackObservations: { "2027-08-10": 700, "2027-08-11": 760, "2027-08-12": 950 },
  },
  {
    venueMarketId: "SIM-WIND-NPT-20270810-6KN", title: "Newport, RI: average wind below 6 kn, Aug 10–12, 2027", templateCode: "WIND_LOW",
    placeKey: "newport-ri", stationId: "KUUU", fallbackStationId: "KPVD", operator: "BELOW", thresholdX100: 600, unit: "kn",
    windowStartLocal: "2027-08-10", windowEndLocal: "2027-08-12", timezone: "America/New_York", eventRootKey: "wind:newport-ri:2027-08-10",
    status: "OPEN", complianceStatus: "SIM_ALLOWED", regulatoryNote: SIM_NOTE,
    yesAsks: [[9, 2000], [11, 2000]], noAsks: [[91, 3000]],
    observations: { "2027-08-10": 650, "2027-08-11": null, "2027-08-12": 910 },
  },
  {
    venueMarketId: "SIM-RAIN-AUS-20270508-050IN", title: "Austin, TX: more than 0.50 in of rain on May 8, 2027", templateCode: "RAIN_HIGH",
    placeKey: "austin-tx", stationId: "KAUS", fallbackStationId: "KATT", operator: "ABOVE", thresholdX100: 50, unit: "in",
    windowStartLocal: "2027-05-08", windowEndLocal: "2027-05-08", timezone: "America/Chicago", eventRootKey: "rain:austin-tx:2027-05-08",
    status: "OPEN", complianceStatus: "SIM_ALLOWED", regulatoryNote: SIM_NOTE,
    yesAsks: [[30, 2000], [33, 1000]], noAsks: [[68, 3000]],
    observations: { "2027-05-08": 112 },
  },
  {
    venueMarketId: "SIM-TEMP-CHI-20270701-95F", title: "Chicago, IL: high above 95°F during Jul 1–7, 2027", templateCode: "TEMP_HIGH",
    placeKey: "chicago-il", stationId: "KMDW", fallbackStationId: "KORD", operator: "ABOVE", thresholdX100: 9500, unit: "°F",
    windowStartLocal: "2027-07-01", windowEndLocal: "2027-07-07", timezone: "America/Chicago", eventRootKey: "temp:chicago-il:2027-07-01",
    status: "OPEN", complianceStatus: "SIM_ALLOWED", regulatoryNote: SIM_NOTE,
    yesAsks: [[15, 5000], [17, 5000]], noAsks: [[84, 8000]],
    observations: { "2027-07-01": 8800, "2027-07-02": 9100, "2027-07-03": 9300, "2027-07-04": 9000, "2027-07-05": 8700, "2027-07-06": 8900, "2027-07-07": 9200 },
  },
  {
    venueMarketId: "SIM-TEMP-PHX-20270615-115F", title: "Phoenix, AZ: high above 115°F during Jun 15–21, 2027", templateCode: "TEMP_HIGH",
    placeKey: "phoenix-az", stationId: "KPHX", fallbackStationId: null, operator: "ABOVE", thresholdX100: 11500, unit: "°F",
    windowStartLocal: "2027-06-15", windowEndLocal: "2027-06-21", timezone: "America/Phoenix", eventRootKey: "temp:phoenix-az:2027-06-15",
    status: "OPEN", complianceStatus: "SIM_ALLOWED", regulatoryNote: SIM_NOTE,
    yesAsks: [[12, 1000]], noAsks: [[87, 1000]], frozenQuoteAt: "2026-11-01T15:00:00Z",
    observations: {},
  },
  {
    venueMarketId: "SIM-RAIN-SAN-20270213-100IN", title: "San Diego, CA: more than 1.00 in of rain on Feb 13, 2027", templateCode: "RAIN_HIGH",
    placeKey: "san-diego-ca", stationId: "KSAN", fallbackStationId: null, operator: "ABOVE", thresholdX100: 100, unit: "in",
    windowStartLocal: "2027-02-13", windowEndLocal: "2027-02-13", timezone: "America/Los_Angeles", eventRootKey: "rain:san-diego-ca:2027-02-13",
    status: "SUSPENDED", complianceStatus: "SIM_ALLOWED", regulatoryNote: `${SIM_NOTE} Suspended in the demo to show the suspended state.`,
    yesAsks: [[10, 1000]], noAsks: [[89, 1000]],
    observations: {},
  },
  {
    venueMarketId: "SIM-CONSTR-AUS-OAKRIDGE-L14", title: "Austin, TX: Oak Ridge lot 14 home not completed by Jun 30, 2027 (research only)", templateCode: "CONSTRUCTION_DELAY",
    placeKey: "austin-tx", stationId: "AUSTIN-PERMITS", fallbackStationId: null, operator: "BELOW", thresholdX100: 100, unit: "flag",
    windowStartLocal: "2027-06-30", windowEndLocal: "2027-06-30", timezone: "America/Chicago", eventRootKey: "construction:austin-oak-ridge-lot-14", objectKey: "austin-oak-ridge-lot-14",
    status: "OPEN", complianceStatus: "RESTRICTED",
    regulatoryNote: `${SIM_NOTE} Manipulation risk: the developer, contractors and inspectors can influence or know the outcome. Live listing is not allowed. Paper positions require a conflict-of-interest declaration.`,
    yesAsks: [[40, 500], [45, 500]], noAsks: [[58, 500]],
    observations: {},
  },
];

/** Прошедшие демо-события: показывают предложенный исход, окно спора и симулированный расчёт. */
FIXTURE_MARKETS.push(
  {
    venueMarketId: "SIM-WIND-NPT-20261024-8KN", title: "Newport, RI: average wind below 8 kn, Oct 24–25, 2026", templateCode: "WIND_LOW",
    placeKey: "newport-ri", stationId: "KUUU", fallbackStationId: "KPVD", operator: "BELOW", thresholdX100: 800, unit: "kn",
    windowStartLocal: "2026-10-24", windowEndLocal: "2026-10-25", timezone: "America/New_York", eventRootKey: "wind:newport-ri:2026-10-24",
    status: "OPEN", complianceStatus: "SIM_ALLOWED", regulatoryNote: SIM_NOTE,
    yesAsks: [[35, 2000]], noAsks: [[63, 2000]], observations: { "2026-10-24": 540, "2026-10-25": 610 },
  },
  {
    venueMarketId: "SIM-RAIN-AUS-20261114-050IN", title: "Austin, TX: more than 0.50 in of rain on Nov 14, 2026", templateCode: "RAIN_HIGH",
    placeKey: "austin-tx", stationId: "KAUS", fallbackStationId: "KATT", operator: "ABOVE", thresholdX100: 50, unit: "in",
    windowStartLocal: "2026-11-14", windowEndLocal: "2026-11-14", timezone: "America/Chicago", eventRootKey: "rain:austin-tx:2026-11-14",
    status: "OPEN", complianceStatus: "SIM_ALLOWED", regulatoryNote: SIM_NOTE,
    yesAsks: [[25, 2000]], noAsks: [[73, 2000]], observations: { "2026-11-14": 30 },
  },
);

export const fixtureById = (id: string) => FIXTURE_MARKETS.find((m) => m.venueMarketId === id) ?? null;
