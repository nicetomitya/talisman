import { db, txRetry } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { actor, type Ctx } from "../access";
import { now } from "../clock";
import { calculator, submitQuote, assertAgencyMayQuote } from "./auction";
import { assertCanRespond, planAllows } from "./subscriptions";
import { raiseException } from "./exceptions";
import { notifyOrg } from "./notify";
import { activeTariff, productsForCode } from "./catalog";
import { applyBp } from "../money";
import { z } from "zod";

type Step = { step: string; ok: boolean; note: string };

export const RuleSchema = z.object({
  mode: z.enum(["MANUAL", "CONFIRM", "AUTO"]),
  productCodes: z.array(z.enum(["KASKO", "PROPERTY"])).max(2),
  territories: z.array(z.string().max(20)).max(20),
  maxSumInsuredRub: z.number().int().min(100000).max(100000000),
  maxVehicleAge: z.number().int().min(0).max(30),
  tariffMaxAgeDays: z.number().int().min(1).max(365),
  maxContractsPerDay: z.number().int().min(1).max(1000),
  dailyResponseLimit: z.number().int().min(1).max(2000),
  minCommissionBp: z.number().int().min(0).max(5000),
  improveMode: z.enum(["NONE", "ONE_STEP"]),
  manualReasons: z.array(z.enum(["TAXI_OR_RENTAL", "YOUNG_DRIVER", "PRIOR_CLAIMS", "INSPECTION_REQUIRED", "RENT_OUT"])).max(10),
}).strict();

export async function saveRule(ctx: Ctx & { orgId: string }, data: z.infer<typeof RuleSchema>) {
  if (data.mode !== "MANUAL" && !(await planAllows(db, ctx.orgId, "autoReply"))) throw err("FORBIDDEN", "Правила автоответа доступны на тарифах «Про» и «Команда»");
  const r = await db.automationRule.upsert({ where: { organizationId: ctx.orgId }, update: { ...data, version: { increment: 1 } }, create: { organizationId: ctx.orgId, ...data } });
  await audit(db, actor(ctx), "automation.rule_saved", "AutomationRule", r.id, { after: data });
  return r;
}

/**
 * Цепочка автоответа (детерминированные правила). Повторный запуск по тому же событию не создаёт дубликат —
 * AutomationRun уникален по (агентство, заявка, версия). Устаревший тариф или недостаток данных → черновик или задача (AC21).
 * Цена никогда не ниже разрешённой границы: используется базовая премия тарифной сетки.
 */
