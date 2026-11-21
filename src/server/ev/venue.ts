import { db } from "../db";
import { err } from "../errors";
import { fixtureById } from "./fixtures";
import type { Level } from "./pricing";

/**
 * Интерфейс площадки (ТЗ v2, п. 13.2). Конкретный API выбирается после договора с регулируемым партнёром.
 * В P0 работает только MockVenueAdapter. ReadOnlyMarketDataAdapter не настроен и не возвращает данных
 * (никаких выдуманных рынков и цен). LicensedPartnerExecutionAdapter всегда отвечает INTEGRATION_NOT_CONFIGURED.
 */
export type Orderbook = { yesAsks: Level[]; noAsks: Level[]; takenAt: Date; sourceKind: "SIMULATED" | "LIVE"; source: string };
export type VenueStatus = { venue: string; configured: boolean; available: boolean; sourceKind: "SIMULATED" | "LIVE"; note: string };

export interface VenueAdapter {
  readonly name: string;
  getVenueStatus(): Promise<VenueStatus>;
  listMarketIds(): Promise<string[]>;
  getOrderbook(venueMarketId: string, at: Date): Promise<Orderbook>;
}
export interface ExecutionAdapter {
  readonly name: string;
  getCustomerEligibility(userId: string): Promise<{ eligible: false; reason: string }>;
  prepareOrder(input: unknown): Promise<never>;
  submitOrder(input: unknown): Promise<never>;
  getOrder(id: string): Promise<never>;
  cancelOrder(id: string): Promise<never>;
}

export const OUTAGE_KEY = "ev_mock_venue_outage";

export class MockVenueAdapter implements VenueAdapter {
  readonly name = "MOCK_VENUE";
  private async outage() { return !!((await db.setting.findUnique({ where: { key: OUTAGE_KEY } }))?.value as any)?.on; }
  async getVenueStatus(): Promise<VenueStatus> {
    const down = await this.outage();
    return { venue: this.name, configured: true, available: !down, sourceKind: "SIMULATED", note: down ? "Simulated venue is temporarily unavailable (demo outage)." : "Simulated venue with fixed demo data." };
  }
  async listMarketIds() { return (await db.venueMarket.findMany({ where: { venue: this.name }, select: { venueMarketId: true } })).map((m) => m.venueMarketId); }
  async getOrderbook(venueMarketId: string, at: Date): Promise<Orderbook> {
    if (await this.outage()) throw err("SOURCE_UNAVAILABLE", "The simulated venue is temporarily unavailable. No prices are shown until it is back.");
    const f = fixtureById(venueMarketId);
    if (!f) throw err("NOT_FOUND", "Market not found at the simulated venue");
    return { yesAsks: f.yesAsks, noAsks: f.noAsks, takenAt: f.frozenQuoteAt ? new Date(f.frozenQuoteAt) : at, sourceKind: "SIMULATED", source: "Mock venue (fixed demo order book)" };
  }
}

/** P1: только проверяемые внешние данные при наличии договора/условий API. Сейчас не настроен. */
export class ReadOnlyMarketDataAdapter implements VenueAdapter {
  readonly name = "READONLY_MARKET_DATA";
  async getVenueStatus(): Promise<VenueStatus> {
    return { venue: this.name, configured: false, available: false, sourceKind: "LIVE", note: "No external market-data source is connected. Talisman shows no real markets or prices until a verified source is configured." };
  }
  async listMarketIds() { return []; }
  async getOrderbook(): Promise<Orderbook> { throw err("INTEGRATION_NOT_CONFIGURED", "External market data is not connected"); }
}

/** P3: исполнение только через регулируемого партнёра после юридического gate. Заглушка contract-first. */
export class LicensedPartnerExecutionAdapter implements ExecutionAdapter {
  readonly name = "LICENSED_PARTNER_EXECUTION";
  private no(): never { throw err("INTEGRATION_NOT_CONFIGURED", "Real-money trading is not available. No regulated partner is connected and live trading is disabled."); }
  async getCustomerEligibility() { return { eligible: false as const, reason: "NO_PARTNER" }; }
  async prepareOrder(): Promise<never> { this.no(); }
  async submitOrder(_input?: unknown): Promise<never> { this.no(); }
  async getOrder(): Promise<never> { this.no(); }
  async cancelOrder(): Promise<never> { this.no(); }
}

export const mockVenue = new MockVenueAdapter();
export const readOnlyMarketData = new ReadOnlyMarketDataAdapter();
export const partnerExecution = new LicensedPartnerExecutionAdapter();

/** Флаг live trading: по умолчанию выключен; даже включённый не создаёт маршрута — нужен отдельный модуль (P3). */
export const liveTradingEnabled = () => process.env.LIVE_TRADING_ENABLED === "true";
/** В этой сборке нет ни одного маршрута отправки реального ордера, независимо от флага (крит. 10). */
export const LIVE_ORDER_ROUTE_EXISTS = false;

/**
 * Трактовка ответа партнёра (на будущее, крит. 13): успех — только FILLED/PARTIALLY_FILLED с квитанцией партнёра.
 * REJECTED, PENDING, ACCEPTED без исполнения, неизвестный статус — не успех.
 */
export function interpretPartnerAck(ack: { status?: string; venueOrderId?: string | null; filledUnits?: number | null } | null | undefined): "FILLED" | "PARTIALLY_FILLED" | "NOT_EXECUTED" | "RECONCILIATION_PENDING" {
  if (!ack || !ack.status) return "RECONCILIATION_PENDING";
  if (!ack.venueOrderId) return "RECONCILIATION_PENDING";
  if (ack.status === "FILLED" && (ack.filledUnits ?? 0) > 0) return "FILLED";
  if (ack.status === "PARTIALLY_FILLED" && (ack.filledUnits ?? 0) > 0) return "PARTIALLY_FILLED";
  if (ack.status === "REJECTED" || ack.status === "CANCELLED" || ack.status === "EXPIRED") return "NOT_EXECUTED";
  return "RECONCILIATION_PENDING";
}
