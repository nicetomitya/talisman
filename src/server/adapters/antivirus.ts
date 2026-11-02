import { emu, requireEmulatorAllowed } from "./emu";

export interface AntivirusAdapter { scan(buf: Buffer): Promise<{ clean: boolean; note: string }> }

/** Эмулятор антивируса: реальная проверка сигнатуры EICAR, остальное — «чисто (деморежим)». */
export const antivirusEmulator: AntivirusAdapter = {
  async scan(buf) {
    requireEmulatorAllowed("Antivirus");
    const mode = (await emu()).antivirus.mode;
    if (mode === "unavailable") throw new Error("ANTIVIRUS_UNAVAILABLE");
    if (buf.includes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"))) return { clean: false, note: "Обнаружена тестовая сигнатура EICAR" };
    return { clean: true, note: "Проверка в деморежиме: угроз не найдено" };
  },
};
