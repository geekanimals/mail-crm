// Meta auto-fetch: week picking, token encryption, and reading Meta's answers (Meta itself is faked here)
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET ||= "test-secret-for-insights-meta-0123456789";
process.env.INSIGHTS_MONGODB_URI ||= "mongodb://127.0.0.1:1/insights-test"; // never connected in these tests
process.env.YOUTUBE_CLIENT_ID ||= "test-client.apps.googleusercontent.com";
process.env.YOUTUBE_CLIENT_SECRET ||= "test-secret";
process.env.YOUTUBE_API_KEY ||= "test-key";

const { readyWeek, mergeIntoFileWeek, SOURCE, YT_SOURCE } = await import("../meta/sync.js");
const { youtubeWeek, youtubeLoginUrl } = await import("../meta/youtube.js");
const { encrypt, decrypt, sign, verify } = await import("../utils/secret.js");
const { instagramWeek, facebookWeek, instagramCheck } = await import("../meta/fetch.js");

test("ready week: the last Monday–Sunday that Meta has finished counting", () => {
  assert.deepEqual(readyWeek("2026-11-24"), { start: "2026-11-16", end: "2026-11-22" }); // Tuesday
  assert.deepEqual(readyWeek("2026-11-26"), { start: "2026-11-16", end: "2026-11-22" }); // Thursday
  assert.deepEqual(readyWeek("2026-11-23"), { start: "2026-11-09", end: "2026-11-15" }); // Monday → week before
  assert.deepEqual(readyWeek("2026-11-22"), { start: "2026-11-09", end: "2026-11-15" }); // Sunday
});

test("tokens are encrypted and login links are signed", () => {
  const packed = encrypt("EAAB-secret-token");
  assert.notEqual(packed, "EAAB-secret-token");
  assert.equal(decrypt(packed), "EAAB-secret-token");
  const s = sign({ account: "GBTG", platform: "Instagram", exp: Date.now() + 60000 });
  assert.equal(verify(s).account, "GBTG");
  assert.equal(verify(s.slice(0, -2) + "xx"), null); // tampered
  assert.equal(verify(sign({ exp: Date.now() - 1 })), null); // expired
});

// fake Meta: answers by metric name
function fakeMeta(answers) {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const metric = u.searchParams.get("metric");
    const path = u.pathname;
    let body;
    if (metric) body = answers[metric] ?? { error: { code: 100, message: `(#100) metric ${metric} is not valid` } };
    else if (path.endsWith("/media") || path.endsWith("/posts")) body = answers.posts;
    else body = answers.profile ?? {};
    return new Response(JSON.stringify(body), { status: body.error ? 400 : 200 });
  };
}

test("Instagram week: every metric read, a retired metric is skipped, not fatal", async () => {
  fakeMeta({
    views: { data: [{ total_value: { value: 5200 } }] },
    reach: { data: [{ total_value: { value: 3100 } }] },
    likes: { data: [{ total_value: { value: 240 } }] },
    comments: { data: [{ total_value: { value: 18 } }] },
    shares: { data: [{ total_value: { value: 9 } }] },
    // saves missing → error 100, skipped
    total_interactions: { data: [{ total_value: { value: 280 } }] },
    profile_views: { data: [{ total_value: { value: 77 } }] },
    follower_count: { data: [{ values: [{ value: 3 }, { value: 5 }, { value: -1 }] }] },
    posts: { data: [{ timestamp: "2026-11-18T10:00:00+0000" }, { timestamp: "2026-11-16T03:00:00+0000" }, { timestamp: "2026-11-10T03:00:00+0000" }] },
  });
  const r = await instagramWeek("1789", "tok", { start: "2026-11-16", end: "2026-11-22" });
  assert.deepEqual(r.values, { views: 5200, reach: 3100, likes: 240, comments: 18, shares: 9, interactions: 280, visits: 77, newFollowers: 7, posts: 2 });
  assert.ok(r.notes.some((n) => n.startsWith("saves")));
});

test("Instagram week: a negative net number from Meta (saves -16) is saved as 0, not an error", async () => {
  fakeMeta({
    views: { data: [{ total_value: { value: 900 } }] },
    saves: { data: [{ total_value: { value: -16 } }] },
    posts: { data: [] },
  });
  const r = await instagramWeek("1789", "tok", { start: "2026-11-16", end: "2026-11-22" });
  assert.equal(r.values.saves, 0);
  assert.equal(r.values.views, 900);
  assert.ok(r.notes.some((n) => n.startsWith("saves: Meta sent -16")));
});

