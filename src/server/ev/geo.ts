/**
 * Справочник мест и станций наблюдения для демо (ТЗ v2, п. 6.1, 7.3).
 * Коды станций — ICAO-коды аэропортов, как их используют публичные метеоархивы; пригодность конкретной
 * станции и ряда для реального контракта НЕ проверена (D19). AI не подставляет станцию сам: пользователь выбирает.
 * Расстояние — целые десятые доли мили; координаты — целые миллионные градуса.
 */
export type Station = { id: string; name: string; distanceMiX10: number; note: string };
export type Place = { key: string; name: string; state: string; timezone: string; aliases: string[]; stations: Station[] };

export const PLACES: Place[] = [
  {
    key: "newport-ri", name: "Newport, RI", state: "RI", timezone: "America/New_York", aliases: ["newport", "narragansett bay"],
    stations: [
      { id: "KUUU", name: "Newport State Airport (KUUU)", distanceMiX10: 35, note: "Inland airport station about 3.5 mi from the harbor; wind over open water is usually stronger than at the airport." },
      { id: "KPVD", name: "Providence T.F. Green Airport (KPVD)", distanceMiX10: 230, note: "About 23 mi north, upwind conditions can differ a lot from the race area." },
    ],
  },
  {
    key: "austin-tx", name: "Austin, TX", state: "TX", timezone: "America/Chicago", aliases: ["austin"],
    stations: [
      { id: "KAUS", name: "Austin-Bergstrom Intl Airport (KAUS)", distanceMiX10: 70, note: "About 7 mi southeast of downtown; summer storms can be very local." },
      { id: "KATT", name: "Camp Mabry (KATT)", distanceMiX10: 30, note: "About 3 mi northwest of downtown." },
    ],
  },
  {
    key: "chicago-il", name: "Chicago, IL", state: "IL", timezone: "America/Chicago", aliases: ["chicago"],
    stations: [
      { id: "KMDW", name: "Chicago Midway Airport (KMDW)", distanceMiX10: 100, note: "About 10 mi southwest of the Loop; the lakefront is often cooler." },
      { id: "KORD", name: "Chicago O'Hare Intl Airport (KORD)", distanceMiX10: 170, note: "About 17 mi northwest of the Loop." },
    ],
  },
  {
    key: "phoenix-az", name: "Phoenix, AZ", state: "AZ", timezone: "America/Phoenix", aliases: ["phoenix"],
    stations: [{ id: "KPHX", name: "Phoenix Sky Harbor Intl Airport (KPHX)", distanceMiX10: 40, note: "About 4 mi east of downtown." }],
  },
  {
    key: "san-diego-ca", name: "San Diego, CA", state: "CA", timezone: "America/Los_Angeles", aliases: ["san diego"],
    stations: [{ id: "KSAN", name: "San Diego Intl Airport (KSAN)", distanceMiX10: 30, note: "On the bay, about 3 mi from downtown." }],
  },
];

export const placeByKey = (k: string | null | undefined) => PLACES.find((p) => p.key === k) ?? null;
export function findPlace(text: string): Place | null {
  const t = text.toLowerCase();
  return PLACES.find((p) => p.aliases.some((a) => new RegExp(`\\b${a}\\b`).test(t))) ?? null;
}
export function stationOf(placeKey: string | null | undefined, stationId: string | null | undefined): Station | null {
  return placeByKey(placeKey)?.stations.find((s) => s.id === stationId) ?? null;
}
