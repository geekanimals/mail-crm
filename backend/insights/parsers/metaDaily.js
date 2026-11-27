// Meta Business Suite → Insights → Export (one metric per file)
// Format:  sep=,  /  <metric title>  /  Date,Primary  /  "2026-11-01T00:00:00",497 ...
// Files: Views.csv, Viewers.csv, Interactions.csv, Follows.csv, Visits.csv, Link clicks.csv
import { rowsInRange, sumCol } from "./helpers.js";

function metricFor(text) {
  const t = text.toLowerCase();
  if (t.includes("unfollow")) return null;
  if (t.includes("viewer")) return "viewers"; // daily viewers added up — not the week's unique reach
  if (t.includes("reach")) return "reach";
  if (t.includes("view") || t.includes("impression")) return "views";
  if (t.includes("interaction") || t.includes("engagement")) return "interactions"; // likes + comments + shares + saves, not likes alone
  if (t.includes("follow")) return "newFollowers";
  if (t.includes("visit")) return "visits";
  if (t.includes("click")) return "linkClicks";
  return null;
}

export default {
  id: "meta-daily",
  label: "Meta Insights (daily)",

  detect(sheets) {
    const rows = Object.values(sheets)[0] || [];
    return String(rows[0]?.[0] || "").toLowerCase().startsWith("sep=");
  },

  parse(sheets, range, fileName) {
    const rows = Object.values(sheets)[0];
    const title = String(rows[1]?.[0] || "");
    const key = metricFor(title) || metricFor(fileName);
    const { kept, dates } = rowsInRange(rows.slice(3), 0, range);
    if (!key) return { values: {}, dates, note: `"${title}" is not tracked (skipped)` };
    return { values: { [key]: sumCol(kept, 1) }, dates };
  },
};
