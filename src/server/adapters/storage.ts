import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hmac, safeEqual } from "../auth/crypto";

/** Приватное хранилище вне public. Ключи — случайные UUID, без пользовательских имён файлов. */
const root = () => path.resolve(process.env.STORAGE_DIR ?? "./storage/private");

export async function putObject(buf: Buffer): Promise<string> {
  const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf, { mode: 0o600 });
  return key;
}
export async function getObject(key: string): Promise<Buffer> {
  if (!/^[0-9]{4}-[0-9]{2}\/[0-9a-f-]{36}$/.test(key)) throw new Error("bad key");
  return readFile(path.join(root(), key));
}

/** Короткоживущая ссылка на скачивание: HMAC(documentId, userId, exp). Права проверяются повторно при скачивании. */
export function signDownload(documentId: string, userId: string, ttlSec = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = hmac(`dl:${documentId}:${userId}:${exp}`);
  return `/api/documents/${documentId}/download?exp=${exp}&sig=${sig}`;
}
export function verifyDownload(documentId: string, userId: string, exp: string | null, sig: string | null) {
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(hmac(`dl:${documentId}:${userId}:${exp}`), sig);
}
