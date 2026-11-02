/**
 * Версионированные схемы анкет (страна × продукт × версия). Заявка хранит снимок схемы.
 * visibility: PUBLIC — видно агентам на доске до выбора (минимум для расчёта);
 *             AFTER_SELECTION — видно выбранному агентству/страховщику; PRIVATE — только клиенту и страховщику при оформлении.
 * key: ключевое поле — требует подтверждения клиентом (особенно при распознавании).
 * essential: изменение после публикации создаёт новую версию заявки и инвалидирует котировки.
 */
export type FieldType = "text" | "number" | "select" | "multiselect" | "date" | "time" | "boolean" | "textarea";
export type FormField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  keyField?: boolean;
  essential?: boolean;
  visibility: "PUBLIC" | "AFTER_SELECTION" | "PRIVATE";
  purpose: string;
  recipients: string[];
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  pattern?: string;
  hint?: string;
  step?: string;
};
export type FormSchemaDef = { productCode: string; version: number; country: string; title: string; sections: { title: string; fields: FormField[] }[] };

const REC_CALC = ["CARRIER", "AGENCY_BOARD"];
const REC_DEAL = ["CARRIER", "SELECTED_AGENCY"];

export const KASKO_V1: FormSchemaDef = {
  productCode: "KASKO", version: 1, country: "RU", title: "Каско",
  sections: [
    { title: "Автомобиль", fields: [
      { key: "car_make", label: "Марка", type: "text", required: true, keyField: true, essential: true, visibility: "PUBLIC", purpose: "Расчёт премии", recipients: REC_CALC },
      { key: "car_model", label: "Модель", type: "text", required: true, keyField: true, essential: true, visibility: "PUBLIC", purpose: "Расчёт премии", recipients: REC_CALC },
      { key: "car_year", label: "Год выпуска", type: "number", required: true, keyField: true, essential: true, min: 1995, max: 2027, visibility: "PUBLIC", purpose: "Расчёт премии", recipients: REC_CALC },
      { key: "car_value_rub", label: "Стоимость, ₽", type: "number", required: true, keyField: true, essential: true, min: 300000, max: 30000000, visibility: "PUBLIC", purpose: "Страховая сумма", recipients: REC_CALC },
      { key: "car_vin", label: "VIN", type: "text", required: true, keyField: true, essential: true, pattern: "^[A-HJ-NPR-Z0-9]{17}$", hint: "17 символов без I, O, Q", visibility: "AFTER_SELECTION", purpose: "Идентификация объекта в договоре", recipients: REC_DEAL },
      { key: "usage", label: "Использование", type: "select", required: true, essential: true, visibility: "PUBLIC", purpose: "Расчёт премии", recipients: REC_CALC, options: [
        { value: "PERSONAL", label: "Личное" }, { value: "TAXI", label: "Такси" }, { value: "RENTAL", label: "Сдаётся в аренду" } ] },
    ] },
    { title: "Собственник и водители", fields: [
      { key: "owner_name", label: "Собственник (ФИО)", type: "text", required: true, keyField: true, visibility: "PRIVATE", purpose: "Сторона договора", recipients: ["CARRIER"] },
      { key: "drivers_count", label: "Число водителей", type: "number", required: true, essential: true, min: 1, max: 5, visibility: "PUBLIC", purpose: "Расчёт премии", recipients: REC_CALC },
      { key: "min_driver_age", label: "Минимальный возраст водителя", type: "number", required: true, essential: true, min: 18, max: 90, visibility: "PUBLIC", purpose: "Расчёт премии", recipients: REC_CALC },
      { key: "min_experience", label: "Минимальный стаж, лет", type: "number", required: true, essential: true, min: 0, max: 70, visibility: "PUBLIC", purpose: "Расчёт премии", recipients: REC_CALC },
      { key: "claims_3y", label: "Страховых случаев за 3 года", type: "number", required: true, essential: true, min: 0, max: 10, visibility: "PUBLIC", purpose: "Страховая история в допустимом объёме", recipients: REC_CALC },
    ] },
    { title: "Условия", fields: [
      { key: "risks", label: "Риски", type: "multiselect", required: true, essential: true, visibility: "PUBLIC", purpose: "Объём покрытия", recipients: REC_CALC, options: [
        { value: "DAMAGE", label: "Ущерб" }, { value: "THEFT", label: "Угон и хищение" }, { value: "GLASS", label: "Стёкла" }, { value: "NATURAL", label: "Стихийные бедствия" } ] },
      { key: "territory", label: "Территория", type: "select", required: true, essential: true, visibility: "PUBLIC", purpose: "Объём покрытия", recipients: REC_CALC, options: [
        { value: "RU", label: "Россия" }, { value: "RU_REGION", label: "Регион регистрации" } ] },
      { key: "deductible_rub", label: "Франшиза, ₽", type: "select", required: true, essential: true, visibility: "PUBLIC", purpose: "Обязательное условие", recipients: REC_CALC, options: [
        { value: "0", label: "Без франшизы" }, { value: "15000", label: "15 000 ₽" }, { value: "30000", label: "30 000 ₽" } ] },
      { key: "allow_alt_deductible", label: "Готов рассмотреть другую франшизу как альтернативу", type: "boolean", required: false, visibility: "PUBLIC", purpose: "Допустимые альтернативы", recipients: REC_CALC },
      { key: "repair_method", label: "Способ урегулирования", type: "select", required: true, essential: true, visibility: "PUBLIC", purpose: "Объём покрытия", recipients: REC_CALC, options: [
        { value: "DEALER", label: "Ремонт у дилера" }, { value: "SERVICE", label: "Ремонт на СТОА страховщика" }, { value: "CASH", label: "Денежная выплата" } ] },
      { key: "start_date", label: "Дата начала", type: "date", required: true, essential: true, visibility: "PUBLIC", purpose: "Срок договора", recipients: REC_CALC },
      { key: "region", label: "Регион использования", type: "select", required: true, essential: true, visibility: "PUBLIC", purpose: "Территория продаж", recipients: REC_CALC, options: [
        { value: "RU-MOW", label: "Москва" }, { value: "RU-SPE", label: "Санкт-Петербург" }, { value: "RU-KDA", label: "Краснодарский край" } ] },
    ] },
  ],
};

