import { randomUUID } from "node:crypto";
import { db, type Tx } from "../db";
import { err } from "../errors";
import { audit, type Actor } from "../audit";
import type { Ctx } from "../access";
import { putObject, getObject, signDownload } from "../adapters/storage";
import { validateUpload } from "./files";
import { sha256 } from "../auth/crypto";
import { DEMO_RULES } from "../config";
import { enqueue } from "../jobs";
import { rateLimit } from "../auth/ratelimit";
import { adapters } from "../adapters";
import type { DocTemplate } from "../adapters/document";
import { now } from "../clock";

type Link = { requestId?: string; checkoutId?: string; policyId?: string; claimId?: string };

/** Загрузка файла клиентом/агентом: проверка содержимого и лимитов реальна; файл в карантине до проверки антивирусом. */
export async function uploadFile(ctx: Ctx, link: Link, file: { name: string; mime: string; buf: Buffer }, kind = "UPLOAD") {
  await rateLimit(`upload:${ctx.user.id}`, 30, 600);
  const v = validateUpload(file.buf, file.mime, DEMO_RULES.uploadMaxBytes);
  if (!v.ok) throw err("VALIDATION", v.reason, { fields: [{ path: "file", message: v.reason }] });
  if (link.requestId) {
    const count = await db.document.count({ where: { requestId: link.requestId, kind: "UPLOAD", status: { not: "REJECTED" } } });
    if (count >= DEMO_RULES.uploadMaxFiles) throw err("LIMIT_EXCEEDED", `Не больше ${DEMO_RULES.uploadMaxFiles} файлов на заявку`);
  }
  const storageKey = await putObject(file.buf);
  const title = file.name.replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 120) || "файл";
  const doc = await db.$transaction(async (tx) => {
    const d = await tx.document.create({
      data: { kind, title, ownerUserId: ctx.user.kind === "CLIENT" ? ctx.user.id : null, organizationId: ctx.user.kind === "STAFF" ? ctx.org?.orgId : null, ...link,
        seriesId: randomUUID(), createdById: ctx.user.id, mime: v.mime, sizeBytes: file.buf.length, sha256: sha256(file.buf), storageKey, status: "QUARANTINE", isDemo: true },
    });
    await enqueue(tx, "document.scan", { documentId: d.id }, { uniqueKey: `scan:${d.id}` });
    await audit(tx, { userId: ctx.user.id, orgId: ctx.org?.orgId, correlationId: ctx.correlationId }, "document.upload", "Document", d.id, { after: { kind, mime: v.mime, size: file.buf.length, ...link } });
    return d;
  });
  return doc;
}

/** Генерация документа из версионированного шаблона. Новая версия серии не перезаписывает подписанную. */
export async function generateDocument(tx: Tx | typeof db, t: DocTemplate, meta: { kind: string; ownerUserId?: string | null; organizationId?: string | null; seriesId?: string; createdById?: string | null } & Link) {
  const r = await adapters.documents.render(t);
  let version = 1;
  if (meta.seriesId) {
    const last = await tx.document.findFirst({ where: { seriesId: meta.seriesId }, orderBy: { version: "desc" } });
    version = (last?.version ?? 0) + 1;
  }
  const doc = await tx.document.create({
    data: { kind: meta.kind, title: t.title, ownerUserId: meta.ownerUserId ?? null, organizationId: meta.organizationId ?? null, requestId: meta.requestId, checkoutId: meta.checkoutId, policyId: meta.policyId, claimId: meta.claimId,
      seriesId: meta.seriesId ?? randomUUID(), version, createdById: meta.createdById ?? null, mime: "application/pdf", sizeBytes: r.size, sha256: r.sha256, storageKey: r.storageKey, status: "GENERATED", isDemo: true,
      clauses: t.clauses as any, extracted: { template: t.code, templateVersion: t.version } },
  });
  if (meta.seriesId && version > 1) {
    await tx.document.updateMany({ where: { seriesId: meta.seriesId, id: { not: doc.id }, supersededById: null }, data: { supersededById: doc.id } });
  }
  return doc;
}

/**
 * Проверка права на документ — на каждый запрос и скачивание (AC29).
 * Возвращает основание доступа для журнала.
 */
