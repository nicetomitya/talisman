import { PDFDocument } from "pdf-lib";
import { requireEmulatorAllowed } from "./emu";

/**
 * Детерминированный эмулятор ИИ (внешний ИИ в P0 отключён).
 * Распознавание: читает «эталонную разметку» демо-файлов (метаданные PDF Keywords: TALISMAN-DEMO-EXTRACT:{...}).
 * Для прочих файлов ничего не придумывает — предлагает заполнить вручную.
 * Содержимое документов — недоверенные данные: найденные инструкции помечаются и игнорируются; инструментов действий у эмулятора нет.
 */
export type Suggestion = { key: string; value: unknown; confidence: number; source: string };
export type Recognition = { suggestions: Suggestion[]; untrustedInstructions: string[]; note: string };
export type ClauseRef = { documentId: string; documentTitle: string; clauseId: string; clauseTitle: string; text: string };
export type Answer = { kind: "ANSWER"; text: string; citations: { documentId: string; clauseId: string }[] } | { kind: "NO_INFO"; text: string } | { kind: "REFUSED_ACTION"; text: string };

export interface AIAdapter {
  recognize(buf: Buffer, mime: string): Promise<Recognition>;
  answer(question: string, clauses: ClauseRef[]): Promise<Answer>;
}

const INJECTION = /(игнорируй|ignore (all|previous)|system:|переведи|сделай меня|администратор|отправь (деньги|платёж)|выдай полис|reveal|раскрой)/i;

export const aiEmulator: AIAdapter = {
  async recognize(buf, mime) {
    requireEmulatorAllowed("AI");
    const untrusted: string[] = [];
    if (mime !== "application/pdf") return { suggestions: [], untrustedInstructions: [], note: "Изображение не распознано эмулятором — заполните поля вручную" };
    let meta: any = null;
    try {
      const pdf = await PDFDocument.load(buf, { updateMetadata: false });
      const kw = pdf.getKeywords() ?? "";
      const subj = pdf.getSubject() ?? "";
      const m = kw.match(/TALISMAN-DEMO-EXTRACT:(\{.*\})/);
      if (m) meta = JSON.parse(m[1]);
      for (const line of subj.split(/\n/)) if (INJECTION.test(line)) untrusted.push(line.slice(0, 200));
    } catch { return { suggestions: [], untrustedInstructions: [], note: "Не удалось прочитать PDF" }; }
    const raw = buf.toString("latin1");
    if (INJECTION.test(raw) && untrusted.length === 0) untrusted.push("Во вложении найден текст, похожий на инструкцию");
    if (!meta) return { suggestions: [], untrustedInstructions: untrusted, note: "Документ не содержит распознаваемых полей — заполните вручную" };
    const suggestions: Suggestion[] = Object.entries(meta.fields ?? {}).map(([key, v]: [string, any]) => ({ key, value: v.value, confidence: Number(v.confidence), source: meta.docType ?? "документ" }));
    return { suggestions, untrustedInstructions: untrusted, note: untrusted.length ? "Найдены инструкции внутри документа — они проигнорированы как недоверенные данные" : "Проверьте предложенные значения" };
  },

  async answer(question, clauses) {
    requireEmulatorAllowed("AI");
    if (/(оформи|отмени договор|переведи|выплати|измени тариф|подпиши|откажи)/i.test(question)) {
      return { kind: "REFUSED_ACTION", text: "Помощник не выполняет действия с договором, деньгами и решениями. Передаю вопрос специалисту." };
    }
    const tokens = stems(question);
    let best: { c: ClauseRef; score: number } | null = null;
    for (const c of clauses) {
      const ct = new Set(stems(c.clauseTitle + " " + c.text));
      const score = tokens.filter((t) => ct.has(t)).length;
      if (!best || score > best.score) best = { c, score };
    }
    if (!best || best.score < 2) return { kind: "NO_INFO", text: "В документах вашего полиса нет сведений по этому вопросу. Передаю обращение специалисту." };
    return { kind: "ANSWER", text: `Согласно документу «${best.c.documentTitle}», п. ${best.c.clauseId} «${best.c.clauseTitle}»: ${best.c.text}`, citations: [{ documentId: best.c.documentId, clauseId: best.c.clauseId }] };
  },
};

const STOP = new Set(["что", "как", "если", "это", "мой", "моя", "мое", "мне", "для", "при", "или", "ли", "по", "на", "в", "и", "а", "не", "у", "о", "об", "из", "за", "до"]);
function stems(s: string): string[] {
  return s.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5));
}
