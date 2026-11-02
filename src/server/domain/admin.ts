import { db, txRetry } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, machineRole, type Ctx } from "../access";
import { now } from "../clock";
import { assertTransition } from "../state/machines";
import { addExceptionAction } from "./exceptions";
import { notifyOrg } from "./notify";
import { raiseException } from "./exceptions";

export async function verifyOrganization(ctx: Ctx, orgId: string, decision: "VERIFIED" | "REJECTED", validDays: number, note: string) {
  const t = await now();
  return db.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org || org.type !== "AGENCY") throw err("NOT_FOUND", "Агентство не найдено");
    const validUntil = decision === "VERIFIED" ? new Date(t.getTime() + validDays * 86400_000) : null;
    await tx.organization.update({ where: { id: orgId }, data: { verificationStatus: decision, verifiedUntil: validUntil, version: { increment: 1 } } });
    await tx.orgVerification.create({ data: { organizationId: orgId, status: decision, reviewerId: ctx.user.id, note, validUntil } });
    await audit(tx, actor(ctx), "org.verification", "Organization", orgId, { after: { decision, validUntil }, reason: note });
    await notifyOrg(tx, orgId, { type: "org.verification", title: decision === "VERIFIED" ? "Агентство проверено" : "Проверка не пройдена", body: note, link: "/a/settings" });
  });
}

/** Блокировка за нарушение: новые продажи запрещены, обязательства сохраняются, сопровождение передаётся (задача). */
export async function blockOrganization(ctx: Ctx, orgId: string, reason: string) {
  const t = await now();
  return db.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: orgId }, data: { status: "BLOCKED", blockReason: reason } });
    const policies = await tx.policy.count({ where: { agencyOrgId: orgId, contractStatus: "CONCLUDED" } });
    await raiseException(tx, { type: "DATA", priority: "HIGH", entityType: "Organization", entityId: orgId, reason: `Агентство заблокировано: ${reason}. Действующих договоров: ${policies}`, nextAction: "Назначить другого ответственного за сопровождение клиентов", dueAt: new Date(t.getTime() + 2 * 86400_000), dedupeKey: `block:${orgId}:${t.getTime()}` });
    await audit(tx, actor(ctx), "org.blocked", "Organization", orgId, { reason });
  });
}

export async function unblockOrganization(ctx: Ctx, orgId: string) {
  await db.organization.update({ where: { id: orgId }, data: { status: "ACTIVE", blockReason: null } });
  await audit(db, actor(ctx), "org.unblocked", "Organization", orgId);
}

export async function createMandate(ctx: Ctx, i: { agencyOrgId: string; productId: string; validDays: number }) {
  const t = await now();
  const product = await db.product.findUniqueOrThrow({ where: { id: i.productId } });
  if (ctx.org?.orgType === "CARRIER" && product.carrierOrgId !== ctx.org.orgId) throw err("FORBIDDEN", "Полномочия выдаёт страховщик-носитель риска");
  const m = await db.mandate.create({ data: { agencyOrgId: i.agencyOrgId, carrierOrgId: product.carrierOrgId, productId: product.id, validFrom: t, validTo: new Date(t.getTime() + i.validDays * 86400_000) } });
  await audit(db, actor(ctx), "mandate.created", "Mandate", m.id, { after: i });
  return m;
}

export async function revokeMandate(ctx: Ctx, id: string, reason: string, expire = false) {
  const m = await db.mandate.findUniqueOrThrow({ where: { id } });
  if (ctx.org?.orgType === "CARRIER" && m.carrierOrgId !== ctx.org.orgId) throw err("FORBIDDEN", "Чужие полномочия");
  const t = await now();
  const upd = await db.mandate.update({ where: { id }, data: expire ? { status: "EXPIRED", validTo: t, revokeReason: reason } : { status: "REVOKED", revokeReason: reason } });
  await audit(db, actor(ctx), expire ? "mandate.expired" : "mandate.revoked", "Mandate", id, { reason });
  await notifyOrg(db, m.agencyOrgId, { type: "mandate.ended", title: "Полномочия страховщика прекращены", body: `${reason}. Новые продажи по продукту недоступны; обслуживание действующих договоров продолжается.`, link: "/a/settings" });
  return upd;
}