export const PROPERTY_V1: FormSchemaDef = {
  productCode: "PROPERTY", version: 1, country: "RU", title: "Квартира или дом",
  sections: [
    { title: "Объект", fields: [
      { key: "city", label: "Город", type: "text", required: true, essential: true, visibility: "PUBLIC", purpose: "Территория", recipients: REC_CALC },
      { key: "address", label: "Адрес", type: "text", required: true, keyField: true, essential: true, visibility: "AFTER_SELECTION", purpose: "Идентификация объекта", recipients: REC_DEAL },
      { key: "property_type", label: "Тип", type: "select", required: true, essential: true, visibility: "PUBLIC", purpose: "Расчёт", recipients: REC_CALC, options: [{ value: "APARTMENT", label: "Квартира" }, { value: "HOUSE", label: "Дом" }] },
      { key: "area_m2", label: "Площадь, м²", type: "number", required: true, keyField: true, essential: true, min: 10, max: 1000, visibility: "PUBLIC", purpose: "Расчёт", recipients: REC_CALC },
      { key: "construction", label: "Конструкция", type: "select", required: true, essential: true, visibility: "PUBLIC", purpose: "Расчёт", recipients: REC_CALC, options: [{ value: "BRICK", label: "Кирпич" }, { value: "MONOLITH", label: "Монолит" }, { value: "PANEL", label: "Панель" }, { value: "WOOD", label: "Дерево" }] },
      { key: "year_built", label: "Год постройки", type: "number", required: true, essential: true, min: 1850, max: 2027, visibility: "PUBLIC", purpose: "Расчёт", recipients: REC_CALC },
      { key: "usage", label: "Использование", type: "select", required: true, essential: true, visibility: "PUBLIC", purpose: "Сдача в аренду и коммерческое использование — явно", recipients: REC_CALC, options: [{ value: "OWN", label: "Проживаю сам" }, { value: "RENT_OUT", label: "Сдаю в аренду" }, { value: "COMMERCIAL", label: "Коммерческое использование" }] },
    ] },
    { title: "Покрытие", fields: [
      { key: "cover_objects", label: "Что страхуем", type: "multiselect", required: true, essential: true, visibility: "PUBLIC", purpose: "Объём", recipients: REC_CALC, options: [{ value: "STRUCTURE", label: "Конструктив" }, { value: "FINISH", label: "Отделка" }, { value: "CONTENTS", label: "Имущество" }, { value: "LIABILITY", label: "Ответственность перед соседями" }] },
      { key: "value_rub", label: "Оценочная стоимость, ₽", type: "number", required: true, keyField: true, essential: true, min: 300000, max: 100000000, visibility: "PUBLIC", purpose: "Страховая сумма", recipients: REC_CALC },
      { key: "risks", label: "Риски", type: "multiselect", required: true, essential: true, visibility: "PUBLIC", purpose: "Объём", recipients: REC_CALC, options: [{ value: "FIRE", label: "Пожар" }, { value: "WATER", label: "Залив" }, { value: "THEFT", label: "Кража" }, { value: "NATURAL", label: "Стихийные бедствия" }] },
      { key: "deductible_rub", label: "Франшиза, ₽", type: "select", required: true, essential: true, visibility: "PUBLIC", purpose: "Обязательное условие", recipients: REC_CALC, options: [{ value: "0", label: "Без франшизы" }, { value: "5000", label: "5 000 ₽" }, { value: "10000", label: "10 000 ₽" }] },
      { key: "allow_alt_deductible", label: "Готов рассмотреть другую франшизу как альтернативу", type: "boolean", required: false, visibility: "PUBLIC", purpose: "Допустимые альтернативы", recipients: REC_CALC },
      { key: "start_date", label: "Дата начала", type: "date", required: true, essential: true, visibility: "PUBLIC", purpose: "Срок", recipients: REC_CALC },
    ] },
  ],
};