export async function canAccessDocument(ctx: Ctx, docId: string): Promise<{ doc: any; basis: string }> {
  const doc = await db.document.findUnique({ where: { id: docId } });
  if (!doc) throw err("NOT_FOUND", "Документ не найден");
  const deny = () => { throw err("NOT_FOUND", "Документ не найден"); }; // не раскрываем существование
  if (ctx.user.kind === "CLIENT") {
    if (doc.ownerUserId === ctx.user.id) return { doc, basis: "owner" };
    if (doc.requestId && (await db.insuranceRequest.count({ where: { id: doc.requestId, clientId: ctx.user.id } }))) return { doc, basis: "own_request" };
    if (doc.checkoutId && (await db.checkout.count({ where: { id: doc.checkoutId, clientId: ctx.user.id } }))) return { doc, basis: "own_checkout" };
    if (doc.policyId && (await db.policy.count({ where: { id: doc.policyId, clientId: ctx.user.id } }))) return { doc, basis: "own_policy" };
    if (doc.claimId && (await db.claim.count({ where: { id: doc.claimId, clientId: ctx.user.id } }))) return { doc, basis: "own_claim" };
    return deny();
  }
  const org = ctx.org;
  if (!org) return deny();
  if (org.orgType === "AGENCY") {
    if (doc.organizationId === org.orgId) return { doc, basis: "own_org" };
    if (doc.checkoutId && (await db.checkout.count({ where: { id: doc.checkoutId, agencyOrgId: org.orgId } }))) return { doc, basis: "deal_participant" };
    if (doc.policyId && (await db.policy.count({ where: { id: doc.policyId, agencyOrgId: org.orgId } }))) return { doc, basis: "servicing_agency" };
    if (doc.claimId && (await db.claim.count({ where: { id: doc.claimId, agencyOrgId: org.orgId } }))) return { doc, basis: "servicing_agency" };
    if (await db.documentShare.count({ where: { documentId: doc.id, agencyOrgId: org.orgId } })) return { doc, basis: "explicit_share" };
    return deny();
  }
  if (org.orgType === "CARRIER") {
    if (doc.checkoutId && (await db.checkout.count({ where: { id: doc.checkoutId, carrierOrgId: org.orgId } }))) return { doc, basis: "carrier_deal" };
    if (doc.policyId && (await db.policy.count({ where: { id: doc.policyId, carrierOrgId: org.orgId } }))) return { doc, basis: "carrier_policy" };
    if (doc.claimId && (await db.claim.count({ where: { id: doc.claimId, carrierOrgId: org.orgId } }))) return { doc, basis: "carrier_claim" };
    return deny();
  }
  if (org.orgType === "PLATFORM") {
    if (org.role === "ADMIN") return { doc, basis: "platform_admin" };
    const grant = await db.supportAccessGrant.findFirst({ where: { userId: ctx.user.id, expiresAt: { gt: new Date() }, OR: [{ targetType: "Document", targetId: doc.id }, ...(doc.ownerUserId ? [{ targetType: "Client", targetId: doc.ownerUserId }] : [])] } });
    if (grant) return { doc, basis: `support_grant:${grant.id}` };
    throw err("FORBIDDEN", "Для доступа поддержки нужно основание и срок (запросите доступ)");
  }
  return deny();
}

export async function downloadLink(ctx: Ctx, docId: string) {
  const { doc } = await canAccessDocument(ctx, docId);
  if (doc.status === "QUARANTINE") throw err("RESULT_PENDING", "Файл ещё проверяется");
  if (doc.status === "REJECTED") throw err("FORBIDDEN", "Файл отклонён проверкой");
  return signDownload(doc.id, ctx.user.id);
}

export async function readForDownload(ctx: Ctx, docId: string) {
  const { doc, basis } = await canAccessDocument(ctx, docId);
  if (doc.status === "QUARANTINE" || doc.status === "REJECTED") throw err("FORBIDDEN", "Файл недоступен для скачивания");
  const buf = await getObject(doc.storageKey);
  await db.documentAccessLog.create({ data: { documentId: doc.id, userId: ctx.user.id, orgId: ctx.org?.orgId ?? null, action: "DOWNLOAD", reason: basis } });
  if (basis === "platform_admin" || basis.startsWith("support_grant")) await audit(db, { userId: ctx.user.id, orgId: ctx.org?.orgId, correlationId: ctx.correlationId }, "document.privileged_access", "Document", doc.id, { reason: basis });
  return { doc, buf };
}

/** Явная передача документов конкретному участнику фиксируется в журнале доступа. */
export async function shareWithAgency(tx: Tx, actor: Actor & { userId: string }, documentIds: string[], agencyOrgId: string, reason: string) {
  for (const documentId of documentIds) {
    await tx.documentShare.upsert({ where: { documentId_agencyOrgId: { documentId, agencyOrgId } }, update: {}, create: { documentId, agencyOrgId, grantedBy: actor.userId, reason } });
    await tx.documentAccessLog.create({ data: { documentId, userId: actor.userId, orgId: agencyOrgId, action: "SHARE", reason } });
  }
}

/** Задание worker: антивирус → распознавание (для загрузок к заявке). */
export async function scanDocument(documentId: string) {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.status !== "QUARANTINE") return { skipped: true };
  const buf = await getObject(doc.storageKey);
  const res = await adapters.antivirus.scan(buf);
  if (!res.clean) {
    await db.document.update({ where: { id: doc.id }, data: { status: "REJECTED", scanNote: res.note } });
    return { rejected: true };
  }
  let extracted: any = null;
  if (doc.requestId) {
    const rec = await adapters.ai.recognize(buf, doc.mime);
    extracted = rec;
  }
  await db.document.update({ where: { id: doc.id }, data: { status: "CLEAN", scanNote: res.note, extracted } });
  return { clean: true, suggestions: extracted?.suggestions?.length ?? 0, at: (await now()).toISOString() };
}
