import type { Ctx } from "@/server/access";
export const isCarrier = (ctx: Ctx) => ctx.org?.orgType === "CARRIER";
export const isSupport = (ctx: Ctx) => ctx.org?.orgType === "PLATFORM" && ctx.org.role === "SUPPORT";
export const isAdmin = (ctx: Ctx) => ctx.org?.orgType === "PLATFORM" && ctx.org.role === "ADMIN";