test("Facebook week: renamed Page metrics fall back to the next name", async () => {
  const day = (v) => ({ data: [{ values: v.map((value) => ({ value })) }] });
  fakeMeta({
    page_impressions: day([100, 200, 300]), // page_media_view not available → this one is used
    page_impressions_unique: day([50, 60]),
    page_post_engagements: day([5, 6, 7]),
    page_daily_follows_unique: day([1, 0, 2]),
    page_views_total: day([4, 4]),
    posts: { data: [{ created_time: "2026-11-20T09:00:00+0000" }] },
  });
  const r = await facebookWeek("123", "tok", { start: "2026-11-09", end: "2026-11-15" });
  assert.deepEqual(r.values, { views: 600, reach: 110, interactions: 18, newFollowers: 3, visits: 8, posts: 0 });
});

test("expired login stops the fetch with a clear message", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 190, message: "Error validating access token" } }), { status: 400 });
  await assert.rejects(instagramWeek("1789", "tok", { start: "2026-11-16", end: "2026-11-22" }), /Reconnect/);
});

test("uploaded week: file numbers stay on every fetch (also the 2nd), Meta only fills zeros, history says what happened", () => {
  const week = { views: 413715, reach: 52521, likes: 5699, comments: 0, visits: 155, newFollowers: 143, sourceFiles: ["Views (1).csv"] };
  const meta = { views: 73700, reach: 61500, likes: 3700, comments: 49, visits: 155, newFollowers: 143 };
  const first = mergeIntoFileWeek(week, meta);
  assert.equal(week.views, 413715);
  assert.equal(week.comments, 49);
  assert.deepEqual(week.sourceFiles, ["Views (1).csv", SOURCE]);
  assert.match(first, /filled from Meta: comments 49/);
  assert.match(first, /kept from file: views 4\.1L \(Meta 73\.7K\)/);
  assert.match(first, /same in both: visits 155, newFollowers 143/);
  // second fetch: the entry now carries "Meta API" too — file numbers must still win
  const second = mergeIntoFileWeek(week, { ...meta, views: 80000, comments: 60 });
  assert.equal(week.views, 413715);
  assert.equal(week.comments, 49);
  assert.equal(week.sourceFiles.filter((f) => f === SOURCE).length, 1);
  assert.match(second, /kept from file: views 4\.1L \(Meta 80\.0K\)/);
});

test("Check: week views, breakdown, and Instagram + Facebook views of each reel (read-only)", async () => {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const metric = u.searchParams.get("metric");
    const path = u.pathname;
    let body;
    if (path.endsWith("/media")) body = { data: [
      { id: "m1", timestamp: "2026-11-17T06:00:00+0000", media_product_type: "REELS", permalink: "https://ig/1" },
      { id: "m2", timestamp: "2026-11-19T06:00:00+0000", media_product_type: "FEED", permalink: "https://ig/2" },
      { id: "m0", timestamp: "2026-09-01T06:00:00+0000", media_product_type: "FEED", permalink: "https://ig/0" },
    ] };
    else if (path.includes("/m1/")) body = { views: { data: [{ values: [{ value: 9000 }] }] }, facebook_views: { data: [{ values: [{ value: 10000 }] }] }, crossposted_views: { data: [{ values: [{ value: 19000 }] }] } }[metric];
    else if (path.includes("/m2/")) body = metric === "views" ? { data: [{ values: [{ value: 1200 }] }] } : { error: { code: 100, message: "metric not supported for this media" } };
    else if (u.searchParams.get("breakdown") === "media_product_type") body = { data: [{ total_value: { value: 18100, breakdowns: [{ results: [{ dimension_values: ["REEL"], value: 15000 }, { dimension_values: ["POST"], value: 3100 }] }] } }] };
    else if (u.searchParams.get("breakdown")) body = { data: [{ total_value: { value: 18100, breakdowns: [{ results: [] }] } }] };
    else body = { views: { data: [{ total_value: { value: 18100 } }] }, profile_links_taps: { data: [{ total_value: { value: 3 } }] } }[metric] ?? { error: { code: 100, message: "no" } };
    return new Response(JSON.stringify(body), { status: body.error ? 400 : 200 });
  };
  const r = await instagramCheck("1789", "tok", { start: "2026-11-16", end: "2026-11-22" });
  assert.equal(r.account.views, 18100);
  assert.equal(r.account.profile_links_taps, 3);
  assert.deepEqual(r.breakdown.media_product_type, { REEL: 15000, POST: 3100 });
  assert.equal(r.media.length, 2); // the September post is outside the 5 weeks
  assert.deepEqual(r.totals.weekPosts, { count: 2, instagram: 10200, facebook: 10000, both: 19000 });
});

