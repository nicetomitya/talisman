import { NextResponse } from "next/server";
import { api } from "@/server/api";
import { err } from "@/server/errors";
import { downloadLink, readForDownload } from "@/server/domain/documents";
import { verifyDownload } from "@/server/adapters/storage";

/** link — короткоживущая подписанная ссылка; download — повторная проверка прав и подписи, отдача как вложение. */
export const GET = api({}, async ({ ctx, params, query }) => {
  if (!ctx) throw err("UNAUTHENTICATED", "Войдите");
  if (params.action === "link") return { url: await downloadLink(ctx, params.id) };
  if (params.action === "download") {
    if (!verifyDownload(params.id, ctx.user.id, query.get("exp"), query.get("sig"))) throw err("FORBIDDEN", "Ссылка недействительна или истекла — запросите новую");
    const { doc, buf } = await readForDownload(ctx, params.id);
    const name = encodeURIComponent(`${doc.title}.${doc.mime === "application/pdf" ? "pdf" : doc.mime === "image/png" ? "png" : "jpg"}`);
    return new NextResponse(new Uint8Array(buf), { headers: { "content-type": doc.mime, "content-disposition": `${query.get("inline") === "1" && doc.mime === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${name}`, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "private, no-store", "x-robots-tag": "noindex" } });
  }
  throw err("NOT_FOUND", "Нет ресурса");
});
