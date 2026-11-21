/** Новый US-интерфейс (ТЗ v2) — английский; legacy-страхование (/insurance, /c, /a, /admin, …) — русский. */
const US_PREFIXES = ["/risk", "/markets", "/app", "/ops", "/how-it-works", "/signin", "/experts"];
export const isUsPath = (p: string) => p === "/" || US_PREFIXES.some((x) => p === x || p.startsWith(x + "/"));