export async function transitionProduct(ctx: Ctx, productId: string, to: string, note: string) {
  const role = machineRole(ctx);
  return txRetry(async (tx) => {
    const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    if (role === "CARRIER" && p.carrierOrgId !== ctx.org?.orgId) throw err("FORBIDDEN", "Продукт другого страховщика");
    if ((role === "OWNER" || role === "AGENT") && p.proposedByOrgId !== ctx.org?.orgId) throw err("FORBIDDEN", "Продукт другого агентства");
    assertTransition("product", p.status, to, role);
    const upd = await tx.product.update({ where: { id: p.id }, data: { status: to as any, version: { increment: 1 } } });
    const latest = await tx.productVersion.findFirst({ where: { productId: p.id }, orderBy: { version: "desc" } });
    if (latest && to === "PUBLISHED" && latest.status !== "PUBLISHED") await tx.productVersion.update({ where: { id: latest.id }, data: { status: "PUBLISHED", publishedAt: await now() } });
    await audit(tx, actor(ctx), "product.transition", "Product", p.id, { before: { status: p.status }, after: { status: to }, reason: note });
    return upd;
  });
}

/** Предложение агентством нового продукта: агент описывает аудиторию, страховщик одобряет условия и тариф. */
export async function proposeProduct(ctx: Ctx & { orgId: string }, i: { title: string; summary: string; carrierOrgId: string; audience: string; baseProductCode: "RAIN01" | "WIND01" | "KASKO" | "PROPERTY" }) {
  const carrier = await db.organization.findFirst({ where: { id: i.carrierOrgId, type: "CARRIER" } });
  if (!carrier) throw err("NOT_FOUND", "Страховщик не найден");
  const code = `PROP-${Date.now().toString(36).toUpperCase()}`;
  const p = await db.product.create({ data: { code, kind: ["RAIN01", "WIND01"].includes(i.baseProductCode) ? "EVENT" : "CLASSIC", title: i.title, summary: i.summary, carrierOrgId: carrier.id, proposedByOrgId: ctx.orgId, status: "DRAFT", auctionAllowed: false,
    versions: { create: { version: 1, status: "DRAFT", terms: { productCode: `PROPOSAL_${i.baseProductCode}`, audience: i.audience, proposal: true } } } } });
  await audit(db, actor(ctx), "product.proposed", "Product", p.id, { after: i });
  return p;
}

/** Двойное подтверждение (P0: два администратора + причины). */
export async function requestApproval(ctx: Ctx, action: "TARIFF_CHANGE" | "FINANCIAL_ADJUSTMENT" | "PAYOUT_RULE_CHANGE", payload: Record<string, unknown>, reason: string) {
  if (reason.trim().length < 10) throw err("VALIDATION", "Опишите причину изменения");
  const a = await db.adminApproval.create({ data: { action, payload: payload as any, reason, requestedBy: ctx.user.id } });
  await audit(db, actor(ctx), "approval.requested", "AdminApproval", a.id, { after: { action, payload }, reason });
  return a;
}

