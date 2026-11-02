/** Проверка загрузок: реальная проверка сигнатуры содержимого, размера и опасного встроенного содержимого PDF. */
export const ALLOWED = { "application/pdf": "PDF", "image/jpeg": "JPEG", "image/png": "PNG" } as const;
export type AllowedMime = keyof typeof ALLOWED;

export function sniffMime(buf: Buffer): AllowedMime | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

const PDF_ACTIVE = [/\/JavaScript\b/, /\/JS\b/, /\/Launch\b/, /\/EmbeddedFile\b/, /\/RichMedia\b/, /\/XFA\b/, /\/AA\b/];

export function validateUpload(buf: Buffer, declaredMime: string, maxBytes: number): { ok: true; mime: AllowedMime } | { ok: false; reason: string } {
  if (buf.length === 0) return { ok: false, reason: "Пустой файл" };
  if (buf.length > maxBytes) return { ok: false, reason: `Файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ` };
  const mime = sniffMime(buf);
  if (!mime) return { ok: false, reason: "Допустимы только PDF, JPEG и PNG (проверено по содержимому)" };
  if (declaredMime && declaredMime !== mime) return { ok: false, reason: `Тип файла (${declaredMime}) не совпадает с содержимым (${mime})` };
  if (mime === "application/pdf") {
    const s = buf.toString("latin1");
    const hit = PDF_ACTIVE.find((r) => r.test(s));
    if (hit) return { ok: false, reason: "PDF содержит активное встроенное содержимое (скрипты, вложения или автозапуск)" };
  }
  return { ok: true, mime };
}
