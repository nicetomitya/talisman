import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError, errorBody, newCorrelationId, err } from "./errors";
import { findSession, SESSION_COOKIE, CSRF_COOKIE } from "./auth/session";
import { buildCtx, type Ctx } from "./access";
import { log } from "./audit";
import { safeEqual } from "./auth/crypto";
import { Prisma } from "@prisma/client";

type Handler<S extends z.ZodTypeAny> = (a: { req: NextRequest; ctx: Ctx | null; body: z.infer<S>; params: Record<string, string>; cid: string; query: URLSearchParams }) => Promise<unknown>;

export function api<S extends z.ZodTypeAny = z.ZodAny>(opts: { auth?: boolean; schema?: S; csrf?: boolean }, handler: Handler<S>) {
  return async (req: NextRequest, route: { params: Promise<Record<string, string>> }) => {
    const cid = newCorrelationId();
    try {
      const method = req.method.toUpperCase();
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
      if (mutating && opts.csrf !== false) checkCsrf(req);
      const session = await findSession(req.cookies.get(SESSION_COOKIE)?.value);
      const ctx = session ? buildCtx(session, cid) : null;
      if (opts.auth !== false && !ctx) throw err("UNAUTHENTICATED", "Сессия истекла или отсутствует");
      let body: any = undefined;
      if (opts.schema) {
        const raw = mutating ? await req.json().catch(() => { throw err("VALIDATION", "Некорректный JSON"); }) : Object.fromEntries(req.nextUrl.searchParams);
        const parsed = opts.schema.safeParse(raw);
        if (!parsed.success) {
          throw new AppError("VALIDATION", "Проверьте поля формы", { fields: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
        }
        body = parsed.data;
      }
      const params = (await route?.params) ?? {};
      const result = await handler({ req, ctx, body, params, cid, query: req.nextUrl.searchParams });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "x-correlation-id": cid } });
    } catch (e: any) {
      const appErr = toAppError(e);
      if (appErr.status >= 500 || !(e instanceof AppError)) log("error", "api.error", { cid, path: req.nextUrl.pathname, code: appErr.code, msg: String(e?.message ?? e).slice(0, 300) });
      return NextResponse.json(errorBody(appErr, cid), { status: appErr.status, headers: { "x-correlation-id": cid } });
    }
  };
}

export function toAppError(e: any): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return new AppError("CONFLICT", "Операция уже выполнена или конфликтует с другой", { target: (e.meta as any)?.target });
    if (e.code === "P2025") return new AppError("NOT_FOUND", "Объект не найден");
    if (e.code === "P2034") return new AppError("CONFLICT", "Параллельное изменение, повторите");
  }
  if (/violates check constraint/i.test(String(e?.message))) return new AppError("LIMIT_EXCEEDED", "Операция нарушает лимит");
  return new AppError("SOURCE_UNAVAILABLE", "Внутренняя ошибка. Сообщите код поддержке.");
}

function checkCsrf(req: NextRequest) {
  const cookie = req.cookies.get(CSRF_COOKIE)?.value;
  const header = req.headers.get("x-csrf-token");
  if (!cookie || !header || !safeEqual(cookie, header)) throw err("CSRF", "Проверка CSRF не пройдена. Обновите страницу.");
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    try { if (new URL(origin).host !== host) throw err("CSRF", "Недопустимый источник запроса"); } catch (e) { if (e instanceof AppError) throw e; throw err("CSRF", "Недопустимый источник"); }
  }
}

export const idemKey = z.string().min(8).max(200);
