import { z } from "zod";
import { api } from "@/server/api";
import { getConversation, sendMessage, markRead } from "@/server/domain/messaging";
import { db } from "@/server/db";
import { err } from "@/server/errors";

/** Снимок переписки (опрос раз в 4 с — после восстановления соединения клиент получает актуальное состояние). */
export const GET = api({}, async ({ ctx, params }) => {
  if (!ctx) throw err("UNAUTHENTICATED", "Войдите");
  const { conv } = await getConversation(ctx, params.id);
  await markRead(ctx, conv.id);
  const messages = await db.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: "asc" }, take: 200 });
  const authors = await db.user.findMany({ where: { id: { in: messages.map((m) => m.authorId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return { conversation: conv, messages: messages.map((m) => ({ ...m, authorName: authors.find((a) => a.id === m.authorId)?.name ?? (m.authorRole === "AI" ? "Помощник (ИИ, демо)" : "Система") })) };
});

export const POST = api({ schema: z.object({ body: z.string().min(1).max(4000), askAssistant: z.boolean().default(false) }).strict() }, async ({ ctx, params, body }) => {
  if (!ctx) throw err("UNAUTHENTICATED", "Войдите");
  return sendMessage(ctx, params.id, body.body, { askAssistant: body.askAssistant });
});
