export type AppMode = "demo" | "production";

export function appMode(): AppMode {
  return process.env.APP_MODE === "production" ? "production" : "demo";
}
export const isDemo = () => appMode() === "demo";

export function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) {
    if (appMode() === "production") throw new Error("APP_SECRET обязателен в production (≥32 символов)");
    return "demo-only-secret-change-me-0123456789abcdef";
  }
  return s;
}

/** Демо-настройки прототипа. В P1 задаются продуктом/страховщиком. */
export const DEMO_RULES = {
  auctionWindowSec: 24 * 3600, // подбор предложений — сутки
  extendThresholdSec: 15 * 60, // улучшение в последние 15 минут…
  extendBySec: 15 * 60, // …продлевает на 15 минут…
  maxExtensionSec: 3600, // …но суммарно не больше часа
  minImprovementKop: 100_00,
  reservationMin: 120, // после матча: 2 часа на ознакомление, подпись и оплату
  matchRemindMin: [60, 15], // напоминания клиенту до конца срока оформления
  quoteValidityHours: 72,
  eventMinDaysBeforeStart: 14,
  uploadMaxBytes: 15 * 1024 * 1024,
  uploadMaxFiles: 10,
  graceDays: 7,
  trialDays: 14,
  retryPaymentHours: [24, 72, 144],
  distributionRateBp: 1500, // 15% премии
  platformShareBp: 2000, // 20% от вознаграждения
  coolingOffDays: 14,
  otpTtlMin: 10,
  otpMaxAttempts: 5,
  sessionDays: 7,
  loginMaxFailures: 5,
  loginLockMin: 15,
  clientMaxActiveEventPayoutKop: 50_000_00,
  concentrationMaxPerCellDay: 25,
  showCompetitorMinPrice: false,
};
