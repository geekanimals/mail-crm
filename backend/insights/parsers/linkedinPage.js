// LinkedIn Company Page → Analytics → Export (.xls)
// Content export: sheet "Metrics" (daily) + sheet "All posts"
//   Metrics columns: Date, Impressions (total), Unique impressions (organic), Clicks (total),
//                    Reactions (total), Comments (total), Reposts (total), Engagement rate ...
// Followers export: sheet with Date, Organic followers, Sponsored followers, Total followers (new per day)
import { toISODate } from "../utils/dates.js";
import { countPublished, findCol, findRow, rowsInRange, sumCol, values } from "./helpers.js";

const isMetricsHeader = (r) => r.includes("impressions (total)");
const isFollowersHeader = (r) => r.includes("total followers") && r.some((c) => c.includes("organic followers"));

function findSheet(sheets, test) {
  for (const rows of Object.values(sheets)) {
    const h = findRow(rows, test);
    if (h >= 0) return { rows, h };
  }
  return null;
}

export default {
  id: "linkedin-page",
  label: "LinkedIn page analytics",

  detect(sheets) {
    return Boolean(findSheet(sheets, isMetricsHeader) || findSheet(sheets, isFollowersHeader));
  },

  parse(sheets, range) {
    const out = {};
    const dates = [];

    const metrics = findSheet(sheets, isMetricsHeader);
    if (metrics) {
      const head = metrics.rows[metrics.h];
      // The first header cell can contain a long description that ends with "Date"
      const dateCol = Math.max(0, findCol(head, "date", / date$/));
      const r = rowsInRange(metrics.rows.slice(metrics.h + 1), dateCol, range);
      dates.push(...r.dates);
      Object.assign(out, {
        views: sumCol(r.kept, findCol(head, "impressions (total)")),
        reach: sumCol(r.kept, findCol(head, "unique impressions (organic)")),
        linkClicks: sumCol(r.kept, findCol(head, "clicks (total)")),
        likes: sumCol(r.kept, findCol(head, "reactions (total)")),
        comments: sumCol(r.kept, findCol(head, "comments (total)")),
        shares: sumCol(r.kept, findCol(head, "reposts (total)")),
      });
    }

    const followers = findSheet(sheets, isFollowersHeader);
    if (followers) {
      const head = followers.rows[followers.h];
      const r = rowsInRange(followers.rows.slice(followers.h + 1), Math.max(0, findCol(head, "date")), range);
      dates.push(...r.dates);
      out.newFollowers = sumCol(r.kept, findCol(head, "total followers"));
    }

    const posts = findSheet(sheets, (r) => r.includes("post link") || r.includes("post title"));
    if (posts) {
      const head = posts.rows[posts.h];
      const body = posts.rows.slice(posts.h + 1).filter((row) => toISODate(row[findCol(head, "created date")]));
      out.posts = countPublished(body, findCol(head, "post link"), findCol(head, "created date"), range);
    }

    return { values: values(out), dates };
  },
};