function eventSchema(code: "RAIN01" | "WIND01"): FormSchemaDef {
  const rain = code === "RAIN01";
  return {
    productCode: code, version: 1, country: "RU", title: rain ? "Дождь на мероприятии" : "Недостаток ветра на парусном занятии",
    sections: [
      { title: "Оплаченная услуга", fields: [
        { key: "booking_ref", label: "Номер бронирования", type: "text", required: true, keyField: true, essential: true, visibility: "AFTER_SELECTION", purpose: "Связь с расходами, проверка повторного покрытия", recipients: REC_DEAL },
        { key: "booking_vendor", label: rain ? "Площадка" : "Парусная школа", type: "text", required: true, keyField: true, essential: true, visibility: "PUBLIC", purpose: "Связь с расходами", recipients: REC_CALC },
        { key: "purchase_date", label: "Дата покупки", type: "date", required: true, keyField: true, essential: true, visibility: "PUBLIC", purpose: "Право на покрытие", recipients: REC_CALC },
        { key: "booking_cost_rub", label: "Стоимость, ₽", type: "number", required: true, keyField: true, essential: true, min: 500, max: 1000000, visibility: "PUBLIC", purpose: "Связь с расходами", recipients: REC_CALC },
      ] },
      { title: "Место и время", fields: [
        { key: "latitude", label: "Широта", type: "number", required: true, keyField: true, essential: true, min: -90, max: 90, step: "0.0001", visibility: "PUBLIC", purpose: "Привязка к точке измерения", recipients: REC_CALC },
        { key: "longitude", label: "Долгота", type: "number", required: true, keyField: true, essential: true, min: -180, max: 180, step: "0.0001", visibility: "PUBLIC", purpose: "Привязка к точке измерения", recipients: REC_CALC },
        { key: "event_date", label: "Дата события", type: "date", required: true, keyField: true, essential: true, visibility: "PUBLIC", purpose: "Окно наблюдения", recipients: REC_CALC },
        { key: "start_time", label: "Начало (местное время)", type: "time", required: true, essential: true, visibility: "PUBLIC", purpose: "Окно наблюдения", recipients: REC_CALC },
        { key: "end_time", label: "Окончание (местное время)", type: "time", required: true, essential: true, visibility: "PUBLIC", purpose: "Окно наблюдения", recipients: REC_CALC },
        { key: "timezone", label: "Часовой пояс", type: "select", required: true, essential: true, visibility: "PUBLIC", purpose: "Однозначные границы", recipients: REC_CALC, options: [{ value: "Europe/Moscow", label: "Europe/Moscow" }] },
      ] },
    ],
  };
}
export const RAIN01_V1 = eventSchema("RAIN01");
export const WIND01_V1 = eventSchema("WIND01");

