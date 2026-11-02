import type { MemberRole, OrgType } from "@prisma/client";
import { err } from "./errors";
import type { Actor } from "./audit";

export type Member = { orgId: string; orgType: OrgType; orgName: string; role: MemberRole; orgStatus: string; verification: string; verifiedUntil: Date | null };
export type Ctx = {
  user: { id: string; email: string; name: string; kind: "CLIENT" | "STAFF"; totpEnabled: boolean };
  sessionId: string;
  mfa: boolean;
  isDemoSwitch: boolean;
  memberships: Member[];
  org: Member | null;
  correlationId: string;
};

export function buildCtx(s: any, correlationId: string): Ctx {
  const memberships: Member[] = s.user.memberships.map((m: any) => ({
    orgId: m.organizationId, orgType: m.organization.type, orgName: m.organization.name, role: m.role,
    orgStatus: m.organization.status, verification: m.organization.verificationStatus, verifiedUntil: m.organization.verifiedUntil,
  }));
  const org = memberships.find((m) => m.orgId === s.activeOrgId) ?? memberships[0] ?? null;
  return {
    user: { id: s.user.id, email: s.user.email, name: s.user.name, kind: s.user.kind, totpEnabled: s.user.totpEnabled },
    sessionId: s.id, mfa: !!s.mfaVerifiedAt, isDemoSwitch: s.isDemoSwitch, memberships, org, correlationId,
  };
}

export function actor(ctx: Ctx): Actor {
  return { userId: ctx.user.id, orgId: ctx.org?.orgId ?? null, role: machineRole(ctx), correlationId: ctx.correlationId };
}

/** Роль для таблиц переходов. */
export function machineRole(ctx: Ctx): string {
  if (ctx.user.kind === "CLIENT") return "CLIENT";
  switch (ctx.org?.role) {
    case "AGENCY_OWNER": return "OWNER";
    case "AGENT": return "AGENT";
    case "CARRIER_REP": return "CARRIER";
    case "ADMIN": return "ADMIN";
    case "SUPPORT": return "SUPPORT";
    default: return "NONE";
  }
}

export function asClient(ctx: Ctx | null): Ctx & { clientId: string } {
  if (!ctx) throw err("UNAUTHENTICATED", "Требуется вход");
  if (ctx.user.kind !== "CLIENT") throw err("FORBIDDEN", "Действие доступно только клиенту");
  return Object.assign(ctx, { clientId: ctx.user.id });
}

export function asAgency(ctx: Ctx | null, opts: { owner?: boolean } = {}): Ctx & { orgId: string; role: MemberRole } {
  if (!ctx) throw err("UNAUTHENTICATED", "Требуется вход");
  const o = ctx.org;
  if (!o || o.orgType !== "AGENCY" || !["AGENT", "AGENCY_OWNER"].includes(o.role)) throw err("FORBIDDEN", "Нужен контекст агентства");
  if (opts.owner && o.role !== "AGENCY_OWNER") throw err("FORBIDDEN", "Действие доступно владельцу агентства");
  return Object.assign(ctx, { orgId: o.orgId, role: o.role });
}

export function asCarrier(ctx: Ctx | null): Ctx & { orgId: string } {
  if (!ctx) throw err("UNAUTHENTICATED", "Требуется вход");
  const o = ctx.org;
  if (!o || o.orgType !== "CARRIER" || o.role !== "CARRIER_REP") throw err("FORBIDDEN", "Нужны права представителя страховщика");
  return Object.assign(ctx, { orgId: o.orgId });
}

/** Административная часть: ADMIN (и SUPPORT при allowSupport). Изменения требуют второго фактора. */
export function asAdmin(ctx: Ctx | null, opts: { allowSupport?: boolean; mutation?: boolean; allowCarrier?: boolean } = {}): Ctx & { orgId: string; role: MemberRole } {
  if (!ctx) throw err("UNAUTHENTICATED", "Требуется вход");
  const o = ctx.org;
  const ok = o && ((o.orgType === "PLATFORM" && (o.role === "ADMIN" || (opts.allowSupport && o.role === "SUPPORT"))) || (opts.allowCarrier && o.orgType === "CARRIER" && o.role === "CARRIER_REP"));
  if (!ok) throw err("FORBIDDEN", "Нет доступа к административной части");
  if (opts.mutation && !ctx.mfa) throw err("MFA_REQUIRED", "Для административных изменений нужен второй фактор (TOTP)");
  return Object.assign(ctx, { orgId: o!.orgId, role: o!.role });
}

export function isStaffArea(ctx: Ctx | null) {
  return !!ctx?.org && (ctx.org.orgType === "PLATFORM" || ctx.org.orgType === "CARRIER");
}
