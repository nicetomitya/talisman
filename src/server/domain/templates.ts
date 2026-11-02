import type { Checkout } from "@prisma/client";
import { type Tx, db } from "../db";
import type { DocTemplate, Clause } from "../adapters/document";
import { DEMO_BANNER } from "../adapters/document";
import { rub } from "../money";
import { schemaFor } from "./catalog";
import { allFields, formatValue } from "./forms";
import { PRODUCT_TITLES } from "./labels";
import { sha256 } from "../auth/crypto";

/** Версионированные шаблоны документов P0. Все — демонстрационные, без юридической силы. */
export const TEMPLATE_VERSIONS = { APPLICATION: 1, OFFER: 1, RULES: 1, INDIVIDUAL_TERMS: 1, POLICY_DRAFT: 1, POLICY_FINAL: 1, ACK: 1, CLAIM: 1, DECISION: 1 } as const;

export function rulesClauses(productCode: string): Clause[] {
  const common: Clause[] = [
    { id: "1.1", title: "Статус документа", text: `${DEMO_BANNER}. Правила подготовлены для проверки программы и не являются утверждёнными правилами страховщика.` },
    { id: "2.1", title: "Начало действия защиты", text: "Защита начинается с даты начала, указанной в полисе, после подтверждения заключения договора страховщиком. Оплата сама по себе не означает начала защиты." },
    { id: "3.1", title: "Прекращение договора", text: "Клиент вправе направить запрос на прекращение. В течение 14 дней с даты заключения премия возвращается полностью (если событие не наступало), позже — пропорционально неистёкшему сроку. Прекращение подтверждает страховщик." },
    { id: "4.1", title: "Порядок обращения за выплатой", text: "Обращение подаётся через карточку полиса кнопкой «Произошло событие». Страховщик рассматривает обращение в срок до 15 рабочих дней после получения всех документов." },
    { id: "5.1", title: "Споры", text: "Клиент может оспорить решение через платформу. Разногласия рассматривает страховщик; применимость финансового уполномоченного определяется законом." },
  ];
  if (productCode === "KASKO") return [...common,
    { id: "6.1", title: "Застрахованные риски каско", text: "Ущерб — повреждение автомобиля в результате ДТП, падения предметов, противоправных действий третьих лиц. Угон и хищение — утрата автомобиля в результате кражи или угона." },
    { id: "6.2", title: "Франшиза", text: "Безусловная франшиза вычитается из каждой выплаты по риску «Ущерб». По риску «Угон и хищение» франшиза не применяется." },
    { id: "6.3", title: "Исключения", text: "Не покрываются: управление в состоянии опьянения, управление лицом без права управления, использование в такси, если это не указано в полисе, износ и коррозия." },
    { id: "6.4", title: "Осмотр", text: "Для автомобилей стоимостью более 3 000 000 рублей требуется предстраховой осмотр до начала действия защиты." },
    { id: "6.5", title: "Экстренная ситуация", text: "При ДТП с пострадавшими звоните 112. Телефон помощи страховщика указан в полисе. Чат платформы не заменяет экстренные службы." },
  ];
  if (productCode === "PROPERTY") return [...common,
    { id: "6.1", title: "Застрахованные риски имущества", text: "Пожар, залив водой из инженерных систем, кража со взломом и стихийные бедствия в отношении объектов, указанных в полисе." },
    { id: "6.2", title: "Сдача в аренду", text: "Если объект сдаётся в аренду и это не указано в заявке, страховщик вправе отказать в выплате по рискам, связанным с действиями арендатора." },
    { id: "6.3", title: "Исключения", text: "Не покрываются: постепенное разрушение, износ, умышленные действия страхователя, ремонт без разрешения." },
    { id: "6.4", title: "Ответственность перед соседями", text: "Покрывается вред, причинённый имуществу третьих лиц заливом из застрахованной квартиры, в пределах лимита." },
  ];
  const rain = productCode === "RAIN01";
  return [...common,
    { id: "6.1", title: "Измеряемое условие", text: rain ? "Сумма часовых приращений осадков по станции DEMO_STATION_SPB_01 за часы мероприятия составляет не менее 5.0 мм. Ровно 5.0 мм — условие выполнено." : "Средняя скорость ветра ниже 3.0 м/с минимум в трёх из четырёх часовых интервалов по станции DEMO_WIND_01 на высоте 10 м. Значение ровно 3.0 м/с не считается ниже порога." },
    { id: "6.2", title: "Источник данных и резерв", text: rain ? "Основной источник DEMO_STATION_SPB_01 (накопительный счётчик, нормализуется в приращения), резервный DEMO_STATION_SPB_02. Источник и метод не меняются задним числом." : "Основной источник DEMO_WIND_01, резервный DEMO_WIND_02. Источник и метод не меняются задним числом." },
    { id: "6.3", title: "Отсутствующие данные", text: "Пропуск наблюдений не считается отсутствием события. При пропуске используется резервный источник, иначе обращение рассматривает специалист. Окончательный расчёт — не позднее 72 часов после окончания события." },
    { id: "6.4", title: "Расхождение погоды на месте и показателя станции", text: "Погода на площадке может отличаться от показаний станции. Пример: на площадке шёл дождь 30 минут, а станция в 3 км зафиксировала 3.8 мм — выплата не положена, потому что условие определяется показателем станции." },
    { id: "6.5", title: "Размер выплаты", text: rain ? "Фиксированная демонстрационная выплата 5 000 ₽ при выполнении условия. Одна проверка условия даёт не больше одного основания на выплату." : "Фиксированная демонстрационная выплата 3 000 ₽ при выполнении условия." },
    { id: "6.6", title: "Отмена и перенос бронирования", text: "Отмена бронирования, изменение даты или места требуют проверки применимости покрытия; договор изменяется или прекращается по правилам продукта." },
  ];
}

