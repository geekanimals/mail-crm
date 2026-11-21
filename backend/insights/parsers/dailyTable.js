// Fallback for any table with a Date column and known metric columns
// (YouTube Totals.csv / Chart data.csv, X Premium analytics CSV, other exports)
import { findCol, findRow, rowsInRange, sumCol, values } from "./helpers.js";

const COLUMNS = {
  views: ["views", "engaged views", "impressions", "video views", "post impressions"],
  reach: ["reach", "unique viewers", "accounts reached"],
  likes: ["likes", "reactions", "engagements", "interactions"],
  comments: ["comments", "replies", "comments added"],
  shares: ["shares", "reposts", "retweets"],
  saves: ["saves", "bookmarks"],
  linkClicks: ["link clicks", "url clicks", "clicks"],
  visits: ["profile visits", "page visits", "visits"],
  newFollowers: ["new follows", "new followers", "follows", "subscribers"],
  watchTime: ["watch time (hours)"],
  earnings: [/^estimated revenue/, /^estimated earnings/],
};

const isHeader = (r) => r.some((c) => c === "date" || c === "day");

export default {
  id: "daily-table",
  label: "Daily table",

  detect(sheets) {
    const rows = Object.values(sheets)[0] || [];
    return findRow(rows, isHeader) >= 0;
  },

  parse(sheets, range) {
    const all = Object.values(sheets)[0];
    const h = findRow(all, isHeader);
    const head = all[h];
    const { kept, dates } = rowsInRange(all.slice(h + 1), findCol(head, "date", "day"), range);
    const out = {};
    Object.entries(COLUMNS).forEach(([key, names]) => (out[key] = sumCol(kept, findCol(head, ...names))));
    const found = values(out);
    return { values: found, dates, note: Object.keys(found).length ? "" : "No tracked metric columns (e.g. only percentages)" };
  },
};
