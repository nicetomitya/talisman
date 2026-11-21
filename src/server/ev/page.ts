import { cookies } from "next/headers";
import { sha256 } from "../auth/crypto";
import type { Ctx } from "../access";
import { GUEST_COOKIE } from "./http";
import { claimGuestIntents, type Owner } from "./service";

/** Владелец для серверной страницы: аккаунт клиента или гостевой cookie. Черновики гостя переходят при входе. */
export async function pageOwner(ctx: Ctx | null): Promise<Owner | null> {
  const jar = await cookies();
  const t = jar.get(GUEST_COOKIE)?.value;
  if (ctx?.user.kind === "CLIENT") {
    if (t && t.length >= 20) await claimGuestIntents(ctx.user.id, sha256(t));
    return { userId: ctx.user.id };
  }
  if (ctx) return null;
  return t && t.length >= 20 ? { guestKeyHash: sha256(t) } : null;
}
