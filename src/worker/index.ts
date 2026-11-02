import { workerTick } from "@/server/worker";
import { log } from "@/server/audit";
import { db } from "@/server/db";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  log("info", "worker.start", { pid: process.pid, mode: process.env.APP_MODE ?? "demo" });
  while (!stopping) {
    try { await workerTick(); } catch (e: any) { log("error", "worker.tick_failed", { e: String(e?.message ?? e).slice(0, 300) }); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  await db.$disconnect();
  log("info", "worker.stop", {});
}
main();
