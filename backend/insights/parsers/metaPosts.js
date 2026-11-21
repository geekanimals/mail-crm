// Meta Business Suite → Content → Export (posts, e.g. Instagram)
// Columns: Post ID, Account username, Publish time, Permalink, Post type, Date ("Lifetime"),
//          Views, Reach, Likes, Shares, Follows, Comments, Saves
// "Lifetime" rows have no daily date → posts are counted by their publish time.
import { toISODate } from "../utils/dates.js";
import { countPublished, findCol, findRow, rowsInRange, sumCol, values } from "./helpers.js";

export default {
  id: "meta-posts",
  label: "Meta posts export",

  detect(sheets) {
    const rows = Object.values(sheets)[0] || [];
    return findRow(rows, (r) => r.includes("post id") && r.includes("permalink")) >= 0;
  },

  parse(sheets, range) {
    const all = Object.values(sheets)[0];
    const h = findRow(all, (r) => r.includes("post id"));
    const head = all[h];
    const body = all.slice(h + 1);
    const dateCol = findCol(head, "date");
    const daily = dateCol >= 0 && body.some((r) => toISODate(r[dateCol]));
    const { kept, dates } = rowsInRange(body, daily ? dateCol : findCol(head, "publish time"), range);
    const col = (...p) => sumCol(kept, findCol(head, ...p));

    return {
      dates,
      note: daily ? "" : "Lifetime numbers of posts published in these dates",
      values: values({
        views: col("views", "impressions"),
        reach: col("reach"),
        likes: col("likes", "reactions"),
        comments: col("comments"),
        shares: col("shares"),
        saves: col("saves"),
        linkClicks: col("link clicks"),
        newFollowers: col("follows"),
        posts: countPublished(body, findCol(head, "post id"), findCol(head, "publish time"), range),
      }),
    };
  },
};
