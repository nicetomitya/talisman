import { generateSecret, generateSync, verifySync, generateURI } from "otplib";

export const newTotpSecret = () => generateSecret();
export const totpNow = (secret: string) => generateSync({ secret });
export function verifyTotp(secret: string, token: string): boolean {
  try { return verifySync({ secret, token, epochTolerance: 30 } as any).valid; } catch { return false; }
}
export const totpUri = (secret: string, email: string) => generateURI({ secret, label: email, issuer: "Talisman Demo" } as any);