export async function evaluateAutomation(orgId: string, requestId: string, requestVersion: number) {
  const existing = await db.automationRun.findUnique({ where: { organizationId_requestId_requestVersion: { organizationId: orgId, requestId, requestVersion } } });
  if (existing) return { duplicate: true, run: existing };
  const t = await now();
  const steps: Step[] = [];
  const rule = await db.automationRule.findUnique({ where: { organizationId: orgId } });
  const finish = async (result: "SENT" | "DRAFT" | "TASK" | "SKIPPED" | "BLOCKED", quoteId?: string, taskNote?: string) => {
    try {
      const run = await db.automationRun.create({ data: { organizationId: orgId, requestId, requestVersion, mode: rule?.mode ?? "MANUAL", result, steps, quoteId } });
      if (result === "TASK" || result === "DRAFT") {
        await db.task.create({ data: { organizationId: orgId, title: result === "DRAFT" ? "Проверьте черновик автоответа" : "Заявка требует ручного рассмотрения", note: taskNote ?? steps.filter((s) => !s.ok).map((s) => s.note).join("; "), relatedType: "InsuranceRequest", relatedId: requestId, dueAt: new Date(t.getTime() + 3600_000) } });
        await raiseException(db, { type: "AUTOMATION", priority: "NORMAL", organizationId: orgId, entityType: "InsuranceRequest", entityId: requestId, reason: taskNote ?? (steps.filter((s) => !s.ok).map((s) => s.note).join("; ") || "Требуется подтверждение агента"), nextAction: result === "DRAFT" ? "Агент проверяет и отправляет черновик" : "Агент рассматривает заявку вручную", dueAt: new Date(t.getTime() + 3600_000), dedupeKey: `auto:${orgId}:${requestId}:${requestVersion}` });
        await notifyOrg(db, orgId, { type: "automation.exception", title: result === "DRAFT" ? "Автоответ подготовил черновик" : "Исключение автоответа", body: taskNote ?? "Нужна проверка агента", link: `/a/requests/${requestId}` });
      }
      return { duplicate: false, run };
    } catch (e: any) {
      if (e?.code === "P2002") return { duplicate: true, run: await db.automationRun.findUnique({ where: { organizationId_requestId_requestVersion: { organizationId: orgId, requestId, requestVersion } } }) };
      throw e;
    }
  };
  if (!rule || rule.mode === "MANUAL") { steps.push({ step: "rule", ok: true, note: "Ручной режим: система помогает заполнить, отправку подтверждает агент" }); return finish("SKIPPED"); }

  // 1. Права и подписка
  const r = await db.insuranceRequest.findUnique({ where: { id: requestId } });
  if (!r) return finish("BLOCKED");
  try {
    await txRetry(async (tx) => { await assertCanRespond(tx, orgId, requestId, t); });
    if (!(await planAllows(db, orgId, "autoReply"))) throw err("FORBIDDEN", "Тариф не включает автоответ");
    steps.push({ step: "rights_subscription", ok: true, note: "Подписка допускает новые ответы и автоответ" });
  } catch (e: any) { steps.push({ step: "rights_subscription", ok: false, note: e.message }); return finish("BLOCKED"); }
  // 2. Версия и полнота заявки
  if (r.currentVersion !== requestVersion || r.status !== "OPEN") { steps.push({ step: "request_version", ok: false, note: "Версия заявки изменилась или торги не открыты" }); return finish("SKIPPED"); }
  const v = await db.requestVersion.findUniqueOrThrow({ where: { requestId_version: { requestId, version: requestVersion } } });
  const d = v.publicData as any;
  const own = await db.quote.count({ where: { requestId, requestVersion, agencyOrgId: orgId, status: { in: ["DRAFT", "PUBLISHED", "SELECTED"] } } });
  if (own) { steps.push({ step: "request_version", ok: true, note: "У агентства уже есть предложение по этой версии — автоответ не дублирует" }); return finish("SKIPPED"); }
  if (!(rule.productCodes as string[]).includes(r.productCode)) { steps.push({ step: "product", ok: false, note: `Продукт ${r.productCode} не входит в правило` }); return finish("SKIPPED"); }
  const terr = (rule.territories as string[]);
  if (terr.length && !terr.includes(d.region ?? d.city)) { steps.push({ step: "territory", ok: false, note: "Территория не входит в правило" }); return finish("SKIPPED"); }
  steps.push({ step: "request_version", ok: true, note: `Версия ${requestVersion}, анкета полная` });
  const reasons: string[] = [];
  const mr = rule.manualReasons as string[];
  const sum = Number(d.car_value_rub ?? d.value_rub ?? 0);
  if (sum > rule.maxSumInsuredRub) reasons.push(`Страховая сумма ${sum} ₽ выше лимита правила`);
  if (r.productCode === "KASKO" && t.getUTCFullYear() - Number(d.car_year) > rule.maxVehicleAge) reasons.push("Возраст автомобиля выше допустимого");
  if (mr.includes("TAXI_OR_RENTAL") && ["TAXI", "RENTAL"].includes(d.usage)) reasons.push("Использование в такси/аренде — ручное рассмотрение");
  if (mr.includes("YOUNG_DRIVER") && Number(d.min_driver_age) < 25) reasons.push("Молодой водитель — ручное рассмотрение");
  if (mr.includes("PRIOR_CLAIMS") && Number(d.claims_3y) > 0) reasons.push("Были страховые случаи — ручное рассмотрение");
  if (mr.includes("RENT_OUT") && ["RENT_OUT", "COMMERCIAL"].includes(d.usage)) reasons.push("Сдача в аренду — ручное рассмотрение");
  if (reasons.length) { steps.push({ step: "risk_rules", ok: false, note: reasons.join("; ") }); return finish("TASK", undefined, reasons.join("; ")); }
  steps.push({ step: "risk_rules", ok: true, note: "Характеристики риска в пределах правила" });
  // 3. Полномочия
  const products = await productsForCode(db, r.productCode);
  let chosen: (typeof products)[number] | null = null;
  for (const p of products) { try { await assertAgencyMayQuote(db, orgId, p.id, t); chosen = p; break; } catch {} }
  if (!chosen) { steps.push({ step: "mandate", ok: false, note: "Нет действующих полномочий по продукту" }); return finish("BLOCKED"); }
  steps.push({ step: "mandate", ok: true, note: `Полномочия по продукту ${chosen.code}` });
  // 4. Разрешённая котировка
  const ctxLike = { orgId, user: { id: "00000000-0000-0000-0000-000000000000" } } as any;
  const calc = await calculator(ctxLike, requestId, chosen.id).catch((e) => ({ ok: false as const, reason: e.message }));
  if (!calc.ok) { steps.push({ step: "quote", ok: false, note: calc.reason }); return finish("TASK", undefined, calc.reason); }
  const { tariff } = await activeTariff(db, chosen.id, chosen.carrierOrgId, t);
  const ageDays = tariff ? (t.getTime() - tariff.createdAt.getTime()) / 86400_000 : Infinity;
  const stale = calc.stale || ageDays > rule.tariffMaxAgeDays;
  if (calc.inspectionRequired && mr.includes("INSPECTION_REQUIRED")) { steps.push({ step: "quote", ok: false, note: "Нужен осмотр" }); return finish("TASK", undefined, "Нужен предстраховой осмотр"); }
  steps.push({ step: "quote", ok: !stale, note: stale ? `Тариф устарел (${calc.staleReason ?? `старше ${rule.tariffMaxAgeDays} дн.`}) — только черновик` : `Тарифная версия ${calc.tariffVersion}, базовая премия ${calc.basePremiumKop / 100} ₽` });
  // 5. Лимиты
  const todayStart = new Date(t.toISOString().slice(0, 10) + "T00:00:00Z");
  const sentToday = await db.automationRun.count({ where: { organizationId: orgId, result: "SENT", createdAt: { gte: todayStart } } });
  if (sentToday >= rule.dailyResponseLimit) { steps.push({ step: "limits", ok: false, note: "Дневной лимит автоответов исчерпан" }); return finish("TASK", undefined, "Дневной лимит автоответов исчерпан"); }
  steps.push({ step: "limits", ok: true, note: `Отправлено сегодня: ${sentToday} из ${rule.dailyResponseLimit}` });
  // 6. Комиссия
  if (calc.commissionBp < rule.minCommissionBp) { steps.push({ step: "commission", ok: false, note: "Вознаграждение ниже минимального" }); return finish("SKIPPED"); }
  steps.push({ step: "commission", ok: true, note: `Вознаграждение ${applyBp(calc.basePremiumKop, calc.commissionBp) / 100} ₽` });
  // 7–8. Публикация и версия предложения
  const publish = rule.mode === "AUTO" && !stale;
  try {
    const res = await submitQuote({ orgId, userId: null, role: "SYSTEM" }, { requestId, requestVersion, productId: chosen.id, premiumKop: calc.basePremiumKop, publish, via: rule.mode === "AUTO" ? "AUTO" : "CONFIRM" });
    steps.push({ step: "publish", ok: true, note: publish ? "Предложение опубликовано автоматически" : res.draftReason ?? "Подготовлен черновик для подтверждения агентом" });
    return finish(publish ? "SENT" : "DRAFT", res.quote.id, publish ? undefined : steps.filter((s) => !s.ok).map((s) => s.note).join("; ") || "Режим с подтверждением: проверьте и отправьте");
  } catch (e: any) {
    steps.push({ step: "publish", ok: false, note: e.message });
    return finish("TASK", undefined, e.message);
  }
}
