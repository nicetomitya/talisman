import { db } from "./db";

/** DemoClock: системное время сценария = реальное время + смещение из таблицы Setting. ОС не трогаем. */
const KEY = "demo_clock";

export async function getOffsetMs(): Promise<number> {
  const s = await db.setting.findUnique({ where: { key: KEY } });
  return Number((s?.value as any)?.offsetMs ?? 0);
}

export async function now(): Promise<Date> {
  return new Date(Date.now() + (await getOffsetMs()));
}

export async function setNow(target: Date): Promise<void> {
  const offsetMs = target.getTime() - Date.now();
  await db.setting.upsert({ where: { key: KEY }, update: { value: { offsetMs } }, create: { key: KEY, value: { offsetMs } } });
}

export async function advance(ms: number): Promise<Date> {
  const offsetMs = (await getOffsetMs()) + ms;
  await db.setting.upsert({ where: { key: KEY }, update: { value: { offsetMs } }, create: { key: KEY, value: { offsetMs } } });
  return new Date(Date.now() + offsetMs);
}

export async function resetClock(): Promise<void> {
  await db.setting.deleteMany({ where: { key: KEY } });
}