function fieldsFromData(productCode: string, data: Record<string, any>): [string, string][] {
  const schema = schemaFor(productCode);
  return allFields(schema).filter((f) => data[f.key] !== undefined && data[f.key] !== "").map((f) => [f.label, formatValue(f, data[f.key])]);
}

export async function buildTemplates(tx: Tx | typeof db, c: Checkout, carrierQuoteId: string) {
  const snap = c.snapshot as any;
  const carrier = await tx.organization.findUniqueOrThrow({ where: { id: c.carrierOrgId } });
  const agency = c.agencyOrgId ? await tx.organization.findUnique({ where: { id: c.agencyOrgId } }) : null;
  const client = await tx.user.findUniqueOrThrow({ where: { id: c.clientId } });
  const code = snap.productCode as string;
  const q = snap.quote;
  const terms = q.terms;
  const head: [string, string][] = [["Продукт", PRODUCT_TITLES[code]], ["Страховщик", `${carrier.name} (вымышленная организация, без лицензии)`], ["Агентство", agency?.name ?? "—"], ["Клиент", client.name], ["Номер полиса (резерв)", snap.policyNumber]];
  const money: [string, string][] = [["Страховая премия", rub(q.premiumKop)], ["Сборы", rub(q.feesKop)], ["Скидка", q.discountKop ? `${rub(q.discountKop)} (за счёт вознаграждения агентства)` : "нет"], ["Итого к оплате", rub(q.totalKop)], ["Получатель платежа", `${carrier.name} — страховщик (не платформа и не агент)`]];
  const exclusions = (terms.exclusions ?? []).map((e: any) => e.title).join("; ") || "см. правила";
  const series = (k: string) => sha256(`series:${c.id}:${k}`).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  const t = (kind: string, title: string, fields: [string, string][], clauses: Clause[]): { kind: string; seriesId: string; template: DocTemplate } =>
    ({ kind, seriesId: series(kind), template: { code: kind, version: (TEMPLATE_VERSIONS as any)[kind] ?? 1, title, fields, clauses, footer: `Окончательная котировка страховщика ${carrierQuoteId}. ${DEMO_BANNER}.` } });
  return [
    t("APPLICATION", "Заявление на страхование (демо)", [...head, ...fieldsFromData(code, snap.requestData)], [{ id: "1", title: "Достоверность сведений", text: "Клиент подтверждает, что сведения в заявлении проверены им и соответствуют действительности." }]),
    t("OFFER", "Предложение страховщика (демо)", [...head, ...money, ["Срок цены", "до окончания резерва и не позднее срока котировки"]], [{ id: "1", title: "Акцепт", text: "Предложение принимается подтверждением ознакомления и оплатой в пределах срока действия цены." }]),
    t("RULES", `Правила страхования «${PRODUCT_TITLES[code]}» (демо)`, head.slice(0, 2), rulesClauses(code)),
    t("INDIVIDUAL_TERMS", "Индивидуальные условия (демо)", [...head, ...money, ["Риски", (terms.risks ?? []).join(", ")], ["Франшиза", `${(terms.deductibleRub ?? 0).toLocaleString("ru-RU")} ₽`], ["Страховая сумма / выплата", `${(terms.sumInsuredRub ?? 0).toLocaleString("ru-RU")} ₽`], ["Исключения", exclusions], ["Урегулирование", terms.settlement ?? "—"], ["Телефон помощи", terms.emergencyPhone ?? "—"]],
      [{ id: "1", title: "Начало защиты", text: "Дата начала указывается в полисе после подтверждения страховщика." }, { id: "2", title: "Способ прекращения", text: "Через запрос на прекращение в карточке полиса; расчёт возврата показывается до подтверждения." }]),
  ];
}

export function policyTemplate(kind: "POLICY_DRAFT" | "POLICY_FINAL" | "ACK", c: Checkout, extra: Record<string, any>): DocTemplate {
  const snap = c.snapshot as any;
  const q = snap.quote;
  if (kind === "ACK") {
    return { code: "ACK", version: TEMPLATE_VERSIONS.ACK, title: "Подтверждение ознакомления (демо)", fields: [["Оформление", c.id], ["Способ", extra.signature.method], ["Время", extra.signature.at], ["Пользователь", extra.signature.userId], ["Сессия", extra.signature.authSessionId]],
      clauses: (extra.signature.docs as any[]).map((d, i) => ({ id: String(i + 1), title: `Документ ${d.kind} v${d.version}`, text: `SHA-256: ${d.sha256}` })) };
  }
  return {
    code: kind, version: (TEMPLATE_VERSIONS as any)[kind], title: kind === "POLICY_DRAFT" ? "Проект полиса — не действует до оплаты и подтверждения страховщика (демо)" : "Полис (демо) — подтверждён эмулятором страховщика",
    fields: [["Номер", snap.policyNumber], ["Продукт", PRODUCT_TITLES[snap.productCode]], ["Премия", rub(q.totalKop)], ["Франшиза", `${(q.terms.deductibleRub ?? 0).toLocaleString("ru-RU")} ₽`], ...(extra.externalNumber ? [["Номер у страховщика", extra.externalNumber] as [string, string], ["Подтверждено", extra.concludedAt] as [string, string]] : [])],
    clauses: rulesClauses(snap.productCode).slice(0, 3),
  };
}
