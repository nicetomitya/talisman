import { readFileSync } from "node:fs";
import path from "node:path";
/** Тесты работают с отдельной БД talisman_test и отдельным хранилищем. */
export function loadTestEnv() {
  const root = path.resolve(__dirname, "..");
  try {
    for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {}
  process.env.APP_MODE = "demo";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://talisman:talisman@localhost:5432/talisman_test";
  process.env.STORAGE_DIR = path.join(root, "storage/test");
  process.env.APP_SECRET ??= "test-secret-test-secret-test-secret-123";
  process.env.DEMO_PAYMENT_WEBHOOK_SECRET ??= "test-webhook-secret";
}
