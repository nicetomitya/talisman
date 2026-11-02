import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { appSecret } from "../config";

export const hashPassword = (p: string) => hash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string, p: string) => verify(h, p).catch(() => false);
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const hmac = (s: string, secret = appSecret()) => createHmac("sha256", secret).update(s).digest("hex");
export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a); const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
/** Код подтверждения хранится только в виде HMAC (не в открытом виде). */
export const hashCode = (code: string, salt: string) => hmac(`otp:${salt}:${code}`);
export function numericCode(len = 6) {
  const b = randomBytes(len);
  return Array.from(b, (x) => (x % 10).toString()).join("");
}
