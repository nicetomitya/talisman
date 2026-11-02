import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findSession, SESSION_COOKIE } from "./auth/session";
import { buildCtx, type Ctx } from "./access";
import { newCorrelationId } from "./errors";

export async function pageCtx(): Promise<Ctx | null> {
  const jar = await cookies();
  const s = await findSession(jar.get(SESSION_COOKIE)?.value);
  return s ? buildCtx(s, newCorrelationId()) : null;
}

export async function requireClientPage() {
  const ctx = await pageCtx();
  if (!ctx) redirect("/login?next=/c");
  if (ctx.user.kind !== "CLIENT") redirect(homeFor(ctx));
  return ctx;
}
export async function requireAgencyPage() {
  const ctx = await pageCtx();
  if (!ctx) redirect("/login?next=/a");
  if (ctx.org?.orgType !== "AGENCY") redirect(homeFor(ctx));
  return ctx as Ctx & { org: NonNullable<Ctx["org"]> };
}
export async function requireAdminPage() {
  const ctx = await pageCtx();
  if (!ctx) redirect("/login?next=/admin");
  if (!(ctx.org && (ctx.org.orgType === "PLATFORM" || ctx.org.orgType === "CARRIER"))) redirect(homeFor(ctx));
  return ctx as Ctx & { org: NonNullable<Ctx["org"]> };
}
export function homeFor(ctx: Ctx | null) {
  if (!ctx) return "/login";
  if (ctx.user.kind === "CLIENT") return "/c";
  if (ctx.org?.orgType === "AGENCY") return "/a";
  if (ctx.org) return "/admin";
  return "/";
}
