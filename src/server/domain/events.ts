import { db, txRetry, type Tx } from "../db";
import { err } from "../errors";
import { audit } from "../audit";
import { now } from "../clock";
import { assertTransition } from "../state/machines";
import { enqueue } from "../jobs";
import { adapters } from "../adapters";
import { evaluate, counterToIncrements, type EventTerms, type Window } from "./eventcalc";
import { raiseException } from "./exceptions";
import { notify } from "./notify";
import { lockRow } from "./requests";
import { createParametricClaim } from "./claims";
import { sha256 } from "../auth/crypto";
import { stableStringify } from "../idempotency";
import type { Ctx } from "../access";
import { actor } from "../access";

export async function policyEventTerms(tx: Tx | typeof db, policyId: string) {
  const p = await tx.policy.findUniqueOrThrow({ where: { id: policyId } });
  const pv = await tx.productVersion.findUniqueOrThrow({ where: { id: p.productVersionId } });
  const terms = (pv.terms as any).event as EventTerms; // снимок версии продукта на момент продажи (неизменяем)
  const ev = (p.terms as any).event;
  const start = new Date(ev.startUtc), end = new Date(ev.endUtc);
  const intervals = [];
  for (let t = start.getTime(); t < end.getTime(); t += terms.intervalMinutes * 60_000) intervals.push({ start: new Date(t), end: new Date(t + terms.intervalMinutes * 60_000) });
  const window: Window = { startUtc: start, endUtc: end, intervals, timezone: ev.timezone };
  return { policy: p, terms, window };
}

export async function scheduleEventCheck(tx: Tx, policyId: string) {
  const { policy, terms } = await policyEventTerms(tx, policyId);
  const runAt = new Date(policy.endsAt.getTime() + terms.finalizationDelayHours * 3600_000);
  const ec = await tx.eventCheck.upsert({ where: { policyId }, update: {}, create: { policyId, ruleVersion: terms.ruleVersion, scheduledAt: runAt } });
  await enqueue(tx, "event.check", { policyId }, { runAt, uniqueKey: `event.check:${policyId}:sched` });
  return ec;
}

/** Получение и нормализация наблюдений. Повторное получение не создаёт дублей; изменённое значение — новая ревизия (CORRECTED). */
export async function ingestObservations(source: string, stationId: string, window: Window) {
  const res = await adapters.weather.fetch(source, stationId, window.startUtc, window.endUtc);
  const intervalMs = window.intervals[0] ? window.intervals[0].end.getTime() - window.intervals[0].start.getTime() : 3600_000;
  const values = res.meta.format === "COUNTER"
    ? counterToIncrements(res.readings.map((r) => ({ at: new Date(r.at), counterX100: r.valueX100 })), intervalMs / 60000).map((x) => ({ start: x.start, valueX100: x.valueX100 }))
    : res.readings.map((r) => ({ start: new Date(r.at), valueX100: r.valueX100 }));
  let created = 0, corrected = 0;
  for (const v of values) {
    const last = await db.observation.findFirst({ where: { source, stationId, metric: res.meta.metric, intervalStart: v.start }, orderBy: { revision: "desc" } });
    if (last && last.valueX100 === v.valueX100) continue;
    const revision = (last?.revision ?? 0) + 1;
    await db.observation.createMany({ data: [{ source, stationId, metric: res.meta.metric, intervalStart: v.start, intervalEnd: new Date(v.start.getTime() + intervalMs), valueX100: v.valueX100, quality: last ? "CORRECTED" : "OK", revision, rawPayload: { fetchedAt: res.fetchedAt, format: res.meta.format } }], skipDuplicates: true });
    if (last) corrected++; else created++;
  }
  return { created, corrected, meta: res.meta };
}

async function latestValues(source: string, stationId: string, window: Window) {
  const rows = await db.observation.findMany({ where: { source, stationId, intervalStart: { gte: window.startUtc, lt: window.endUtc } }, orderBy: { revision: "asc" } });
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.intervalStart.getTime(), r.valueX100);
  return { map: m, corrected: rows.some((r) => r.quality === "CORRECTED") };
}

