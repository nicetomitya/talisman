import { randomUUID } from "node:crypto";

export type ErrorCode =
  | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "NEEDS_INFO" | "QUOTE_EXPIRED"
  | "VERSION_CHANGED" | "CAPACITY_EXHAUSTED" | "ALREADY_DONE" | "LIMIT_EXCEEDED" | "SOURCE_UNAVAILABLE"
  | "RESULT_PENDING" | "INVALID_TRANSITION" | "CONFLICT" | "RATE_LIMITED" | "INTEGRATION_NOT_CONFIGURED"
  | "MFA_REQUIRED" | "CSRF" | "SUBSCRIPTION_RESTRICTED" | "SALES_SUSPENDED";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 422, NEEDS_INFO: 422, QUOTE_EXPIRED: 409,
  VERSION_CHANGED: 409, CAPACITY_EXHAUSTED: 409, ALREADY_DONE: 409, LIMIT_EXCEEDED: 429, SOURCE_UNAVAILABLE: 503,
  RESULT_PENDING: 202, INVALID_TRANSITION: 409, CONFLICT: 409, RATE_LIMITED: 429, INTEGRATION_NOT_CONFIGURED: 503,
  MFA_REQUIRED: 403, CSRF: 403, SUBSCRIPTION_RESTRICTED: 402, SALES_SUSPENDED: 423,
};

const NEXT: Partial<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: "Войдите заново.",
  FORBIDDEN: "Проверьте выбранную организацию или обратитесь к администратору.",
  NOT_FOUND: "Проверьте ссылку или вернитесь к списку.",
  QUOTE_EXPIRED: "Запросите актуальное подтверждение цены.",
  VERSION_CHANGED: "Обновите страницу: данные изменились.",
  CAPACITY_EXHAUSTED: "Выберите другое предложение.",
  ALREADY_DONE: "Операция уже выполнена — обновите страницу.",
  LIMIT_EXCEEDED: "Смените тариф или дождитесь нового периода.",
  SOURCE_UNAVAILABLE: "Повторите позже — источник недоступен.",
  RESULT_PENDING: "Результат уточняется, повторное действие не требуется.",
  RATE_LIMITED: "Слишком много попыток. Подождите и повторите.",
  MFA_REQUIRED: "Подтвердите вход вторым фактором в настройках.",
  SUBSCRIPTION_RESTRICTED: "Оплатите подписку, чтобы снова отправлять новые ответы.",
  SALES_SUSPENDED: "Продажи временно приостановлены; действующие полисы обслуживаются.",
};

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: Record<string, unknown>, public nextAction?: string) {
    super(message);
  }
  get status() { return STATUS[this.code]; }
}

export const err = (code: ErrorCode, message: string, details?: Record<string, unknown>) => new AppError(code, message, details);

export function newCorrelationId() { return randomUUID(); }

export function errorBody(e: AppError, correlationId: string) {
  return { error: { code: e.code, message: e.message, nextAction: e.nextAction ?? NEXT[e.code] ?? null, details: e.details ?? null, correlationId } };
}
