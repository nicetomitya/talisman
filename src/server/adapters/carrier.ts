import { emu, requireEmulatorAllowed } from "./emu";
import { err } from "../errors";
import { sha256 } from "../auth/crypto";

export type FinalQuoteInput = { quoteId: string; seq: number; carrierOrgId: string; productCode: string; premiumKop: number; tariffVersionId: string | null; requestFingerprint: string };
export interface CarrierAdapter {
  finalQuote(i: FinalQuoteInput): Promise<{ carrierQuoteId: string; premiumKop: number; validUntil: Date }>;
  signPolicy(docHash: string, carrierOrgId: string): Promise<{ signer: string; method: string; value: string; at: string }>;
  confirmConclusion(i: { policyNumber: string; paymentExternalId: string; startsAt: Date }): Promise<{ status: "CONCLUDED"; externalNumber: string; startsAt: Date } | { status: "PENDING" }>;
  terminate(i: { policyNumber: string; premiumKop: number; startsAt: Date; endsAt: Date; terminationDate: Date; coolingOff: boolean }): Promise<{ refundKop: number; effectiveAt: Date }>;
  parametricDecision(i: { claimNumber: string; outcome: string; finalData: boolean; payoutKop: number }): Promise<{ decision: "APPROVE" | "MANUAL"; reason: string }>;
}

/** Эмулятор страховщика. Поведение управляется демопанелью; ошибки и задержки — нормальные результаты, а не исключения кода. */
export const carrierEmulator: CarrierAdapter = {
  async finalQuote(i) {
    requireEmulatorAllowed("Carrier");
    const s = await emu();
    if (s.carrier.finalQuote === "unavailable") throw err("SOURCE_UNAVAILABLE", "Страховщик временно не отвечает (эмуляция)");
    const premiumKop = s.carrier.finalQuote === "price_changed" ? i.premiumKop + 50000 : i.premiumKop;
    return { carrierQuoteId: "DQ-" + sha256(`${i.quoteId}:${i.seq}`).slice(0, 10).toUpperCase(), premiumKop, validUntil: new Date(Date.now() + 24 * 3600_000) };
  },
  async signPolicy(docHash, carrierOrgId) {
    requireEmulatorAllowed("Carrier");
    return { signer: `DEMO_CARRIER:${carrierOrgId.slice(0, 8)}`, method: "DEMO_SIGNATURE (без юридической силы)", value: sha256(`carrier-sign:${carrierOrgId}:${docHash}`), at: new Date().toISOString() };
  },
  async confirmConclusion(i) {
    requireEmulatorAllowed("Carrier");
    const s = await emu();
    if (s.carrier.confirm === "error") throw err("SOURCE_UNAVAILABLE", "Страховщик вернул ошибку подтверждения (эмуляция)");
    if (s.carrier.confirm === "delay") return { status: "PENDING" };
    return { status: "CONCLUDED", externalNumber: "EXT-" + sha256(i.policyNumber).slice(0, 8).toUpperCase(), startsAt: i.startsAt };
  },
  async terminate(i) {
    requireEmulatorAllowed("Carrier");
    // Демо-правило: в период охлаждения — полный возврат; иначе пропорционально неистёкшему сроку.
    if (i.coolingOff || i.terminationDate <= i.startsAt) return { refundKop: i.premiumKop, effectiveAt: i.terminationDate };
    const total = BigInt(i.endsAt.getTime() - i.startsAt.getTime());
    const left = BigInt(Math.max(0, i.endsAt.getTime() - i.terminationDate.getTime()));
    const refund = Number((BigInt(i.premiumKop) * left) / total / 100n * 100n);
    return { refundKop: refund, effectiveAt: i.terminationDate };
  },
  async parametricDecision(i) {
    requireEmulatorAllowed("Carrier");
    if (i.outcome === "MET" && i.finalData) return { decision: "APPROVE", reason: "Условие выполнено по финальным данным в пределах автоматических полномочий (демо)" };
    return { decision: "MANUAL", reason: "Требуется рассмотрение уполномоченным специалистом страховщика" };
  },
};
