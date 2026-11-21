/**
 * Сопоставление намерения с листингованными контрактами: EXACT / PARTIAL / NONE (ТЗ v2, п. 6.2).
 * Оценка уверенности — в совпадении условий, не в исходе события. COMPOSITE — backlog (D24).
 */
export const MATCH_VERSION = "ev-match-1";
export type MarketTerms = { templateCode: string; placeKey: string; stationId: string; operator: string; thresholdX100: number; windowStartLocal: string; windowEndLocal: string; timezone: string; unit: string };
export type DraftTerms = { templateCode: string | null; placeKey: string | null; stationId: string | null; operator: string | null; thresholdX100: number | null; windowStartLocal: string | null; windowEndLocal: string | null };
export type Tag = "STATION" | "THRESHOLD" | "WINDOW" | "WINDOW_NO_OVERLAP" | "UNCONFIRMED_TERMS" | "MARKET_SUSPENDED" | "MARKET_CLOSED" | "RESEARCH_ONLY" | "RESTRICTED" | "MANIPULATION_RISK";
export type MatchResult = { marketId: string; exactness: "EXACT" | "PARTIAL"; tags: Tag[]; explanation: string; confidence: number; tradable: boolean };

const overlap = (a1: string, a2: string, b1: string, b2: string) => a1 <= b2 && b1 <= a2;

export function matchOne(d: DraftTerms, m: MarketTerms & { id: string; status: string; complianceStatus: string; manipulationRisk: boolean }): MatchResult | null {
  if (!d.templateCode || d.templateCode !== m.templateCode) return null;
  if (!d.placeKey || d.placeKey !== m.placeKey) return null;
  const tags: Tag[] = []; const why: string[] = [];
  if (!d.stationId || d.thresholdX100 === null || !d.windowStartLocal || !d.windowEndLocal) { tags.push("UNCONFIRMED_TERMS"); why.push("Some of your terms are not confirmed yet, so this cannot be an exact match."); }
  if (d.stationId && d.stationId !== m.stationId) { tags.push("STATION"); why.push(`This contract is measured at ${m.stationId}, not at ${d.stationId}.`); }
  if (d.thresholdX100 !== null && d.thresholdX100 !== m.thresholdX100) { tags.push("THRESHOLD"); why.push("The contract threshold differs from yours."); }
  if (d.windowStartLocal && d.windowEndLocal) {
    if (!overlap(d.windowStartLocal, d.windowEndLocal, m.windowStartLocal, m.windowEndLocal)) { tags.push("WINDOW_NO_OVERLAP"); why.push("The contract dates do not overlap your dates."); }
    else if (d.windowStartLocal !== m.windowStartLocal || d.windowEndLocal !== m.windowEndLocal) { tags.push("WINDOW"); why.push(`The contract covers ${m.windowStartLocal} to ${m.windowEndLocal}, not exactly your dates.`); }
  }
  if (tags.includes("WINDOW_NO_OVERLAP")) return null;
  const termTags = tags.length;
  if (m.status === "SUSPENDED") { tags.push("MARKET_SUSPENDED"); why.push("Trading in this contract is suspended."); }
  if (m.status !== "OPEN" && m.status !== "SUSPENDED") { tags.push("MARKET_CLOSED"); why.push("This contract is no longer open."); }
  if (m.complianceStatus === "RESEARCH_ONLY" || m.complianceStatus === "BLOCKED") { tags.push("RESEARCH_ONLY"); why.push("Research only: paper positions are not available for this contract."); }
  if (m.complianceStatus === "RESTRICTED") { tags.push("RESTRICTED"); why.push("Restricted: you must declare any connection to the underlying project first."); }
  if (m.manipulationRisk) { tags.push("MANIPULATION_RISK"); why.push("The outcome could be influenced by a single party or non-public information."); }
  const exactness = termTags === 0 ? "EXACT" : "PARTIAL";
  return {
    marketId: m.id, exactness, tags,
    explanation: exactness === "EXACT" ? `All material terms match. ${why.join(" ")}`.trim() : why.join(" "),
    confidence: exactness === "EXACT" ? 95 : Math.max(20, 80 - termTags * 20),
    tradable: m.status === "OPEN" && (m.complianceStatus === "SIM_ALLOWED" || m.complianceStatus === "RESTRICTED"),
  };
}

export function matchAll(d: DraftTerms, markets: Parameters<typeof matchOne>[1][]) {
  const results = markets.map((m) => matchOne(d, m)).filter((x): x is MatchResult => !!x)
    .sort((a, b) => (a.exactness === b.exactness ? a.tags.length - b.tags.length : a.exactness === "EXACT" ? -1 : 1));
  const overall: "EXACT" | "PARTIAL" | "NONE" = results.some((r) => r.exactness === "EXACT") ? "EXACT" : results.length ? "PARTIAL" : "NONE";
  return { overall, results };
}