export async function decideApproval(ctx: Ctx, id: string, approve: boolean, reason: string) {
  return txRetry(async (tx) => {
    const a = await tx.adminApproval.findUniqueOrThrow({ where: { id } });
    if (a.status !== "PENDING") throw err("ALREADY_DONE", "Запрос уже рассмотрен");
    if (a.requestedBy === ctx.user.id) throw err("FORBIDDEN", "Второе подтверждение должен дать другой уполномоченный администратор");
    if (reason.trim().length < 5) throw err("VALIDATION", "Укажите причину решения");
    const t = await now();
    if (!approve) {
      await audit(tx, actor(ctx), "approval.rejected", "AdminApproval", a.id, { reason });
      return tx.adminApproval.update({ where: { id }, data: { status: "REJECTED", approvedBy: ctx.user.id, approvalReason: reason, decidedAt: t } });
    }
    const p = a.payload as any;
    if (a.action === "TARIFF_CHANGE") {
      const cur = await tx.tariffVersion.findUniqueOrThrow({ where: { id: p.tariffId } });
      const rules = { ...(cur.rules as any), ...(p.rulesPatch ?? {}) };
      await tx.tariffVersion.update({ where: { id: cur.id }, data: { status: "RETIRED" } });
      await tx.tariffVersion.create({ data: { productId: cur.productId, carrierOrgId: cur.carrierOrgId, version: cur.version + 1, source: cur.source, rules, validFrom: t, validTo: new Date(t.getTime() + (p.validDays ?? 90) * 86400_000), status: "ACTIVE" } });
    }
    if (a.action === "FINANCIAL_ADJUSTMENT") {
      const c = await tx.commission.findUniqueOrThrow({ where: { id: p.commissionId } });
      await tx.commission.create({ data: { policyId: c.policyId, kind: `ADJUSTMENT:${a.id.slice(0, 8)}`, payerOrgId: c.payerOrgId, recipientType: c.recipientType, recipientOrgId: c.recipientOrgId, baseKop: c.baseKop, rateBp: 0, amountKop: Number(p.amountKop), status: "CONFIRMED", termsVersion: c.termsVersion, reversalOfId: c.id, note: `Корректировка: ${a.reason}` } });
      await tx.financialAdjustment.create({ data: { commissionId: c.id, amountKop: Number(p.amountKop), reason: a.reason, approvalId: a.id } });
    }
    await audit(tx, actor(ctx), "approval.applied", "AdminApproval", a.id, { after: p, reason });
    return tx.adminApproval.update({ where: { id }, data: { status: "APPLIED", approvedBy: ctx.user.id, approvalReason: reason, decidedAt: t } });
  });
}

export async function setSuspension(ctx: Ctx, i: { scope: "CARRIER" | "PRODUCT" | "TERRITORY" | "DATA_SOURCE"; target: string; reason: string }) {
  const s = await db.salesSuspension.create({ data: { ...i, createdBy: ctx.user.id } });
  await audit(db, actor(ctx), "sales.suspended", "SalesSuspension", s.id, { after: i, reason: i.reason });
  return s;
}
export async function liftSuspension(ctx: Ctx, id: string) {
  const s = await db.salesSuspension.update({ where: { id }, data: { active: false, liftedAt: await now() } });
  await audit(db, actor(ctx), "sales.resumed", "SalesSuspension", id);
  return s;
}

export async function exceptionAction(ctx: Ctx, id: string, action: "ASSIGN_ME" | "NOTE" | "WAITING_INFO" | "RESOLVE", note: string) {
  const ex = await db.exceptionItem.findUniqueOrThrow({ where: { id } });
  if (ctx.org?.orgType === "AGENCY" && ex.organizationId !== ctx.org.orgId) throw err("NOT_FOUND", "Не найдено");
  if (action === "RESOLVE" && note.trim().length < 5) throw err("VALIDATION", "Укажите решение и основание");
  await addExceptionAction(db, id, ctx.user.name, action, note);
  const data: any = action === "ASSIGN_ME" ? { assigneeId: ctx.user.id, status: "IN_PROGRESS" } : action === "WAITING_INFO" ? { status: "WAITING_INFO" } : action === "RESOLVE" ? { status: "RESOLVED", resolution: note } : {};
  const upd = await db.exceptionItem.update({ where: { id }, data });
  await audit(db, actor(ctx), `exception.${action.toLowerCase()}`, "ExceptionItem", id, { reason: note });
  return upd;
}

/** Доступ поддержки к чувствительным данным — только с основанием и сроком, фиксируется в аудите. */
export async function grantSupportAccess(ctx: Ctx, i: { targetType: "Document" | "Client"; targetId: string; reason: string; minutes: number }) {
  if (i.reason.trim().length < 10) throw err("VALIDATION", "Укажите основание доступа");
  const g = await db.supportAccessGrant.create({ data: { userId: ctx.user.id, targetType: i.targetType, targetId: i.targetId, reason: i.reason, expiresAt: new Date(Date.now() + Math.min(i.minutes, 60) * 60_000) } });
  await audit(db, actor(ctx), "support.access_granted", i.targetType, i.targetId, { reason: i.reason, after: { expiresAt: g.expiresAt } });
  return g;
}