export const FORM_SCHEMAS: FormSchemaDef[] = [KASKO_V1, PROPERTY_V1, RAIN01_V1, WIND01_V1];

export function allFields(s: FormSchemaDef): FormField[] {
  return s.sections.flatMap((x) => x.fields);
}

export type FieldIssue = { key: string; message: string };

/** Проверка анкеты перед публикацией. Возвращает проблемы рядом с полями (AC02). */
export function validateForm(schema: FormSchemaDef, data: Record<string, any>, confirmed: Record<string, any>): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const f of allFields(schema)) {
    const v = data[f.key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required) issues.push({ key: f.key, message: "Обязательное поле не заполнено" });
      continue;
    }
    const e = checkValue(f, v);
    if (e) { issues.push({ key: f.key, message: e }); continue; }
    if (f.keyField && confirmed[f.key]?.status !== "CONFIRMED") {
      issues.push({ key: f.key, message: confirmed[f.key]?.status === "LOW_CONFIDENCE" ? "Распознано с низкой уверенностью — проверьте и подтвердите" : "Подтвердите ключевое значение" });
    }
  }
  return issues;
}

export function checkValue(f: FormField, v: any): string | null {
  switch (f.type) {
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n)) return "Введите число";
      if (f.min !== undefined && n < f.min) return `Не меньше ${f.min}`;
      if (f.max !== undefined && n > f.max) return `Не больше ${f.max}`;
      return null;
    }
    case "select": return f.options!.some((o) => o.value === String(v)) ? null : "Выберите значение из списка";
    case "multiselect": return Array.isArray(v) && v.every((x) => f.options!.some((o) => o.value === x)) ? null : "Недопустимое значение";
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? null : "Формат ГГГГ-ММ-ДД";
    case "time": return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? null : "Формат ЧЧ:ММ";
    case "boolean": return typeof v === "boolean" ? null : "Да или нет";
    default: {
      const s = String(v);
      if (s.length > 500) return "Слишком длинное значение";
      if (f.pattern && !new RegExp(f.pattern).test(s.toUpperCase())) return f.hint ?? "Неверный формат";
      return null;
    }
  }
}

/** Данные, видимые агентам на доске до выбора (без паспорта, контактов, точного адреса, VIN, номера брони). */
export function publicView(schema: FormSchemaDef, data: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of allFields(schema)) if (f.visibility === "PUBLIC" && data[f.key] !== undefined) out[f.key] = data[f.key];
  return out;
}
export function dealView(schema: FormSchemaDef, data: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of allFields(schema)) if (f.visibility !== "PRIVATE" && data[f.key] !== undefined) out[f.key] = data[f.key];
  return out;
}

export function essentialSnapshot(schema: FormSchemaDef, data: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of allFields(schema)) if (f.essential) out[f.key] = data[f.key] ?? null;
  return out;
}

export function formatValue(f: FormField | undefined, v: any): string {
  if (v === undefined || v === null || v === "") return "—";
  if (!f) return String(v);
  if (f.type === "boolean") return v ? "Да" : "Нет";
  if (f.type === "select") return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
  if (f.type === "multiselect") return (v as string[]).map((x) => f.options?.find((o) => o.value === x)?.label ?? x).join(", ");
  if (f.type === "number" && /rub/.test(f.key)) return Number(v).toLocaleString("ru-RU") + " ₽";
  return String(v);
}
