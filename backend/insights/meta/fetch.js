// One week of numbers for a connected Facebook Page / Instagram account, straight from Meta.
// Each metric is asked for on its own, so one renamed/retired metric never stops the rest.
import { FB_GRAPH, IG_GRAPH, MetaError, graphGet } from "./graph.js";
import { addDays } from "../utils/dates.js";

// Meta works in seconds; weeks are India-time days (start 00:00 → day after end 00:00)
const unix = (iso) => Math.floor(Date.parse(iso + "T00:00:00+05:30") / 1000);
const isRecent = (end) => Date.parse(end + "T23:59:59+05:30") > Date.now() - 9 * 86400 * 1000;

async function tryMetric(fn, notes, label) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MetaError && (e.reconnect || e.retry)) throw e; // login / outage problems stop the fetch
    notes.push(`${label}: ${e.message}`);
    return undefined;
  }
}

async function countPosts(url, params, start, end) {
  let n = 0;
  let next = url;
  let query = { ...params, limit: 100 };
  for (let page = 0; page < 10 && next; page++) {
    const r = await graphGet(next, query);
    for (const p of r.data || []) {
      const day = new Date(Date.parse(p.timestamp || p.created_time) + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      if (day >= start && day <= end) n++;
    }
    const oldest = (r.data || []).at(-1);
    const oldestDay = oldest && new Date(Date.parse(oldest.timestamp || oldest.created_time)).toISOString().slice(0, 10);
    if (!oldest || oldestDay < start) break;
    next = r.paging?.next;
    query = {}; // the "next" link already has everything
  }
  return n;
}

// ---------- Instagram (Instagram login, graph.instagram.com) ----------
const IG_TOTALS = [
  ["views", "views"],
  ["reach", "reach"],
  ["likes", "likes"],
  ["comments", "comments"],
  ["shares", "shares"],
  ["saves", "saves"],
  ["visits", "profile_views"],
];

export async function instagramWeek(igId, token, { start, end }) {
  const values = {};
  const notes = [];
  const since = unix(start);
  const until = unix(addDays(end, 1));

  for (const [key, metric] of IG_TOTALS) {
    const v = await tryMetric(async () => {
      const r = await graphGet(`${IG_GRAPH()}/${igId}/insights`, { metric, period: "day", metric_type: "total_value", since, until, access_token: token });
      return r.data?.[0]?.total_value?.value;
    }, notes, metric);
    if (typeof v === "number") values[key] = v;
  }

  // new followers per day (Meta keeps only the last 30 days of this one)
  const fc = await tryMetric(async () => {
    const r = await graphGet(`${IG_GRAPH()}/${igId}/insights`, { metric: "follower_count", period: "day", since, until, access_token: token });
    const days = r.data?.[0]?.values || [];
    return days.length ? days.reduce((s, d) => s + (d.value || 0), 0) : undefined;
  }, notes, "follower_count");
  if (typeof fc === "number") values.newFollowers = fc;

  const posts = await tryMetric(() => countPosts(`${IG_GRAPH()}/${igId}/media`, { fields: "timestamp", access_token: token }, start, end), notes, "posts");
  if (typeof posts === "number") values.posts = posts;

  // total followers: Meta gives only today's number → used for the latest week only
  if (isRecent(end)) {
    const me = await tryMetric(() => graphGet(`${IG_GRAPH()}/${igId}`, { fields: "followers_count", access_token: token }), notes, "followers_count");
    if (me?.followers_count) values.followers = me.followers_count;
  }

  if (!Object.keys(values).length) throw new MetaError("Meta returned no numbers for this week" + (notes.length ? ` (${notes[0]})` : ""));
  return { values, notes };
}

// ---------- Facebook Page (graph.facebook.com, Page token) ----------
// Meta renames Page metrics from time to time — the first name that answers is used
const FB_DAILY = [
  ["views", ["page_media_view", "page_impressions"]],
  ["reach", ["page_total_media_view_unique", "page_impressions_unique"]],
  ["likes", ["page_post_engagements"]], // interactions with the Page's posts
  ["newFollowers", ["page_daily_follows_unique", "page_daily_follows", "page_fan_adds_unique"]],
  ["visits", ["page_views_total"]],
];

export async function facebookWeek(pageId, token, { start, end }) {
  const values = {};
  const notes = [];
  const since = unix(start);
  const until = unix(addDays(end, 1));

  for (const [key, names] of FB_DAILY) {
    for (const metric of names) {
      const v = await tryMetric(async () => {
        const r = await graphGet(`${FB_GRAPH()}/${pageId}/insights`, { metric, period: "day", since, until, access_token: token });
        const days = r.data?.[0]?.values;
        return days?.length ? days.reduce((s, d) => s + (typeof d.value === "number" ? d.value : 0), 0) : undefined;
      }, notes, metric);
      if (typeof v === "number") {
        values[key] = v;
        break;
      }
    }
  }

  const posts = await tryMetric(() => countPosts(`${FB_GRAPH()}/${pageId}/posts`, { fields: "created_time", since, until, access_token: token }, start, end), notes, "posts");
  if (typeof posts === "number") values.posts = posts;

  if (isRecent(end)) {
    const page = await tryMetric(() => graphGet(`${FB_GRAPH()}/${pageId}`, { fields: "followers_count,fan_count", access_token: token }), notes, "followers_count");
    const total = page?.followers_count || page?.fan_count;
    if (total) values.followers = total;
  }

  if (!Object.keys(values).length) throw new MetaError("Meta returned no numbers for this week" + (notes.length ? ` (${notes[0]})` : ""));
  return { values, notes };
}