/**
 * Фоновая проверка параметрического условия. Повторный запуск идемпотентен: одна проверка — не более одного
 * основания на выплату (AC16–AC19). Пропуск данных → резерв или ручная работа, а не отказ.
 */
export async function runEventCheck(policyId: string, opts: { force?: boolean } = {}) {
  const { policy, terms, window } = await policyEventTerms(db, policyId);
  const t = await now();
  const ec0 = await db.eventCheck.findUnique({ where: { policyId } });
  if (!ec0) throw err("NOT_FOUND", "Проверка не запланирована");
  if (policy.contractStatus !== "CONCLUDED" && policy.contractStatus !== "EXPIRED") return { skipped: "policy_not_concluded" };
  const dueAt = new Date(policy.endsAt.getTime() + terms.finalizationDelayHours * 3600_000);
  if (t < dueAt && !opts.force) { await enqueue(db, "event.check", { policyId }, { runAt: dueAt, uniqueKey: `event.check:${policyId}:sched` }); return { rescheduled: dueAt }; }
  if (ec0.status === "COMPLETED" && !opts.force) return { skipped: "completed" };
  if (ec0.status === "SPECIALIST_REVIEW" && !opts.force) return { skipped: "in_review" };

  await txRetry(async (tx) => {
    const ec = await tx.eventCheck.findUniqueOrThrow({ where: { policyId } });
    if (ec.status !== "COLLECTING") { assertTransition("eventCheck", ec.status === "COMPLETED" ? "CALCULATED" : ec.status, "COLLECTING", "SYSTEM"); }
    await tx.eventCheck.update({ where: { id: ec.id }, data: { status: "COLLECTING", runs: { increment: 1 }, version: { increment: 1 } } });
  });

  const sourceNotes: string[] = [];
  for (const src of [terms.primary, terms.backup].filter(Boolean) as EventTerms["primary"][]) {
    try { const r = await ingestObservations(src.source, src.stationId, window); if (r.corrected) sourceNotes.push(`${src.source}: исправленных наблюдений ${r.corrected}`); }
    catch (e: any) { sourceNotes.push(`${src.source}: ${e.message}`); }
  }
  const p = await latestValues(terms.primary.source, terms.primary.stationId, window);
  const b = terms.backup ? await latestValues(terms.backup.source, terms.backup.stationId, window) : { map: new Map<number, number>(), corrected: false };
  const ev = evaluate(terms, window, p.map, b.map);
  const evidence = { ruleVersion: terms.ruleVersion, terms: { metric: terms.metric, thresholdX100: terms.thresholdX100, aggregation: terms.aggregation, minIntervals: terms.minIntervals, primary: terms.primary.source, backup: terms.backup?.source }, window: { startUtc: window.startUtc, endUtc: window.endUtc, timezone: window.timezone }, evaluation: ev, sourceNotes, calculatedAt: t.toISOString() };
  const evidenceHash = sha256(stableStringify(evidence));

  return txRetry(async (tx) => {
    await lockRow(tx, "EventCheck", ec0.id);
    const ec = await tx.eventCheck.findUniqueOrThrow({ where: { id: ec0.id } });
    const hadPayout = await tx.payoutItem.findFirst({ where: { policyId, basisKey: ec.id } });
    const details = { ...evidence, evidenceHash, correctedAfterPayout: !!hadPayout && (p.corrected || b.corrected) };
    if (hadPayout && (p.corrected || b.corrected)) {
      assertTransition("eventCheck", "COLLECTING", "SPECIALIST_REVIEW", "SYSTEM");
      await tx.eventCheck.update({ where: { id: ec.id }, data: { status: "SPECIALIST_REVIEW", details: details as any, version: { increment: 1 } } });
      await raiseException(tx, { type: "OBSERVATION", priority: "HIGH", entityType: "EventCheck", entityId: ec.id, reason: "Наблюдения исправлены после выплаты", nextAction: "Проверить исправление; выплата не увеличивается автоматически", dueAt: new Date(t.getTime() + 24 * 3600_000), dedupeKey: `corrected:${ec.id}` });
      return { outcome: "CORRECTED_AFTER_PAYOUT" };
    }
    if (ev.outcome === "NEEDS_DATA" || ev.outcome === "CONFLICT") {
      const to = ev.outcome === "CONFLICT" ? "SPECIALIST_REVIEW" : "NEEDS_DATA";
      assertTransition("eventCheck", "COLLECTING", to, "SYSTEM");
      await tx.eventCheck.update({ where: { id: ec.id }, data: { status: to, result: "UNKNOWN", details: details as any, version: { increment: 1 } } });
      const claim = await createParametricClaim(tx, policy.id, ec.id, "REVIEWING", ev.explanation);
      await raiseException(tx, { type: "OBSERVATION", priority: "HIGH", entityType: "EventCheck", entityId: ec.id, reason: ev.outcome === "CONFLICT" ? "Конфликт основного и резервного источников" : `Нет данных за ${ev.missing} интервал(а) в обоих источниках`, nextAction: "Специалист: запросить сведения/резервные данные, затем вынести решение с причиной", dueAt: new Date(t.getTime() + 48 * 3600_000), dedupeKey: `obs:${ec.id}`, assigneeId: null });
      await notify(tx, policy.clientId, { type: "event.checking", title: "Проверяем данные о событии", body: ev.outcome === "CONFLICT" ? "Источники данных расходятся — проверку выполнит специалист." : "Данных за часть интервалов нет. Это не означает, что событие не наступило: проверку выполнит специалист.", link: `/c/policies/${policy.id}`, dedupeKey: `event.checking:${ec.id}:${ec.runs}` });
      await audit(tx, { role: "SYSTEM" }, "event.needs_review", "EventCheck", ec.id, { after: { outcome: ev.outcome, claimId: claim.id } });
      return { outcome: ev.outcome };
    }
    assertTransition("eventCheck", "COLLECTING", "CALCULATED", "SYSTEM");
    await tx.eventCheck.update({ where: { id: ec.id }, data: { status: "CALCULATED", result: ev.outcome, details: details as any, calculatedAt: t, version: { increment: 1 } } });
    await notify(tx, policy.clientId, { type: "event.result", title: ev.outcome === "MET" ? "Условие выполнено" : "Порог не достигнут", body: ev.explanation, link: `/c/policies/${policy.id}`, dedupeKey: `event.result:${ec.id}:${ev.outcome}` });
    if (ev.outcome === "MET") {
      await createParametricClaim(tx, policy.id, ec.id, "AUTO", ev.explanation);
    } else {
      assertTransition("eventCheck", "CALCULATED", "COMPLETED", "SYSTEM");
      await tx.eventCheck.update({ where: { id: ec.id }, data: { status: "COMPLETED" } });
    }
    await audit(tx, { role: "SYSTEM" }, "event.calculated", "EventCheck", ec.id, { after: { outcome: ev.outcome, aggregateX100: ev.aggregateX100, evidenceHash } });
    return { outcome: ev.outcome, claim: ev.outcome === "MET" };
  });
}

/** Решение специалиста по проверке (сценарий В). Окончательный отказ — только человеком с причиной. */
export async function specialistRecollect(ctx: Ctx, eventCheckId: string, reason: string) {
  const ec = await db.eventCheck.findUniqueOrThrow({ where: { id: eventCheckId } });
  if (!["NEEDS_DATA", "SPECIALIST_REVIEW"].includes(ec.status)) throw err("INVALID_TRANSITION", "Повторный сбор сейчас недоступен");
  await audit(db, actor(ctx), "event.recollect", "EventCheck", ec.id, { reason });
  return runEventCheck(ec.policyId, { force: true });
}
