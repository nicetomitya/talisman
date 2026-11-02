import { db } from "../db";
import { audit, type Actor } from "../audit";
import { err } from "../errors";

export const TEXT_VERSIONS = { PD_PROCESSING: "pd-2026-11-v1", TERMS: "terms-2026-11-v1", MARKETING: "mkt-2026-11-v1", COOKIES_ANALYTICS: "cookies-2026-11-v1", PD_TRANSFER_AGENT: "transfer-2026-11-v1" } as const;
export const PURPOSES: Record<string, { title: string; required: boolean; text: string }> = {
  PD_PROCESSING: { title: "Обработка персональных данных", required: true, text: "Согласие на обработку данных для подбора и сопровождения страхования. Отзыв не удаляет записи, которые необходимо хранить по закону или для исполнения договора." },
  TERMS: { title: "Условия использования сервиса", required: true, text: "Правила пользования платформой (демонстрационная версия)." },
  MARKETING: { title: "Маркетинговые сообщения", required: false, text: "Подборки и предложения от платформы. По умолчанию выключено, отказ — в один клик." },
  COOKIES_ANALYTICS: { title: "Необязательные cookie аналитики", required: false, text: "Учёт просмотров страниц для улучшения сервиса. Без согласия события не записываются." },
};

export async function setConsent(actor: Actor & { userId: string }, purpose: string, granted: boolean, method: string) {
  const p = PURPOSES[purpose];
  if (!p) throw err("VALIDATION", "Неизвестная цель согласия");
  if (p.required && !granted) {
    // Отзыв обязательного согласия фиксируется, но не уничтожает записи, необходимые по закону/договору.
  }
  const last = await db.consent.findFirst({ where: { userId: actor.userId, purpose }, orderBy: { createdAt: "desc" } });
  if (last && !last.revokedAt && last.granted === granted) return last;
  const c = await db.$transaction(async (tx) => {
    if (last && !last.revokedAt) await tx.consent.update({ where: { id: last.id }, data: { revokedAt: new Date() } });
    const c = await tx.consent.create({ data: { userId: actor.userId, purpose, textVersion: (TEXT_VERSIONS as any)[purpose], granted, method } });
    await audit(tx, actor, granted ? "consent.granted" : "consent.revoked", "Consent", c.id, { after: { purpose, granted } });
    return c;
  });
  return c;
}

export async function currentConsents(userId: string) {
  const all = await db.consent.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  const out: Record<string, { granted: boolean; at: Date; version: string } | null> = {};
  for (const k of Object.keys(PURPOSES)) {
    const c = all.find((x) => x.purpose === k);
    out[k] = c ? { granted: c.granted && !c.revokedAt, at: c.createdAt, version: c.textVersion } : null;
  }
  return { current: out, history: all };
}
