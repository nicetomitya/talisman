import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { randomToken, sha256 } from "../auth/crypto";
import { err } from "../errors";
import type { Ctx } from "../access";
import type { Owner } from "./service";

/** Гостевой черновик: случайный токен в httpOnly-cookie, в БД — только хэш (ТЗ v2, п. 10.2). */
export const GUEST_COOKIE = "tgk";
export function ownerFrom(req: NextRequest, ctx: Ctx | null, opts: { create?: boolean } = {}): { owner: Owner; newToken?: string } {
  if (ctx) {
    if (ctx.user.kind !== "CLIENT") throw err("FORBIDDEN", "Risk drafts belong to customer accounts");
    return { owner: { userId: ctx.user.id } };
  }
  const t = req.cookies.get(GUEST_COOKIE)?.value;
  if (t && t.length >= 20) return { owner: { guestKeyHash: sha256(t) } };
  if (!opts.create) throw err("NOT_FOUND", "Risk not found");
  const newToken = randomToken();
  return { owner: { guestKeyHash: sha256(newToken) }, newToken };
}
export function withGuestCookie(data: unknown, req: NextRequest, newToken?: string) {
  const res = NextResponse.json(data);
  if (newToken) res.cookies.set(GUEST_COOKIE, newToken, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 30 * 86400 });
  return res;
}
export const ip = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
export const usdToCents = z.union([z.number(), z.string()]).transform((v, c) => {
  const s = String(v).replace(/[$,\s]/g, "");
  const m = s.match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!m) { c.addIssue({ code: "custom", message: "Enter a dollar amount like 1500 or 1500.50" }); return z.NEVER; }
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
});
export const decimalX100 = z.union([z.number(), z.string()]).transform((v, c) => {
  const m = String(v).trim().match(/^(\d{1,5})(?:\.(\d{1,2}))?$/);
  if (!m) { c.addIssue({ code: "custom", message: "Enter a number with up to two decimals" }); return z.NEVER; }
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
});
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const uuid = z.string().uuid();

export const clarifySchema = z.object({
  version: z.number().int(),
  placeKey: z.string().max(40).optional(),
  stationId: z.string().max(20).nullable().optional(),
  windowStartLocal: isoDate.optional(), windowEndLocal: isoDate.optional(),
  threshold: decimalX100.optional(),
  desiredPayoutUsd: usdToCents.optional(),
  budgetUsd: z.union([usdToCents, z.literal("").transform(() => null), z.null()]).optional(),
}).strict();