test("YouTube login link asks for a long-term (offline) login with read-only analytics", () => {
  const u = new URL(youtubeLoginUrl({ redirectUri: "https://crm.example.com/api/insights-oauth/youtube/callback", state: "s1" }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.match(u.searchParams.get("prompt"), /consent/);
  assert.match(u.searchParams.get("scope"), /yt-analytics\.readonly/);
  assert.equal(u.searchParams.get("state"), "s1");
});

function fakeGoogle({ totals, videos, details, channel, status = 200 }) {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    let body;
    if (u.host === "youtubeanalytics.googleapis.com") body = u.searchParams.get("dimensions") === "video" ? videos : totals;
    else if (u.pathname.endsWith("/videos")) body = u.searchParams.get("key") === "test-key" ? details : { error: { message: "no key" } };
    else if (u.pathname.endsWith("/channels")) body = channel;
    return new Response(JSON.stringify(body), { status: body?.error ? status : 200 });
  };
}

test("YouTube week: views, watch time in hours, likes, net subscribers, videos published (API key), subscribers today", async () => {
  fakeGoogle({
    totals: {
      columnHeaders: ["views", "estimatedMinutesWatched", "likes", "comments", "shares", "subscribersGained", "subscribersLost"].map((name) => ({ name })),
      rows: [[5300, 1230, 210, 14, 9, 40, 6]],
    },
    videos: { rows: [["v1", 3000], ["v2", 1500], ["v3", 800]] },
    details: { items: [
      { id: "v1", snippet: { channelId: "UC1", channelTitle: "GBTG", publishedAt: "2026-11-21T10:00:00Z" } },
      { id: "v2", snippet: { channelId: "UC1", channelTitle: "GBTG", publishedAt: "2026-11-16T03:00:00Z" } },
      { id: "v3", snippet: { channelId: "UC1", channelTitle: "GBTG", publishedAt: "2026-10-01T03:00:00Z" } },
    ] },
    channel: { items: [{ statistics: { subscriberCount: "12890" } }] },
  });
  const r = await youtubeWeek("UC1", "tok", { start: "2026-11-16", end: "2026-11-22" });
  assert.equal(r.values.views, 5300);
  assert.equal(r.values.watchTime, 20.5); // 1230 min
  assert.equal(r.values.likes, 210);
  assert.equal(r.values.newFollowers, 34); // 40 − 6
  assert.equal(r.values.interactions, 233); // 210 + 14 + 9
  assert.equal(r.values.posts, 2); // the October video got views but wasn't published this week
});

test("YouTube login asks only for the read-only Analytics permission (non-sensitive → no Google verification)", () => {
  const u = new URL(youtubeLoginUrl({ redirectUri: "https://x/cb", state: "s" }));
  assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/yt-analytics.readonly");
});

test("YouTube: expired Google login asks to reconnect; used-up quota retries later", async () => {
  fakeGoogle({ totals: { error: { code: 401, message: "Invalid Credentials" } }, status: 401 });
  await assert.rejects(youtubeWeek("UC1", "tok", { start: "2026-11-16", end: "2026-11-22" }), (e) => e.reconnect && /Reconnect/.test(e.message));
  fakeGoogle({ totals: { error: { code: 403, message: "The request cannot be completed because you have exceeded your quota." } }, status: 403 });
  await assert.rejects(youtubeWeek("UC1", "tok", { start: "2026-11-16", end: "2026-11-22" }), (e) => e.retry && !e.reconnect);
});

test("YouTube fetch into an uploaded week: file numbers stay, history says YouTube", () => {
  const week = { views: 7000, likes: 0, sourceFiles: ["Table data.csv"] };
  const how = mergeIntoFileWeek(week, { views: 6900, likes: 120 }, YT_SOURCE);
  assert.equal(week.views, 7000);
  assert.equal(week.likes, 120);
  assert.deepEqual(week.sourceFiles, ["Table data.csv", YT_SOURCE]);
  assert.match(how, /filled from YouTube: likes 120 · kept from file: views 7\.0K \(YouTube 6\.9K\)/);
});
