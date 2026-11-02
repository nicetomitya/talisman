/** Подсказка для интерфейса: какие действия показать. Окончательная проверка — машина состояний на сервере. */
export function staffActionsFor(status: string, role: "AGENT" | "CARRIER" | "ADMIN"): string[] {
  const m: Record<string, Record<string, string[]>> = {
    AGENT: { SUBMITTED: ["START_REVIEW", "REQUEST_INFO"], REVIEWING: ["REQUEST_INFO"] },
    CARRIER: { SUBMITTED: ["START_REVIEW", "REQUEST_INFO"], NEEDS_INFO: ["START_REVIEW"], REVIEWING: ["PREPARE_APPROVE", "PREPARE_REJECT", "REQUEST_INFO"], DECISION_PREPARED: ["APPROVE", "REJECT", "START_REVIEW"], DISPUTED: ["REOPEN", "CLOSE"], PAID: ["CLOSE"] },
    ADMIN: { SUBMITTED: ["START_REVIEW", "REQUEST_INFO"], NEEDS_INFO: ["START_REVIEW"], REVIEWING: ["PREPARE_APPROVE", "PREPARE_REJECT", "REQUEST_INFO"], DECISION_PREPARED: ["START_REVIEW"], DISPUTED: ["REOPEN", "CLOSE"], PAID: ["CLOSE"], REJECTED: ["CLOSE"] },
  };
  return m[role][status] ?? [];
}
