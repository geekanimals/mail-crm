// Ready-made weekly summary sheet (used for X / Twitter, and the old "Data Entry" tab)
// Columns: Week starting, Platform, Account / Handle, Views, Likes, Followers [, Earnings (USD)]
// One file can hold many weeks → returns rows to save directly.
import { addDays, toISODate } from "../utils/dates.js";
import { toNumber } from "../utils/numbers.js";
import { findCol, findRow } from "./helpers.js";

const isHeader = (r) => r.some((c) => c.startsWith("week start")) && r.includes("platform");

export default {
  id: "summary-sheet",
  label: "Weekly summary sheet",

  detect(sheets) {
    return Object.values(sheets).some((rows) => findRow(rows, isHeader) >= 0);
  },

  parse(sheets) {
    const rows = [];
    Object.values(sheets).forEach((all) => {
      const h = findRow(all, isHeader);
      if (h < 0) return;
      const head = all[h];
      const c = {
        week: findCol(head, /^week start/),
        platform: findCol(head, "platform"),
        account: findCol(head, /^account/, "handle"),
        views: findCol(head, "views", "impressions"),
        likes: findCol(head, "likes"),
        followers: findCol(head, "followers"),
        earnings: findCol(head, /^earnings/),
      };
      all.slice(h + 1).forEach((r) => {
        const week = toISODate(r[c.week]);
        if (!week || !r[c.account]) return;
        rows.push({
          week,
          end: addDays(week, 6),
          platform: String(r[c.platform] || "").trim(),
          account: String(r[c.account]).trim(),
          views: toNumber(r[c.views]),
          likes: toNumber(r[c.likes]),
          followers: toNumber(r[c.followers]),
          earnings: c.earnings >= 0 ? toNumber(r[c.earnings]) : 0,
        });
      });
    });
    return { values: {}, dates: rows.map((r) => r.week), rows };
  },
};
