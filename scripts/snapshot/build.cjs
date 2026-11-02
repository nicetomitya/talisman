const fs = require("node:fs");
const path = require("node:path");
const raw = require("./snap/raw.json");
const OUT = path.resolve("site"); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
fs.copyFileSync(require("node:fs").readdirSync("/home/claude/talisman/.next/static/css").map((f) => "/home/claude/talisman/.next/static/css/" + f)[0], path.join(OUT, "styles.css"));
const LABEL = { pub: "Гость (публичный сайт)", client: "Клиент Анна", agency: "Агентство «Надёжный курс»", admin: "Администратор платформы", carrier: "Представитель страховщика «Северный щит»" };
const fileOf = (role, p) => `${role}-${p.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-") || "home"}.html`;
const BAR = (role) => `<div id="snapbar" style="position:sticky;top:0;z-index:60;background:#17202c;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px max(16px,env(safe-area-inset-left,0px));display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center"><strong>Кликабельный снимок прототипа</strong><span style="opacity:.8">Роль: ${LABEL[role]}</span><a href="index.html" style="color:#9fd3e6;text-decoration:underline">Сменить роль</a></div>
<div id="snaptoast" role="status" aria-live="polite" style="position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:70;max-width:min(92vw,520px);background:#17202c;color:#fff;font:14px/1.45 system-ui,sans-serif;padding:10px 14px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.25)" hidden></div>
<script>(function(){var t=document.getElementById("snaptoast"),h;function say(m){t.textContent=m;t.hidden=false;clearTimeout(h);h=setTimeout(function(){t.hidden=true},3200)}
document.addEventListener("click",function(e){var a=e.target.closest("a");if(a&&a.dataset.snapMissing!==undefined){e.preventDefault();say("Этот экран не вошёл в снимок. В полной версии он открывается.");return}
var b=e.target.closest("button,input[type=submit],input[type=button]");if(b&&!b.closest("#snapbar")){e.preventDefault();say("В снимке кнопки не выполняют действий: нет сервера. Полная версия с работающими действиями запускается локально по README.")}},true);
document.addEventListener("submit",function(e){e.preventDefault()},true);})();</script>`;
let total = 0;
for (const role of Object.keys(raw)) {
  for (const [p, html0] of Object.entries(raw[role])) {
    let html = html0.replace(/<link rel="stylesheet" href="\/_next\/static\/css\/[^"]+"[^>]*>/g, '<link rel="stylesheet" href="styles.css">');
    html = html.replace(/<script\b[\s\S]*?<\/script>/g, "");
    html = html.replace(/href="(\/[^"]*)"/g, (m, h) => {
      if (h.startsWith("//") || h === "styles.css") return m;
      const q = h.split(/[?#]/)[0];
      if (raw[role][q]) return `href="${fileOf(role, q)}"`;
      if (raw.pub[q] && !/^\/(c|a|admin|demo)(\/|$)/.test(q)) return `href="${fileOf("pub", q)}"`;
      if (role === "pub" && /^\/(c|a|admin)(\/|$)/.test(q)) return `href="index.html"`;
      return `href="#" data-snap-missing=""`;
    });
    html = html.replace(/<title>([^<]*)<\/title>/, (m, t) => `<title>${t} · снимок</title>`);
    html = html.replace(/<body([^>]*)>/, (m) => m + BAR(role));
    fs.writeFileSync(path.join(OUT, fileOf(role, p)), html); total++;
  }
}
const idx = {}; for (const r of Object.keys(raw)) idx[r] = Object.keys(raw[r]).length;
fs.writeFileSync("site-index.json", JSON.stringify(idx));
console.log(total, idx, fs.readdirSync(OUT).length);
