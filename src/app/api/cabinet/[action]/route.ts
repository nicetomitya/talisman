import { z } from "zod";
import { api } from "@/server/api";
import { asClient } from "@/server/access";
import { err } from "@/server/errors";
import { addExternalPolicy, archiveExternalPolicy, marketCheck, triageIncident } from "@/server/domain/cabinet";
import { acceptInvitation, confirmLink, revokeLink } from "@/server/domain/crm";
import { rateLimit } from "@/server/auth/ratelimit";

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ГГГГ-ММ-ДД");
const S: Record<string, z.ZodTypeAny> = {
  "external-add": z.object({ category: z.enum(["KASKO", "OSAGO", "PROPERTY", "TRAVEL", "HEALTH", "EVENT", "OTHER"]), insurerName: z.string().min(2).max(200), number: z.string().max(80).optional(), objectTitle: z.string().min(2).max(200), startsAt: date.optional(), endsAt: date, premiumRub: z.number().int().min(0).max(100_000_000).optional() }).strict(),
  "external-archive": z.object({ id }).strict(),
  "market-check": z.object({ id }).strict(),
  triage: z.object({ text: z.string().min(5).max(2000) }).strict(),
  "invite-accept": z.object({ token: z.string().min(16).max(100) }).strict(),
  "link-confirm": z.object({ contactId: id, sharePolicies: z.boolean() }).strict(),
  "link-revoke": z.object({ contactId: id }).strict(),
};

export const POST = api({}, async ({ req, ctx, params }) => {
  const c = asClient(ctx);
  const schema = S[params.action];
  if (!schema) throw err("NOT_FOUND", "Неизвестное действие");
  const p = schema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) throw err("VALIDATION", "Проверьте поля", { fields: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const b: any = p.data;
  switch (params.action) {
    case "external-add": { const { premiumRub, ...rest } = b; const r = await addExternalPolicy(c, { ...rest, premiumKop: premiumRub !== undefined ? premiumRub * 100 : null }); return { id: r.id }; }
    case "external-archive": return archiveExternalPolicy(c, b.id);
    case "market-check": { const r = await marketCheck(c, b.id); return { requestId: r.id }; }
    case "triage": { await rateLimit(`triage:${c.user.id}`, 30, 3600); return triageIncident(c, b.text); }
    case "invite-accept": { await rateLimit(`invite:${c.user.id}`, 20, 3600); return acceptInvitation(c, b.token); }
    case "link-confirm": return confirmLink(c, b.contactId, b);
    case "link-revoke": return revokeLink(c, b.contactId);
  }
});
