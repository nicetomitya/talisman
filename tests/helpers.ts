import { db } from "@/server/db";
import { buildCtx, type Ctx } from "@/server/access";
import { randomToken, sha256 } from "@/server/auth/crypto";
import { now } from "@/server/clock";
import { allFields } from "@/server/domain/forms";
import { schemaFor } from "@/server/domain/catalog";
import { createRequest, saveDraft, confirmFields, publishRequest } from "@/server/domain/requests";
import { offersForClient, submitQuote } from "@/server/domain/auction";
import { selectQuote, prepareDocuments, acknowledge, requestCode, verifyCode, createPremiumPayment } from "@/server/domain/checkout";
import { emulatorPayerAction } from "@/server/adapters/payment";
import { drainJobs } from "@/server/worker";

export async function ctxFor(email: string, opts: { orgName?: string; mfa?: boolean } = {}): Promise<Ctx> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: { where: { status: "ACTIVE" }, include: { organization: true } } } });
  const org = opts.orgName ? u.memberships.find((m) => m.organization.name === opts.orgName) : u.memberships[0];
  const s = await db.session.create({ data: { tokenHash: sha256(randomToken()), userId: u.id, activeOrgId: org?.organizationId ?? null, mfaVerifiedAt: opts.mfa === false ? null : new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
  return buildCtx({ ...s, user: u }, "test");
}
export const qctx = (c: Ctx) => ({ orgId: c.org!.orgId, userId: c.user.id, correlationId: "test", role: "AGENT" });
export const inDays = async (d: number) => new Date((await now()).getTime() + d * 86400_000).toISOString().slice(0, 10);

export const kaskoData = async (o: any = {}) => ({ car_make: "Kia", car_model: "K5", car_year: 2022, car_value_rub: 2400000, car_vin: "XWEG4417BN0001234", usage: "PERSONAL", owner_name: "Тестовая Анна", drivers_count: 1, min_driver_age: 35, min_experience: 12, claims_3y: 0, risks: ["DAMAGE", "THEFT"], territory: "RU", deductible_rub: "15000", allow_alt_deductible: true, repair_method: "SERVICE", start_date: await inDays(5), region: "RU-SPE", ...o });
export const propData = async (o: any = {}) => ({ city: "Санкт-Петербург", address: "ул. Тестовая, 1", property_type: "APARTMENT", area_m2: 64, construction: "MONOLITH", year_built: 2015, usage: "OWN", cover_objects: ["STRUCTURE", "FINISH", "CONTENTS", "LIABILITY"], value_rub: 5000000, risks: ["FIRE", "WATER"], deductible_rub: "5000", allow_alt_deductible: false, start_date: await inDays(5), ...o });

export async function fill(ctx: Ctx, productCode: string, data: Record<string, any>, publish = true) {
  await db.rateLimit.deleteMany();
  const r = await createRequest(ctx, { productCode });
  const cur = await saveDraft(ctx, r.id, { data, version: r.version });
  const keys = allFields(schemaFor(productCode)).filter((f) => f.keyField && data[f.key] !== undefined && data[f.key] !== "").map((f) => f.key);
  const conf = await confirmFields(ctx, r.id, keys, cur.request.version);
  if (!publish) return conf;
  const pub = await publishRequest(ctx, r.id, conf.version);
  if (!pub.published) throw new Error(`publish failed ${JSON.stringify(pub)}`);
  return db.insuranceRequest.findUniqueOrThrow({ where: { id: r.id } });
}
export async function productId(code: string) { return (await db.product.findUniqueOrThrow({ where: { code } })).id; }
export async function quote(c: Ctx, requestId: string, productCode: string, premiumRub: number, o: { deductibleRub?: number } = {}) {
  const r = await db.insuranceRequest.findUniqueOrThrow({ where: { id: requestId } });
  return submitQuote(qctx(c), { requestId, requestVersion: r.currentVersion, productId: await productId(productCode), premiumKop: premiumRub * 100, deductibleRub: o.deductibleRub, publish: true });
}
export async function toPayment(ctx: Ctx, requestId: string) {
  await db.rateLimit.deleteMany();
  const offers = await offersForClient(ctx, requestId);
  const o = offers.groups.flatMap((g) => g.offers)[0];
  const r = await db.insuranceRequest.findUniqueOrThrow({ where: { id: requestId } });
  const sel = await selectQuote(ctx, { requestId, requestVersion: r.currentVersion, quoteId: o.id, quoteVersion: o.seq });
  await prepareDocuments(ctx, sel.checkout_id);
  const docs = await db.document.findMany({ where: { checkoutId: sel.checkout_id, supersededById: null } });
  for (const d of docs) await acknowledge(ctx, sel.checkout_id, d.id);
  await requestCode(ctx, sel.checkout_id);
  const mail = await db.demoMail.findFirstOrThrow({ where: { userId: ctx.user.id, subject: { contains: "код" } }, orderBy: { createdAt: "desc" } });
  const v = await verifyCode(ctx, sel.checkout_id, mail.body.match(/Код: (\d{6})/)![1]);
  if (!v.ok) throw new Error("verify failed");
  return sel.checkout_id;
}
export async function payAndConclude(ctx: Ctx, checkoutId: string, key = "k-" + checkoutId) {
  const pay = await createPremiumPayment(ctx, checkoutId, key);
  const externalId = pay.confirmationUrl.split("/").pop()!;
  await emulatorPayerAction(externalId, "success");
  await drainJobs();
  return { externalId, policy: await db.policy.findUnique({ where: { checkoutId } }) };
}
import { calculator } from "@/server/domain/auction";
/** Базовая премия по тарифной сетке для заявки (в рублях). */
export async function base(c: Ctx, requestId: string, productCode: string, deductibleRub?: number) {
  const r = await calculator({ ...c, orgId: c.org!.orgId }, requestId, await productId(productCode), deductibleRub);
  if (!r.ok) throw new Error(r.reason);
  return { base: r.basePremiumKop / 100, min: r.minPremiumKop / 100, max: r.maxPremiumKop / 100 };
}
