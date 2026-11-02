import { requireEmulatorAllowed } from "./emu";
import { numericCode } from "../auth/crypto";

export interface SignatureAdapter {
  /** Подготовка сессии подтверждения клиентом: одноразовый код доставляется по каналу (в демо — приватная демопочта). */
  prepare(): Promise<{ code: string; method: string }>;
}
export const signatureEmulator: SignatureAdapter = {
  async prepare() {
    requireEmulatorAllowed("Signature");
    return { code: numericCode(6), method: "DEMO_OTP_EMAIL (демонстрационный код, без юридической силы)" };
  },
};
