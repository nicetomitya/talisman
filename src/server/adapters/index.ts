import { appMode } from "../config";
import { err } from "../errors";
import { carrierEmulator, type CarrierAdapter } from "./carrier";
import { paymentEmulator, type PaymentAdapter } from "./payment";
import { weatherEmulator, type WeatherAdapter } from "./weather";
import { signatureEmulator, type SignatureAdapter } from "./signature";
import { aiEmulator, type AIAdapter } from "./ai";
import { antivirusEmulator, type AntivirusAdapter } from "./antivirus";
import { documentAdapter, type DocumentAdapter } from "./document";
import { messagingEmulator, type MessagingAdapter } from "./messaging";

/**
 * Реестр адаптеров. В demo — локальные эмуляторы. В production — реальные реализации (P1);
 * пока они не подключены, любой вызов возвращает INTEGRATION_NOT_CONFIGURED (без подмены успешным ответом).
 */
function notConfigured<T extends object>(name: string): T {
  return new Proxy({} as T, { get: () => () => { throw err("INTEGRATION_NOT_CONFIGURED", `Адаптер ${name} не подключён в боевом режиме`); } });
}
const pick = <T extends object>(name: string, emu: T): T => (appMode() === "demo" ? emu : notConfigured<T>(name));

export const adapters = {
  get carrier(): CarrierAdapter { return pick("CarrierAdapter", carrierEmulator); },
  get payment(): PaymentAdapter { return pick("PaymentAdapter", paymentEmulator); },
  get weather(): WeatherAdapter { return pick("WeatherAdapter", weatherEmulator); },
  get signature(): SignatureAdapter { return pick("SignatureAdapter", signatureEmulator); },
  get ai(): AIAdapter { return pick("AIAdapter", aiEmulator); },
  get antivirus(): AntivirusAdapter { return pick("AntivirusAdapter", antivirusEmulator); },
  get documents(): DocumentAdapter { return documentAdapter; },
  get messaging(): MessagingAdapter { return messagingEmulator; },
};

export const INTEGRATION_MATRIX = [
  { adapter: "CarrierAdapter", p0: "Эмулятор: финальная котировка, подпись, подтверждение заключения, прекращение, параметрическое решение; режимы ok/delay/error/unavailable", p1: "API страховщика, договор, тестовый контур, ключи" },
  { adapter: "PaymentAdapter", p0: "Эмулятор провайдера с HMAC-вебхуками, дублями, задержкой, потерей вебхука, возвратами и выплатами; раздельные потоки страховщика и SaaS", p1: "Платёжный партнёр страховщика и отдельный провайдер подписки, 54-ФЗ" },
  { adapter: "WeatherAdapter", p0: "Фиксированные наборы наблюдений, основной и резервный источники, накопительный счётчик, недоступность", p1: "Договор с поставщиком (Росгидромет/лицензиат), архив, SLA" },
  { adapter: "SignatureAdapter", p0: "Демо-код в приватной демопочте, журнал доказательств", p1: "Допустимая электронная подпись по 63-ФЗ и правилам страховщика" },
  { adapter: "DocumentAdapter", p0: "Локальные шаблоны → PDF с водяным знаком, SHA-256", p1: "Утверждённые шаблоны страховщика, внешний архив" },
  { adapter: "AIAdapter", p0: "Детерминированный эмулятор без ключей, цитаты по пунктам", p1: "Разрешённый провайдер с контролем данных и локализацией" },
  { adapter: "Antivirus", p0: "EICAR-проверка + статус «проверка в деморежиме»", p1: "Реальный антивирусный сервис" },
  { adapter: "MessagingAdapter", p0: "Внутренние уведомления и приватная демопочта", p1: "Email/SMS-провайдер, согласия по 38-ФЗ" },
];
