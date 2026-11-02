import { PDFDocument, rgb, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../auth/crypto";
import { putObject } from "./storage";

export const DEMO_BANNER = "Демонстрационный документ. Не является действующим страховым полисом";

export type Clause = { id: string; title: string; text: string };
export type DocTemplate = { code: string; version: number; title: string; fields: [string, string][]; clauses: Clause[]; footer?: string };

export interface DocumentAdapter {
  render(t: DocTemplate): Promise<{ buf: Buffer; sha256: string; storageKey: string; size: number }>;
}

let fontCache: Buffer | null = null;
async function font() {
  if (fontCache) return fontCache;
  const candidates = [path.resolve("assets/fonts/DejaVuSans.ttf"), "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"];
  for (const c of candidates) { try { fontCache = await readFile(c); return fontCache; } catch {} }
  throw new Error("Шрифт DejaVuSans.ttf не найден (assets/fonts)");
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/); const lines: string[] = []; let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > max) { if (cur) lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) lines.push(cur);
  return lines;
}

/** Локальный DocumentAdapter: версионированный шаблон → PDF с водяным знаком, SHA-256, приватное хранение. */
export const documentAdapter: DocumentAdapter = {
  async render(t) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const f = await pdf.embedFont(await font(), { subset: true });
    pdf.setTitle(`${t.title} (демо)`); pdf.setProducer("Talisman P0 demo"); pdf.setCreationDate(new Date(0)); pdf.setModificationDate(new Date(0));
    let page = pdf.addPage([595, 842]);
    let y = 800;
    const newPageIfNeeded = () => { if (y < 70) { page = pdf.addPage([595, 842]); y = 800; } };
    const stamp = (p: typeof page) => {
      p.drawRectangle({ x: 30, y: 812, width: 535, height: 22, color: rgb(1, 0.95, 0.8) });
      p.drawText(DEMO_BANNER, { x: 40, y: 819, size: 9, font: f, color: rgb(0.5, 0.25, 0) });
      p.drawText("ДЕМО", { x: 150, y: 350, size: 120, font: f, color: rgb(0.93, 0.93, 0.93), rotate: degrees(35) });
      p.drawText(`Шаблон ${t.code} v${t.version}`, { x: 40, y: 30, size: 7, font: f, color: rgb(0.4, 0.4, 0.4) });
    };
    page.drawText(t.title, { x: 40, y, size: 15, font: f }); y -= 28;
    for (const [k, v] of t.fields) {
      newPageIfNeeded();
      page.drawText(k + ":", { x: 40, y, size: 9, font: f, color: rgb(0.35, 0.35, 0.35) });
      const lines = wrap(v, 60);
      lines.forEach((ln, i) => page.drawText(ln, { x: 230, y: y - i * 12, size: 9, font: f }));
      y -= 14 * Math.max(1, lines.length);
    }
    y -= 10;
    for (const c of t.clauses) {
      newPageIfNeeded();
      page.drawText(`п. ${c.id}. ${c.title}`, { x: 40, y, size: 10, font: f }); y -= 14;
      for (const ln of wrap(c.text, 95)) { newPageIfNeeded(); page.drawText(ln, { x: 48, y, size: 9, font: f }); y -= 12; }
      y -= 6;
    }
    if (t.footer) { newPageIfNeeded(); page.drawText(t.footer, { x: 40, y, size: 8, font: f, color: rgb(0.4, 0.4, 0.4) }); }
    for (const p of pdf.getPages()) stamp(p);
    const buf = Buffer.from(await pdf.save({ useObjectStreams: false }));
    const storageKey = await putObject(buf);
    return { buf, sha256: sha256(buf), storageKey, size: buf.length };
  },
};
