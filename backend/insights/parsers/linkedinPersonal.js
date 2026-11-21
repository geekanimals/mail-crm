// LinkedIn personal profile → Analytics → Export (AggregateAnalytics_<name>_<start>_<end>.xlsx)
// Sheets: DISCOVERY (Impressions, Members reached), ENGAGEMENT (Date, Impressions, Engagements),
//         FOLLOWERS ("Total followers on <date>", then Date, New followers), TOP POSTS, MOST RECENT POSTS
import { toNumber } from "../utils/numbers.js";
import { inRange, toISODate } from "../utils/dates.js";
import { findCol, findRow, rowsInRange, sumCol, values } from "./helpers.js";

const sheetOf = (sheets, name) => Object.entries(sheets).find(([n]) => n.trim().toUpperCase() === name)?.[1];

export default {
  id: "linkedin-personal",
  label: "LinkedIn profile analytics",

  detect(sheets) {
    return Boolean(sheetOf(sheets, "ENGAGEMENT") && sheetOf(sheets, "FOLLOWERS"));
  },

  parse(sheets, range) {
    const out = {};
    const dates = [];
    let totalFollowers;

    const eng = sheetOf(sheets, "ENGAGEMENT");
    const eh = findRow(eng, (r) => r.includes("date") && r.includes("impressions"));
    if (eh >= 0) {
      const head = eng[eh];
      const r = rowsInRange(eng.slice(eh + 1), findCol(head, "date"), range);
      dates.push(...r.dates);
      out.views = sumCol(r.kept, findCol(head, "impressions"));
      out.likes = sumCol(r.kept, findCol(head, "engagements"));
    }

    const fol = sheetOf(sheets, "FOLLOWERS");
    const totalRow = fol.find((r) => /^total followers/i.test(String(r[0])));
    if (totalRow) totalFollowers = toNumber(totalRow[1]);
    const fh = findRow(fol, (r) => r.includes("date") && r.includes("new followers"));
    if (fh >= 0) {
      const head = fol[fh];
      const r = rowsInRange(fol.slice(fh + 1), findCol(head, "date"), range);
      out.newFollowers = sumCol(r.kept, findCol(head, "new followers"));
    }

    // Posts published in the range (from the posts sheets, no double count)
    const ids = new Set();
    ["MOST RECENT POSTS", "TOP POSTS"].forEach((name) => {
      const rows = sheetOf(sheets, name);
      if (!rows) return;
      const ph = findRow(rows, (r) => r.includes("post url"));
      if (ph < 0) return;
      const head = rows[ph];
      const urlCol = findCol(head, "post url");
      const dateCol = findCol(head, "post publish date");
      rows.slice(ph + 1).forEach((r) => {
        const d = toISODate(r[dateCol]);
        if (r[urlCol] && d && inRange(d, range)) ids.add(r[urlCol]);
      });
    });
    if (ids.size) out.posts = ids.size;

    return { values: values(out), dates, totalFollowers };
  },
};
