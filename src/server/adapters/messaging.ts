import { db, type Tx } from "../db";
import { appMode } from "../config";

export interface MessagingAdapter { email(tx: Tx | typeof db, i: { userId: string; to: string; subject: string; body: string; category: "SERVICE" | "MARKETING" }): Promise<void> }

/** В P0 канал — приватная демопочта в БД. Адаптеры email/SMS — P1. */
export const messagingEmulator: MessagingAdapter = {
  async email(tx, i) {
    if (appMode() !== "demo") return; // в production без настроенного провайдера письма не отправляются
    await tx.demoMail.create({ data: { userId: i.userId, toEmail: i.to, subject: i.subject, body: i.body, category: i.category } });
  },
};
