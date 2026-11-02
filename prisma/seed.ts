import { resetDemo } from "../src/server/demo/seed";
import { db } from "../src/server/db";

process.env.LOG_QUIET = "1";
const t0 = Date.now();
resetDemo((s) => console.log(`[seed] ${s}`))
  .then(() => console.log(`[seed] готово за ${((Date.now() - t0) / 1000).toFixed(1)} с`))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
