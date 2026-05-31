const fs = require("fs");
const path = require("path");
const histDir = "C:/Users/ruben/AppData/Roaming/Code/User/History";
const dirs = fs.readdirSync(histDir);
const byResource = new Map();
let parsed = 0;
for (const d of dirs) {
  const ej = path.join(histDir, d, "entries.json");
  if (!fs.existsSync(ej)) continue;
  let j;
  try { j = JSON.parse(fs.readFileSync(ej, "utf8")); } catch { continue; }
  if (!j.resource || !Array.isArray(j.entries) || j.entries.length === 0) continue;
  parsed++;
  let res = decodeURIComponent(j.resource).replace(/^file:\/\/\//, "");
  const latest = j.entries.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
  if (!byResource.has(res) || byResource.get(res).ts < latest.timestamp) {
    byResource.set(res, { dir: d, id: latest.id, ts: latest.timestamp });
  }
}
const appsWeb = [...byResource.entries()].filter(
  ([r]) => /apps\/web\//i.test(r) && !/node_modules/.test(r)
);
console.log("history dirs parsed:", parsed, "| total resources:", byResource.size, "| apps/web resources:", appsWeb.length);
const ext = {};
for (const [r] of appsWeb) { const e = r.split(".").pop(); ext[e] = (ext[e] || 0) + 1; }
console.log("by ext:", JSON.stringify(ext));
const keys = ["LocaleSwitcher", "Dashboard/index", "DashboardRoute", "Welcome/index", "messages/pt.json", "messages/en.json", "messages/fr.json", "i18n/routing", "lib/i18n/dateLocale", "Calendar/index", "AIPreviewModal/index", "Kanban/Board", "AISettings/index", "ScheduleSettings/index", "app/layout", "app/setup/page", "Layout/Sidebar", "Layout/TopBar", "next.config"];
console.log("key files present in history:");
for (const k of keys) {
  const hit = appsWeb.find(([r]) => r.includes(k));
  console.log("  " + (hit ? "YES" : "NO ") + " " + k + (hit ? "  (" + new Date(hit[1].ts).toISOString() + ")" : ""));
}
fs.writeFileSync(
  "recover_map.json",
  JSON.stringify(appsWeb.map(([r, v]) => ({ res: r, src: path.join(histDir, v.dir, v.id), ts: v.ts })), null, 0)
);
console.log("wrote recover_map.json with", appsWeb.length, "entries");
