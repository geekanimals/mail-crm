// Meta Business Suite → Content → Export (video performance, one row per video per day)
// Columns: Video asset ID, Page name, Publish time, Date, 3-second video views, Seconds viewed,
//          Reactions, Comments, Shares, Estimated earnings (USD) ...
import { countPublished, findCol, findRow, rowsInRange, sumBest, sumCol, values } from "./helpers.js";

export default {
  id: "meta-video",
  label: "Meta video performance",

  detect(sheets) {
    const rows = Object.values(sheets)[0] || [];
    return findRow(rows, (r) => r.includes("video asset id") && r.includes("date")) >= 0;
  },

  parse(sheets, range) {
    const all = Object.values(sheets)[0];
    const h = findRow(all, (r) => r.includes("video asset id"));
    const head = all[h];
    const body = all.slice(h + 1);
    const { kept, dates } = rowsInRange(body, findCol(head, "date"), range);
    const seconds = sumCol(kept, findCol(head, "seconds viewed"));

    return {
      dates,
      values: values({
        views: sumBest(kept, head, "3-second video views") ?? sumCol(kept, findCol(head, "views")),
        reach: sumBest(kept, head, "3-second viewers"),
        likes: sumCol(kept, findCol(head, "reactions")),
        comments: sumCol(kept, findCol(head, "comments")),
        shares: sumCol(kept, findCol(head, "shares")),
        watchTime: seconds === undefined ? undefined : seconds / 3600,
        earnings: sumCol(kept, findCol(head, /^estimated earnings/)),
        posts: countPublished(body, findCol(head, "video asset id"), findCol(head, "publish time"), range),
      }),
    };
  },
};
