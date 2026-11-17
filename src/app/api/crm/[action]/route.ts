import { z } from "zod";
import { api } from "@/server/api";
import { asAgency } from "@/server/access";
import { err } from "@/server/errors";
import * as CRM from "@/server/domain/crm";

const basis = z.enum(Object.keys(CRM.LEGAL_BASES) as [CRM.LegalBasis, ...CRM.LegalBasis[]]);
const channel = z.enum(Object.keys(CRM.CHANNELS) as [keyof typeof CRM.CHANNELS, ...(keyof typeof CRM.CHANNELS)[]]);
const id = z.string().uuid();
const optId = z.preprocess((v) => (v === "" ? null : v), id.nullable()).optional();
const date = z.string().regex(/^(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})$/, "ГГГГ-ММ-ДД");

// Строгие схемы: нельзя передать organizationId, статус связи, linkedUserId и т. п.
const S: Record<string, z.ZodTypeAny> = {
  "contact-create": z.object({ name: z.string().min(2).max(200), phone: z.string().max(40).optional(), email: z.string().max(200).optional(), legalBasis: basis, notes: z.string().max(2000).optional(), responsibleUserId: optId }).strict(),
  "contact-update": z.object({ contactId: id, version: z.number().int(), name: z.string().min(2).max(200).optional(), phone: z.string().max(40).optional(), email: z.string().max(200).optional(), legalBasis: basis.optional(), notes: z.string().max(2000).optional(), responsibleUserId: optId }).strict(),
  "policy-add": z.object({ contactId: id, category: z.string().max(40), insurerName: z.string().min(2).max(200), number: z.string().max(80).optional(), objectTitle: z.string().min(2).max(200), startsAt: date.optional(), endsAt: date.optional(), premiumRub: z.number().int().min(0).max(100_000_000).optional() }).strict(),
  interaction: z.object({ contactId: id, kind: z.enum(["NOTE", "CALL", "MESSAGE_SENT_MANUAL"]), text: z.string().min(2).max(4000), channel: channel.optional() }).strict(),
  task: z.object({ contactId: id, title: z.string().min(3).max(200), dueAt: date.optional(), note: z.string().max(1000).optional() }).strict(),
  import: z.object({ fileName: z.string().min(1).max(200), csv: z.string().min(1).max(2_000_000), legalBasis: basis, confirmBasis: z.literal(true, { errorMap: () => ({ message: "Подтвердите основание обработки данных" }) }), responsibleUserId: optId }).strict(),
  "invite-prepare": z.object({ contactId: id }).strict(),
  "invite-sent": z.object({ contactId: id, channel }).strict(),
  draft: z.object({ contactId: id, purpose: z.enum(["RENEWAL", "CHECKIN"]) }).strict(),
};

export const POST = api({}, async ({ req, ctx, params }) => {
  const a = asAgency(ctx);
  const schema = S[params.action];
  if (!schema) throw err("NOT_FOUND", "Неизвестное действие");
  const p = schema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) throw err("VALIDATION", "Проверьте поля", { fields: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const b: any = p.data;
  switch (params.action) {
    case "contact-create": { const c = await CRM.createContact(a, b); return { contactId: c.id }; }
    case "contact-update": { const { contactId, ...rest } = b; const c = await CRM.updateContact(a, contactId, rest); return { contactId: c.id, version: c.version }; }
    case "policy-add": { const { contactId, premiumRub, ...rest } = b; const r = await CRM.addCrmPolicy(a, contactId, { ...rest, premiumKop: premiumRub !== undefined ? premiumRub * 100 : null }); return { id: r.id }; }
    case "interaction": { const r = await CRM.addInteraction(a, b.contactId, b); return { id: r.id }; }
    case "task": { const r = await CRM.addTask(a, b.contactId, b); return { id: r.id }; }
    case "import": { const { confirmBasis, ...rest } = b; return CRM.importContacts(a, rest); }
    case "invite-prepare": return CRM.prepareInvitation(a, b.contactId);
    case "invite-sent": { await CRM.markInvitationSent(a, b.contactId, b.channel); return { ok: true }; }
    case "draft": return CRM.draftMessage(a, b.contactId, b.purpose);
  }
});
