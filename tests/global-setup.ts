import { execSync } from "node:child_process";
import { loadTestEnv } from "./env";

/** Один раз: миграции и сид в тестовой БД (сид идёт через доменные операции). */
export default async function () {
  loadTestEnv();
  const env = { ...process.env };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
