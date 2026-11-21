/**
 * Стандартизированные шаблоны событийных контрактов (ТЗ v2, п. 7.1). Только симуляция.
 * Пороги — целые сотые единицы (800 = 8.00 kn). Агрегирование описано словами и реализовано в oracle.ts.
 */
export type TemplateCode = "WIND_LOW" | "RAIN_HIGH" | "TEMP_HIGH" | "CONSTRUCTION_DELAY";
export type Template = {
  code: TemplateCode; version: number; category: string; title: string; metric: string; operator: "BELOW" | "ABOVE"; unit: string;
  aggregation: string; outcomeYes: string; outcomeNo: string; missingDataPolicy: string; disputeWindowHours: number;
  approvalStatus: "SIM_APPROVED" | "RESEARCH_ONLY"; manipulationRisk: boolean; source: string; fallbackSource: string | null;
};

export const TEMPLATES: Record<TemplateCode, Template> = {
  WIND_LOW: {
    code: "WIND_LOW", version: 1, category: "WEATHER_WIND", title: "Low wind", metric: "wind_speed_daily_mean", operator: "BELOW", unit: "kn",
    aggregation: "Average of the daily mean wind speeds for every local calendar day in the window",
    outcomeYes: "The average daily mean wind speed is below the threshold", outcomeNo: "The average daily mean wind speed is at or above the threshold",
    missingDataPolicy: "If any day is missing at the primary station, use the fallback station for that day. If still missing, the event is not resolved and needs data review. Missing data is never treated as zero.",
    disputeWindowHours: 48, approvalStatus: "SIM_APPROVED", manipulationRisk: false, source: "Simulated station feed (demo)", fallbackSource: "Simulated fallback station feed (demo)",
  },
  RAIN_HIGH: {
    code: "RAIN_HIGH", version: 1, category: "WEATHER_RAIN", title: "Heavy rain", metric: "precipitation_total", operator: "ABOVE", unit: "in",
    aggregation: "Total precipitation over all local calendar days in the window",
    outcomeYes: "Total precipitation is above the threshold", outcomeNo: "Total precipitation is at or below the threshold",
    missingDataPolicy: "Fallback station for missing days; otherwise needs data review. Missing data is never treated as zero.",
    disputeWindowHours: 48, approvalStatus: "SIM_APPROVED", manipulationRisk: false, source: "Simulated station feed (demo)", fallbackSource: "Simulated fallback station feed (demo)",
  },
  TEMP_HIGH: {
    code: "TEMP_HIGH", version: 1, category: "WEATHER_TEMP", title: "High temperature", metric: "temperature_daily_max", operator: "ABOVE", unit: "°F",
    aggregation: "Highest daily maximum temperature over the window",
    outcomeYes: "The highest daily maximum is above the threshold", outcomeNo: "The highest daily maximum is at or below the threshold",
    missingDataPolicy: "Fallback station for missing days; otherwise needs data review.",
    disputeWindowHours: 48, approvalStatus: "SIM_APPROVED", manipulationRisk: false, source: "Simulated station feed (demo)", fallbackSource: "Simulated fallback station feed (demo)",
  },
  CONSTRUCTION_DELAY: {
    code: "CONSTRUCTION_DELAY", version: 1, category: "CONSTRUCTION_DELAY", title: "Construction delay (research only)", metric: "certificate_of_occupancy_issued", operator: "BELOW", unit: "flag",
    aggregation: "Whether a public certificate of occupancy record exists by the end of the window",
    outcomeYes: "No certificate of occupancy is published by the deadline", outcomeNo: "A certificate of occupancy is published by the deadline",
    missingDataPolicy: "Manual review of the public permit registry; no automatic resolution.",
    disputeWindowHours: 168, approvalStatus: "RESEARCH_ONLY", manipulationRisk: true, source: "Public permit registry (manual, demo)", fallbackSource: null,
  },
};

export const CATEGORY_TEMPLATE: Record<string, TemplateCode | undefined> = {
  WEATHER_WIND: "WIND_LOW", WEATHER_RAIN: "RAIN_HIGH", WEATHER_TEMP: "TEMP_HIGH", CONSTRUCTION_DELAY: "CONSTRUCTION_DELAY",
};

export const CATEGORY_LABEL: Record<string, string> = {
  WEATHER_WIND: "Wind", WEATHER_RAIN: "Rain", WEATHER_TEMP: "Temperature", CONSTRUCTION_DELAY: "Construction delay",
  FLIGHT_DELAY: "Flight delay", POWER_OUTAGE: "Power outage", OTHER: "Other",
};
