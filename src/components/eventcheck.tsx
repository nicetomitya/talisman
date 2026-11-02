import { Status, fmtDate } from "./ui";

/** Прозрачный расчёт параметрического условия: окно, интервалы, источник каждого значения, итог (AC17–AC20). */
export function EventCheckView({ ec, unit, tz }: { ec: any; unit: string; tz: string }) {
  const d = ec.details ?? {};
  const ev = d.evaluation;
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "нет данных" : (v / 100).toFixed(1));
  return (
    <div className="space-y-2 text-sm">
      <p>Статус проверки: <Status group="eventCheck" value={ec.status} /> {ec.result && <>· итог: <Status value={ec.result} text={ec.result === "MET" ? "Условие выполнено" : ec.result === "NOT_MET" ? "Порог не достигнут" : "Нужна проверка"} /></>}</p>
      {ec.status === "SCHEDULED" && <p className="text-muted">Расчёт выполнится автоматически {fmtDate(ec.scheduledAt, true, tz)} (после окончания события и задержки на поступление и исправление данных).</p>}
      {d.window && <p>Окно наблюдения: {fmtDate(d.window.startUtc, true, tz)} – {fmtDate(d.window.endUtc, true, tz)} ({tz}). Правило {d.ruleVersion}: {d.terms.aggregation === "SUM_GTE" ? `сумма не менее ${(d.terms.thresholdX100 / 100).toFixed(1)} ${unit}` : `значение меньше ${(d.terms.thresholdX100 / 100).toFixed(1)} ${unit} минимум в ${d.terms.minIntervals} интервалах`}.</p>}
      {ev && <>
        <div className="tbl-wrap"><table className="tbl tbl-stack"><thead><tr><th>Интервал</th><th>Основной ({d.terms.primary})</th><th>Резервный ({d.terms.backup ?? "—"})</th><th>Использовано</th></tr></thead><tbody>
          {ev.intervals.map((i: any) => <tr key={i.start}><td data-label="Интервал">{new Date(i.start).toLocaleTimeString("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}–{new Date(i.end).toLocaleTimeString("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}</td><td data-label="Основной" className="num">{fmt(i.primary)}</td><td data-label="Резервный" className="num">{fmt(i.backup)}</td><td data-label="Использовано" className="num">{fmt(i.used)}{i.source && i.source !== d.terms.primary ? " (резерв)" : ""}{i.counted !== undefined ? (i.counted ? " ✓" : "") : ""}</td></tr>)}
        </tbody></table></div>
        <p><strong>{ev.explanation}</strong>{ev.aggregateX100 !== null && d.terms.aggregation === "SUM_GTE" ? ` Итог: ${fmt(ev.aggregateX100)} ${unit}.` : ""}</p>
        {d.sourceNotes?.length > 0 && <p className="text-xs text-muted">Источники: {d.sourceNotes.join("; ")}</p>}
        <p className="break-all text-xs text-muted">Хеш доказательной базы: {d.evidenceHash}. Пропуск данных не считается отсутствием события.</p>
      </>}
    </div>
  );
}
