/**
 * Общение клиента и агентства — только через платформу: телефоны, почта, ссылки и ники мессенджеров
 * в сообщениях заменяются пометкой. Суммы и номера полисов не затрагиваются.
 */
const PATTERNS: RegExp[] = [
  /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/gu, // e-mail
  /\b(?:https?:\/\/|www\.)\S+/giu, // ссылки
  /\b(?:t\.me|wa\.me|vk\.com|vk\.me|instagram\.com|ok\.ru|viber\.click)\/\S*/giu, // мессенджеры и соцсети без протокола
  /(?<![\p{L}\d@.-])[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.(?:ru|com|net|org|io|me|su|рф|info|biz|pro|online|site|store|app|test)(?![\p{L}\d-])(?:\/\S*)?/giu, // голые домены
  /(?:\+7|\b8|\b7)[\s\-(]*\d{3}[\s\-)]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g, // российские телефоны
  /\+\d[\d\s()-]{9,}\d/g, // прочие международные номера
];
const HANDLE = /(^|[\s(])@[A-Za-z][A-Za-z0-9_]{3,}/g; // ники вида @username
export const CONTACT_MASK = "[контакт скрыт]";

export function maskContacts(text: string): { text: string; masked: boolean } {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, CONTACT_MASK);
  out = out.replace(HANDLE, (_m, lead: string) => lead + CONTACT_MASK);
  return { text: out, masked: out !== text };
}
