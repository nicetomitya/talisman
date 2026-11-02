/** Русские подписи статусов. Статус всегда сопровождается текстом (не только цветом). */
export const L: Record<string, Record<string, string>> = {
  request: { DRAFT: "Черновик", NEEDS_INFO: "Нужна информация", OPEN: "Открыта, идут предложения", SELECTION: "Ожидает вашего выбора", CHECKOUT: "Оформление", COMPLETED: "Завершена", CANCELLED: "Отменена" },
  auction: { PREPARED: "Подготовлены", OPEN: "Открыты", EXTENDED: "Продлены", PAUSED: "Приостановлены выбором", CLOSED: "Закрыты" },
  quote: { DRAFT: "Черновик", PUBLISHED: "Опубликовано", REPLACED: "Заменено", WITHDRAWN: "Отозвано", EXPIRED: "Истекло", SELECTED: "Выбрано" },
  checkout: { RESERVED: "Резерв", CHECKING: "Проверка", DOCUMENTS: "Документы", CLIENT_CONFIRMATION: "Подтверждение клиента", PAYMENT: "Оплата", AWAITING_CARRIER: "Ожидание страховщика", COMPLETED: "Завершено", CANCELLED: "Отменено" },
  contract: { PREPARED: "Подготовлен", CONCLUDED: "Заключён", TERMINATED: "Прекращён", EXPIRED: "Истёк" },
  coverage: { PENDING_START: "Начнёт действовать", ACTIVE: "Защита действует", ENDED: "Завершено", NONE: "Нет покрытия" },
  eventCheck: { SCHEDULED: "Запланирована", COLLECTING: "Сбор данных", NEEDS_DATA: "Проверяем данные", CALCULATED: "Рассчитано", SPECIALIST_REVIEW: "Проверка специалистом", COMPLETED: "Завершено" },
  claim: { DRAFT: "Черновик", SUBMITTED: "Подано", NEEDS_INFO: "Нужны сведения", REVIEWING: "Рассматривается", DECISION_PREPARED: "Решение подготовлено", APPROVED: "Одобрено", REJECTED: "Отказ с объяснением", PAYOUT_IN_PROGRESS: "Выплата выполняется", PAID: "Выплачено", DISPUTED: "Оспаривается", CLOSED: "Закрыто" },
  payment: { CREATED: "Создана", PENDING: "Ожидается", AUTHORIZED: "Авторизована", SUCCEEDED: "Успешно завершена", FAILED: "Неуспешна", CANCELLED: "Отменена", UNKNOWN: "Результат уточняется" },
  subscription: { TRIAL: "Пробная", ACTIVE: "Активна", PAST_DUE: "Ожидает оплаты", GRACE: "Льготный период", RESTRICTED: "Ограничена", ENDED: "Завершена" },
  product: { DRAFT: "Черновик", SUBMITTED_TO_CARRIER: "Направлен страховщику", CARRIER_APPROVED: "Согласован страховщиком", PLATFORM_CHECKED: "Проверен платформой", PUBLISHED: "Опубликован", SUSPENDED: "Приостановлен", ARCHIVED: "Архив" },
  verification: { PENDING: "На проверке", VERIFIED: "Проверено", REJECTED: "Отклонено", EXPIRED: "Проверка истекла" },
  commission: { ACCRUED: "Начислено", CONFIRMED: "Подтверждено", RECEIVED: "Получено", REVERSED: "Сторнировано" },
  doc: { QUARANTINE: "Проверяется (карантин)", CLEAN: "Проверен", REJECTED: "Отклонён", GENERATED: "Сформирован" },
  mandate: { ACTIVE: "Действует", REVOKED: "Отозвано", EXPIRED: "Истекло" },
};
export const label = (group: string, v: string | null | undefined) => (v ? L[group]?.[v] ?? v : "—");

export const PRODUCT_TITLES: Record<string, string> = { KASKO: "Каско", PROPERTY: "Квартира или дом", RAIN01: "Дождь на мероприятии", WIND01: "Недостаток ветра на парусном занятии" };
export const DOC_KINDS: Record<string, string> = {
  APPLICATION: "Заявление", OFFER: "Предложение", RULES: "Правила страхования", INDIVIDUAL_TERMS: "Индивидуальные условия", POLICY: "Полис",
  ACK: "Подтверждение ознакомления", PLATFORM: "Документ платформы", PAYMENT: "Платёжный документ", CLAIM: "Обращение", DECISION: "Решение", ATTACHMENT: "Приложение", UPLOAD: "Загруженный файл", INVOICE: "Счёт", ACT: "Акт",
};
