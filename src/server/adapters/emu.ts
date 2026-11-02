import { db } from "../db";
import { appMode } from "../config";
import { err } from "../errors";

/** Управляемые режимы эмуляторов (меняются из демопанели). */
export type EmuSettings = {
  carrier: { finalQuote: "ok" | "unavailable" | "price_changed"; confirm: "ok" | "delay" | "error" };
  payment: { webhookDelaySec: number; duplicateWebhook: boolean };
  weather: { RAIN01: string; WIND01: string; unavailable: string[] };
  antivirus: { mode: "demo_clean" | "unavailable" };
  tariffs: { stale: boolean };
};
export const EMU_DEFAULTS: EmuSettings = {
  carrier: { finalQuote: "ok", confirm: "ok" },
  payment: { webhookDelaySec: 0, duplicateWebhook: false },
  weather: { RAIN01: "r52", WIND01: "w_met", unavailable: [] },
  antivirus: { mode: "demo_clean" },
  tariffs: { stale: false },
};

export async function emu(): Promise<EmuSettings> {
  const s = await db.setting.findUnique({ where: { key: "emulators" } });
  const v = (s?.value ?? {}) as any;
  return {
    carrier: { ...EMU_DEFAULTS.carrier, ...(v.carrier ?? {}) },
    payment: { ...EMU_DEFAULTS.payment, ...(v.payment ?? {}) },
    weather: { ...EMU_DEFAULTS.weather, ...(v.weather ?? {}) },
    antivirus: { ...EMU_DEFAULTS.antivirus, ...(v.antivirus ?? {}) },
    tariffs: { ...EMU_DEFAULTS.tariffs, ...(v.tariffs ?? {}) },
  };
}

export async function setEmu(patch: Partial<{ [K in keyof EmuSettings]: Partial<EmuSettings[K]> }>) {
  const cur = await emu();
  const next: any = { ...cur };
  for (const [k, v] of Object.entries(patch)) next[k] = { ...(cur as any)[k], ...(v as object) };
  await db.setting.upsert({ where: { key: "emulators" }, update: { value: next }, create: { key: "emulators", value: next } });
  return next as EmuSettings;
}

/** Эмуляторы допустимы только в demo. В production без настроенного провайдера операция блокируется. */
export function requireEmulatorAllowed(adapter: string) {
  if (appMode() !== "demo") throw err("INTEGRATION_NOT_CONFIGURED", `Адаптер ${adapter} не настроен для боевого режима; эмулятор запрещён`);
}
