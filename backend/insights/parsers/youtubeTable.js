// YouTube Studio → Analytics → Advanced mode → Export → "Table data.csv"
// One row per video + a "Total" row. Numbers cover the whole range chosen in YouTube Studio,
// so they cannot be split by day — export YouTube with the same dates you upload for.
// Columns: Content, Video title, Video publish time, Views / Views (co-viewed), Unique viewers,
//          Likes, Shares, Comments added, Subscribers gained, Subscribers lost, Watch time (hours) ...
import { countPublished, findCol, findRow, sumCol, values } from "./helpers.js";

export default {
  id: "youtube-table",
  label: "YouTube table data",

  detect(sheets) {
    const rows = Object.values(sheets)[0] || [];
    // "Chart data.csv" has the same columns plus a daily Date column → handled by the daily table parser
    return findRow(rows, (r) => r.includes("content") && r.includes("video title") && !r.includes("date")) >= 0;
  },

  parse(sheets, range) {
    const all = Object.values(sheets)[0];
    const h = findRow(all, (r) => r.includes("content") && r.includes("video title"));
    const head = all[h];
    const body = all.slice(h + 1);
    const totalRow = body.find((r) => /^total$/i.test(String(r[0]).trim()));
    const videos = body.filter((r) => r !== totalRow);
    const use = totalRow ? [totalRow] : videos;
    const col = (...p) => sumCol(use, findCol(head, ...p));

    const gained = col("subscribers gained");
    const lost = col("subscribers lost");
    const subs = gained !== undefined ? gained - (lost || 0) : col("subscribers");

    return {
      wholeRange: true,
      dates: [],
      note: "Totals for the dates selected in YouTube Studio",
      values: values({
        views: col("views", "engaged views", "views (co-viewed)"),
        reach: col("unique viewers"),
        likes: col("likes"),
        comments: col("comments added", "comments"),
        shares: col("shares"),
        newFollowers: subs,
        watchTime: col("watch time (hours)"),
        earnings: col(/^estimated revenue/),
        posts: countPublished(videos, findCol(head, "content"), findCol(head, "video publish time"), range),
      }),
    };
  },
};
