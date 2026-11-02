import { err } from "../errors";

/**
 * Таблицы допустимых переходов. Для каждого перехода — кто может его инициировать.
 * Роли: CLIENT, AGENT, OWNER, CARRIER, ADMIN, SUPPORT, SYSTEM (сервер/worker/эмулятор по серверному событию).
 * Побочные эффекты и компенсации реализованы в доменных модулях; здесь — единая проверка, вызываемая перед изменением.
 */
type Rule = { to: string; by: string[]; note?: string };
type Machine = Record<string, Rule[]>;

export const MACHINES = {
  request: {
    DRAFT: [{ to: "NEEDS_INFO", by: ["SYSTEM", "CLIENT"] }, { to: "OPEN", by: ["CLIENT", "SYSTEM"] }, { to: "CANCELLED", by: ["CLIENT"] }],
    NEEDS_INFO: [{ to: "OPEN", by: ["CLIENT", "SYSTEM"] }, { to: "DRAFT", by: ["CLIENT"] }, { to: "CANCELLED", by: ["CLIENT"] }],
    OPEN: [{ to: "SELECTION", by: ["SYSTEM"] }, { to: "CHECKOUT", by: ["CLIENT"] }, { to: "DRAFT", by: ["CLIENT"], note: "изменение существенных данных — новая версия" }, { to: "NEEDS_INFO", by: ["AGENT", "SYSTEM"] }, { to: "CANCELLED", by: ["CLIENT", "ADMIN"] }],
    SELECTION: [{ to: "CHECKOUT", by: ["CLIENT"] }, { to: "DRAFT", by: ["CLIENT"] }, { to: "OPEN", by: ["CLIENT"], note: "новый запрос/продление окна" }, { to: "CANCELLED", by: ["CLIENT", "SYSTEM"] }],
    CHECKOUT: [{ to: "COMPLETED", by: ["SYSTEM"] }, { to: "OPEN", by: ["SYSTEM"], note: "резерв освобождён при открытом окне" }, { to: "SELECTION", by: ["SYSTEM"] }, { to: "DRAFT", by: ["CLIENT"] }, { to: "CANCELLED", by: ["CLIENT", "SYSTEM"], note: "матч отменён до оплаты — дальше только новая заявка" }],
    COMPLETED: [],
    CANCELLED: [],
  },
  auction: {
    PREPARED: [{ to: "OPEN", by: ["SYSTEM", "CLIENT"] }],
    OPEN: [{ to: "EXTENDED", by: ["SYSTEM"] }, { to: "PAUSED", by: ["SYSTEM"] }, { to: "CLOSED", by: ["SYSTEM", "CLIENT"] }],
    EXTENDED: [{ to: "EXTENDED", by: ["SYSTEM"] }, { to: "PAUSED", by: ["SYSTEM"] }, { to: "CLOSED", by: ["SYSTEM", "CLIENT"] }],
    PAUSED: [{ to: "OPEN", by: ["SYSTEM"] }, { to: "EXTENDED", by: ["SYSTEM"] }, { to: "CLOSED", by: ["SYSTEM"] }],
    CLOSED: [],
  },
  quote: {
    DRAFT: [{ to: "PUBLISHED", by: ["AGENT", "OWNER", "SYSTEM"] }, { to: "WITHDRAWN", by: ["AGENT", "OWNER"] }, { to: "REPLACED", by: ["AGENT", "OWNER", "SYSTEM"] }, { to: "EXPIRED", by: ["SYSTEM"] }],
    PUBLISHED: [{ to: "REPLACED", by: ["AGENT", "OWNER", "SYSTEM"] }, { to: "WITHDRAWN", by: ["AGENT", "OWNER"] }, { to: "EXPIRED", by: ["SYSTEM"] }, { to: "SELECTED", by: ["CLIENT"] }],
    SELECTED: [{ to: "PUBLISHED", by: ["SYSTEM"], note: "резерв освобождён" }, { to: "EXPIRED", by: ["SYSTEM"] }, { to: "WITHDRAWN", by: ["SYSTEM"], note: "только через отмену оформления" }],
    REPLACED: [], WITHDRAWN: [], EXPIRED: [],
  },
  checkout: {
    RESERVED: [{ to: "CHECKING", by: ["CLIENT", "SYSTEM"] }, { to: "CANCELLED", by: ["CLIENT", "SYSTEM", "AGENT"] }],
    CHECKING: [{ to: "DOCUMENTS", by: ["SYSTEM"] }, { to: "CANCELLED", by: ["SYSTEM", "CLIENT"] }],
    DOCUMENTS: [{ to: "CLIENT_CONFIRMATION", by: ["CLIENT"] }, { to: "CANCELLED", by: ["CLIENT", "SYSTEM"] }],
    CLIENT_CONFIRMATION: [{ to: "PAYMENT", by: ["SYSTEM"] }, { to: "DOCUMENTS", by: ["SYSTEM"] }, { to: "CANCELLED", by: ["CLIENT", "SYSTEM"] }],
    PAYMENT: [{ to: "AWAITING_CARRIER", by: ["SYSTEM"] }, { to: "CANCELLED", by: ["CLIENT", "SYSTEM"], note: "только без успешной/неизвестной оплаты" }],
    AWAITING_CARRIER: [{ to: "COMPLETED", by: ["SYSTEM"] }],
    COMPLETED: [], CANCELLED: [],
  },
  contract: {
    PREPARED: [{ to: "CONCLUDED", by: ["SYSTEM"], note: "подтверждение страховщика" }, { to: "TERMINATED", by: ["SYSTEM"] }],
    CONCLUDED: [{ to: "TERMINATED", by: ["SYSTEM", "CARRIER"] }, { to: "EXPIRED", by: ["SYSTEM"] }],
    TERMINATED: [], EXPIRED: [],
  },
  eventCheck: {
    SCHEDULED: [{ to: "COLLECTING", by: ["SYSTEM"] }],
    COLLECTING: [{ to: "CALCULATED", by: ["SYSTEM"] }, { to: "NEEDS_DATA", by: ["SYSTEM"] }, { to: "SPECIALIST_REVIEW", by: ["SYSTEM"] }],
    NEEDS_DATA: [{ to: "COLLECTING", by: ["SYSTEM", "ADMIN"] }, { to: "SPECIALIST_REVIEW", by: ["SYSTEM", "ADMIN"] }],
    CALCULATED: [{ to: "COMPLETED", by: ["SYSTEM"] }, { to: "SPECIALIST_REVIEW", by: ["SYSTEM", "ADMIN"] }, { to: "COLLECTING", by: ["SYSTEM"], note: "исправленные наблюдения" }],
    SPECIALIST_REVIEW: [{ to: "COMPLETED", by: ["ADMIN", "CARRIER"] }, { to: "COLLECTING", by: ["ADMIN", "CARRIER", "SYSTEM"] }],
    COMPLETED: [{ to: "SPECIALIST_REVIEW", by: ["SYSTEM", "ADMIN"], note: "спор или исправление данных" }],
  },
  claim: {
    DRAFT: [{ to: "SUBMITTED", by: ["CLIENT", "SYSTEM"] }],
    SUBMITTED: [{ to: "REVIEWING", by: ["SYSTEM", "CARRIER", "ADMIN", "AGENT"] }, { to: "NEEDS_INFO", by: ["CARRIER", "ADMIN", "AGENT", "SYSTEM"] }],
    NEEDS_INFO: [{ to: "SUBMITTED", by: ["CLIENT"] }, { to: "REVIEWING", by: ["CARRIER", "ADMIN"] }],
    REVIEWING: [{ to: "DECISION_PREPARED", by: ["CARRIER", "ADMIN", "SYSTEM"] }, { to: "NEEDS_INFO", by: ["CARRIER", "ADMIN", "AGENT"] }],
    DECISION_PREPARED: [{ to: "APPROVED", by: ["CARRIER", "SYSTEM"] }, { to: "REJECTED", by: ["CARRIER"], note: "отказ только человеком с объяснением" }, { to: "REVIEWING", by: ["CARRIER", "ADMIN"] }],
    APPROVED: [{ to: "PAYOUT_IN_PROGRESS", by: ["SYSTEM", "CARRIER"] }],
    PAYOUT_IN_PROGRESS: [{ to: "PAID", by: ["SYSTEM"] }, { to: "APPROVED", by: ["SYSTEM"], note: "ошибка реквизитов → разбор" }],
    PAID: [{ to: "CLOSED", by: ["SYSTEM", "CARRIER", "ADMIN"] }, { to: "DISPUTED", by: ["CLIENT"] }],
    REJECTED: [{ to: "DISPUTED", by: ["CLIENT"] }, { to: "CLOSED", by: ["SYSTEM", "ADMIN"] }],
    DISPUTED: [{ to: "REVIEWING", by: ["CARRIER", "ADMIN"] }, { to: "CLOSED", by: ["CARRIER", "ADMIN"] }],
    CLOSED: [{ to: "DISPUTED", by: ["CLIENT"] }],
  },
  payment: {
    CREATED: [{ to: "PENDING", by: ["SYSTEM"] }, { to: "CANCELLED", by: ["SYSTEM", "CLIENT"] }, { to: "FAILED", by: ["SYSTEM"] }],
    PENDING: [{ to: "AUTHORIZED", by: ["SYSTEM"] }, { to: "SUCCEEDED", by: ["SYSTEM"] }, { to: "FAILED", by: ["SYSTEM"] }, { to: "CANCELLED", by: ["SYSTEM"] }, { to: "UNKNOWN", by: ["SYSTEM"] }],
    AUTHORIZED: [{ to: "SUCCEEDED", by: ["SYSTEM"] }, { to: "CANCELLED", by: ["SYSTEM"] }, { to: "UNKNOWN", by: ["SYSTEM"] }],
    UNKNOWN: [{ to: "SUCCEEDED", by: ["SYSTEM"] }, { to: "FAILED", by: ["SYSTEM"] }, { to: "CANCELLED", by: ["SYSTEM"] }],
    SUCCEEDED: [], FAILED: [], CANCELLED: [],
  },
  subscription: {
    TRIAL: [{ to: "ACTIVE", by: ["SYSTEM"] }, { to: "PAST_DUE", by: ["SYSTEM"] }, { to: "ENDED", by: ["SYSTEM", "OWNER"] }],
    ACTIVE: [{ to: "ACTIVE", by: ["SYSTEM"], note: "продление периода" }, { to: "PAST_DUE", by: ["SYSTEM"] }, { to: "ENDED", by: ["SYSTEM"] }],
    PAST_DUE: [{ to: "GRACE", by: ["SYSTEM"] }, { to: "ACTIVE", by: ["SYSTEM"] }],
    GRACE: [{ to: "ACTIVE", by: ["SYSTEM"] }, { to: "RESTRICTED", by: ["SYSTEM"] }],
    RESTRICTED: [{ to: "ACTIVE", by: ["SYSTEM"] }, { to: "ENDED", by: ["SYSTEM"] }],
    ENDED: [{ to: "ACTIVE", by: ["SYSTEM"] }],
  },
  product: {
    DRAFT: [{ to: "SUBMITTED_TO_CARRIER", by: ["OWNER", "AGENT", "ADMIN"] }],
    SUBMITTED_TO_CARRIER: [{ to: "CARRIER_APPROVED", by: ["CARRIER"] }, { to: "DRAFT", by: ["CARRIER"] }],
    CARRIER_APPROVED: [{ to: "PLATFORM_CHECKED", by: ["ADMIN"] }, { to: "DRAFT", by: ["ADMIN"] }],
    PLATFORM_CHECKED: [{ to: "PUBLISHED", by: ["ADMIN"] }],
    PUBLISHED: [{ to: "SUSPENDED", by: ["ADMIN", "CARRIER"] }, { to: "ARCHIVED", by: ["ADMIN"] }],
    SUSPENDED: [{ to: "PUBLISHED", by: ["ADMIN"] }, { to: "ARCHIVED", by: ["ADMIN"] }],
    ARCHIVED: [],
  },
} satisfies Record<string, Machine>;

export type MachineName = keyof typeof MACHINES;

export function canTransition(machine: MachineName, from: string, to: string, by: string): boolean {
  const rules = (MACHINES[machine] as Machine)[from] ?? [];
  return rules.some((r) => r.to === to && (r.by.includes(by) || (by === "ADMIN" && r.by.includes("SYSTEM") && false)));
}

export function assertTransition(machine: MachineName, from: string, to: string, by: string) {
  if (!canTransition(machine, from, to, by)) {
    throw err("INVALID_TRANSITION", `Переход ${machine}: ${from} → ${to} недопустим для роли ${by}`, { machine, from, to, by });
  }
}
