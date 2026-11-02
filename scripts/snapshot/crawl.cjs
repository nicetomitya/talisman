// Снимок интерфейса: обходит страницы по ролям и сохраняет отрисованный HTML.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const BASE = "http://localhost:3000";
const OUT = process.argv[2];
const ROLES = [
  { key: "pub", email: null, start: ["/", "/catalog", "/products/RAIN01", "/products/KASKO_SEV", "/pricing", "/help", "/legal", "/login", "/register"], allow: (p) => !/^\/(c|a|admin|demo|api)(\/|$)/.test(p), max: 25 },
  { key: "client", email: "anna@client.test", start: ["/c", "/c/requests", "/c/requests/new", "/c/policies", "/c/claims", "/c/messages", "/c/documents", "/c/payments", "/c/notifications", "/c/settings", "/c/objects", "/c/mail"], allow: (p) => /^\/c(\/|$)/.test(p), max: 70 },
  { key: "agency", email: "owner@nadezhny.test", start: ["/a", "/a/deals", "/a/claims", "/a/messages", "/a/automation", "/a/products", "/a/rating", "/a/earnings", "/a/subscription", "/a/team", "/a/settings", "/a/notifications"], allow: (p) => /^\/a(\/|$)/.test(p), max: 60 },
  { key: "admin", email: "admin1@talisman.test", start: ["/admin", "/admin/exceptions", "/admin/orgs", "/admin/catalog", "/admin/requests", "/admin/events", "/admin/claims", "/admin/payments", "/admin/billing", "/admin/documents", "/admin/reviews", "/admin/approvals", "/admin/audit", "/admin/integrations", "/demo"], allow: (p) => /^\/(admin|demo)(\/|$)/.test(p) && !p.startsWith("/demo/pay"), max: 50 },
  { key: "carrier", email: "rep@severshield.test", start: ["/admin", "/admin/catalog", "/admin/claims", "/admin/events"], allow: (p) => /^\/admin(\/|$)/.test(p), max: 25 },
];
async function as(page, email) {
  await page.goto(BASE + "/login");
  const s = await page.evaluate(async (email) => {
    const t = decodeURIComponent((document.cookie.match(/tcsrf=([^;]+)/) || [])[1] || "");
    const r = await fetch("/api/auth/demo-switch", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": t }, body: JSON.stringify({ email }) });
    return r.status;
  }, email);
  if (s !== 200) throw new Error("demo-switch " + email + " " + s);
}
(async () => {
  const browser = await chromium.launch();
  const result = {};
  for (const role of ROLES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU" });
    await ctx.addCookies([{ name: "tcookie", value: "necessary", url: BASE }]);
    const page = await ctx.newPage();
    if (role.email) await as(page, role.email);
    const queue = [...role.start], seen = new Set(), pages = {};
    while (queue.length && Object.keys(pages).length < role.max) {
      const p = queue.shift();
      if (seen.has(p)) continue; seen.add(p);
      const r = await page.goto(BASE + p, { waitUntil: "networkidle" }).catch(() => null);
      if (!r || r.status() !== 200 || new URL(page.url()).pathname !== p) continue;
      const links = await page.evaluate(() => {
        document.querySelectorAll("script, link[rel=preload], link[rel=modulepreload], next-route-announcer, nextjs-portal, link[rel=icon]").forEach((e) => e.remove());
        return [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
      });
      pages[p] = await page.content();
      for (const h of links) {
        if (!h || !h.startsWith("/") || h.startsWith("//")) continue;
        const q = h.split(/[?#]/)[0];
        if (role.allow(q) && !seen.has(q)) {
          // Детальные страницы — не больше 4 на раздел, чтобы снимок оставался обозримым.
          const sect = q.split("/").slice(0, -1).join("/");
          const same = [...seen, ...queue].filter((x) => x.split("/").slice(0, -1).join("/") === sect && /[0-9a-f]{8}-/.test(x)).length;
          if (/[0-9a-f]{8}-/.test(q) && same >= 4) continue;
          queue.push(q);
        }
      }
    }
    result[role.key] = pages;
    console.log(role.key, Object.keys(pages).length);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "raw.json"), JSON.stringify(result));
})().catch((e) => { console.error(e); process.exit(1); });
