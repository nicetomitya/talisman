import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { appMode } from "@/server/config";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    const hb = await db.setting.findUnique({ where: { key: "worker_heartbeat" } });
    const at = (hb?.value as any)?.at ? new Date((hb!.value as any).at) : null;
    const pending = await db.job.count({ where: { status: "PENDING" } });
    const dead = await db.job.count({ where: { status: "DEAD" } });
    return NextResponse.json({ ok: true, mode: appMode(), db: "ok", worker: at && Date.now() - at.getTime() < 30_000 ? "ok" : "stale", workerHeartbeat: at, jobs: { pending, dead } });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
