// Meta auto-fetch: week picking, token encryption, and reading Meta's answers (Meta itself is faked here)
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET ||= "test-secret-for-insights-meta-0123456789";
process.env.INSIGHTS_MONGODB_URI ||= "mongodb://127.0.0.1:1/insights-test"; // never connected in these tests

const { readyWeek } = await import("../meta/sync.js");
const { encrypt, decrypt, sign, verify } = await import("../utils/secret.js");
const { instagramWeek, facebookWeek } = await import("../meta/fetch.js");

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
    profile_views: { data: [{ total_value: { value: 77 } }] },
    follower_count: { data: [{ values: [{ value: 3 }, { value: 5 }, { value: -1 }] }] },
    posts: { data: [{ timestamp: "2026-11-18T10:00:00+0000" }, { timestamp: "2026-11-16T03:00:00+0000" }, { timestamp: "2026-11-10T03:00:00+0000" }] },
  });
  const r = await instagramWeek("1789", "tok", { start: "2026-11-16", end: "2026-11-22" });
  assert.deepEqual(r.values, { views: 5200, reach: 3100, likes: 240, comments: 18, shares: 9, visits: 77, newFollowers: 7, posts: 2 });
  assert.ok(r.notes.some((n) => n.startsWith("saves")));
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
  assert.deepEqual(r.values, { views: 600, reach: 110, likes: 18, newFollowers: 3, visits: 8, posts: 0 });
});

test("expired login stops the fetch with a clear message", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 190, message: "Error validating access token" } }), { status: 400 });
  await assert.rejects(instagramWeek("1789", "tok", { start: "2026-11-16", end: "2026-11-22" }), /Reconnect/);
});
