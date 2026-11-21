// Run with: npm test
// Sample files in tests/fixtures copy the exact layout of the real exports (numbers are made up).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFiles, parseSheets } from "../parsers/index.js";
import { parseCSV } from "../utils/csv.js";
import { toISODate } from "../utils/dates.js";

const fixture = (name) => ({ originalname: name, buffer: readFileSync(new URL(`./fixtures/${name}`, import.meta.url)) });
const WEEK = { start: "2026-11-09", end: "2026-11-15" };

test("dates: every format seen in the exports", () => {
  assert.equal(toISODate("2026-11-01T00:00:00"), "2026-11-01");
  assert.equal(toISODate("11/18/2026 4:33"), "2026-11-18");
  assert.equal(toISODate("9-Nov-26"), "2026-11-09");
  assert.equal(toISODate("16 Nov 2026"), "2026-11-16");
  assert.equal(toISODate("Nov 10, 2026"), "2026-11-10");
  assert.equal(toISODate("Lifetime"), null);
});

test("csv: quotes, commas and line breaks inside cells", () => {
  const rows = parseCSV('a,b\n"x, y","line1\nline2"\n"say ""hi""",2\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", "line1\nline2"], ['say "hi"', "2"]]);
});

test("Meta daily files (Views, Interactions, Follows, Viewers, Visits) — only days inside the range", () => {
  const files = ["Views.csv", "Interactions.csv", "Follows.csv", "Viewers.csv", "Visits.csv"].map(fixture);
  const r = parseFiles(files, WEEK);
  assert.deepEqual(r.values, { views: 6900, likes: 69, newFollowers: 12, reach: 300, visits: 30 });
  assert.deepEqual(r.detected, { start: "2026-11-01", end: "2026-11-14" });
  assert.ok(r.report.every((f) => f.ok));
});

test("Meta video performance export", () => {
  const r = parseFiles([fixture("Oct-20-2026_Nov-18-2026_999.csv")], WEEK);
  assert.equal(r.report[0].format, "Meta video performance");
  assert.deepEqual(r.values, { views: 1380, reach: 96, likes: 24, comments: 12, shares: 12, watchTime: 1.2, earnings: 0.6, posts: 1 });
});

test("Instagram posts export (Lifetime rows counted by publish date)", () => {
  const r = parseFiles([fixture("Oct-20-2026_Nov-18-2026_ig.csv")], WEEK);
  assert.equal(r.report[0].format, "Meta posts export");
  assert.deepEqual(r.values, { views: 11018, reach: 8479, likes: 385, comments: 17, shares: 154, saves: 38, newFollowers: 4, posts: 2 });
});

test("YouTube Table data + Totals (Total row used, Totals % skipped)", () => {
  const r = parseFiles([fixture("Totals.csv"), fixture("Table data.csv")], WEEK);
  assert.equal(r.wholeRange, true);
  assert.deepEqual(r.values, {
    views: 6754065, reach: 3130599, likes: 90250, comments: 826, shares: 27883, newFollowers: 1547, posts: 1,
  });
  assert.equal(r.report.find((f) => f.name === "Totals.csv").ok, false);
});

test("X / Twitter weekly summary sheet → rows to save", () => {
  const sheets = {
    Sheet1: [
      ["Week starting", "Platform", "Account / Handle", "Views", "Likes", "Followers"],
      ["9-Nov-26", "X / Twitter", "Mayank", 154, 3, 105],
      ["16-Nov-26", "X / Twitter", "Mayank", 233, 4, 105],
    ],
  };
  const r = parseSheets(sheets, WEEK);
  assert.equal(r.format, "summary-sheet");
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[1], {
    week: "2026-11-16", end: "2026-11-22", platform: "X / Twitter", account: "Mayank", views: 233, likes: 4, followers: 105, earnings: 0,
  });
});

test("LinkedIn page content export (.xls: Metrics + All posts)", () => {
  const metrics = [["Aggregated engagement metrics for your organic and sponsored posts over time."],
    ["Date", "Impressions (organic)", "Impressions (sponsored)", "Impressions (total)", "Unique impressions (organic)", "Clicks (organic)", "Clicks (sponsored)", "Clicks (total)", "Reactions (organic)", "Reactions (sponsored)", "Reactions (total)", "Comments (organic)", "Comments (sponsored)", "Comments (total)", "Reposts (organic)", "Reposts (sponsored)", "Reposts (total)", "Engagement rate (organic)"]];
  for (let d = 1; d <= 17; d++) metrics.push([`11/${String(d).padStart(2, "0")}/2026`, 10, 0, 10, 5, 1, 0, 1, 2, 0, 2, 1, 0, 1, 0, 0, 0, 0.03]);
  const posts = [["Post title", "Post link", "Post type", "Campaign name", "Posted by", "Created date"],
    ["A", "https://li/1", "Organic", "", "Geek", "11/10/2026"], ["B", "https://li/2", "Organic", "", "Geek", "11/02/2026"]];
  const r = parseSheets({ Metrics: metrics, "All posts": posts }, WEEK);
  assert.equal(r.format, "linkedin-page");
  assert.deepEqual(r.values, { views: 70, reach: 35, linkClicks: 7, likes: 14, comments: 7, shares: 0, posts: 1 });
});

test("LinkedIn profile export (AggregateAnalytics .xlsx)", () => {
  const sheets = {
    DISCOVERY: [["Overall Performance", "11/1/2026 - 11/19/2026"], ["Impressions", 486721], ["Members reached", 255831]],
    ENGAGEMENT: [["Date", "Impressions", "Engagements"], ...Array.from({ length: 19 }, (_, i) => [`11/${i + 1}/2026`, 1000, 20])],
    FOLLOWERS: [["Total followers on 11/19/2026", 34754], ["Date", "New followers"], ...Array.from({ length: 19 }, (_, i) => [`11/${i + 1}/2026`, 100])],
    "MOST RECENT POSTS": [["Post URL", "Post Publish Date", "Post type", "Impressions"], ["https://li/a", "11/10/2026", "Image", 680], ["https://li/b", "11/18/2026", "Video", 900]],
    "TOP POSTS": [["Post URL", "Post Publish Date", "Engagements"], ["https://li/a", "11/10/2026", 50]],
  };
  const r = parseSheets(sheets, WEEK);
  assert.equal(r.format, "linkedin-personal");
  assert.equal(r.totalFollowers, 34754);
  assert.deepEqual(r.values, { views: 7000, likes: 140, newFollowers: 700, posts: 1 });
});

test("Unknown file is reported, not crashed", () => {
  const r = parseFiles([{ originalname: "notes.csv", buffer: Buffer.from("hello,world\nfoo,bar\n") }], WEEK);
  assert.equal(r.report[0].ok, false);
  assert.deepEqual(r.values, {});
});

test("Facebook video export with a repeated column name uses the column that has data", () => {
  const csv = [
    'Video asset ID,Page name,Publish time,Date,3-second video views,3-Second viewers,Reactions,Comments,Shares,Seconds viewed,3-second viewers',
    '1,GBTG,11/10/2026 10:00,11/10/2026,100,,5,1,1,60,80',
    '1,GBTG,11/10/2026 10:00,11/11/2026,50,3,2,0,0,30,40',
  ].join("\n");
  const r = parseFiles([{ originalname: "Oct-20-2026_Nov-18-2026_1.csv", buffer: Buffer.from(csv) }], WEEK);
  assert.equal(r.values.reach, 120);
  assert.equal(r.values.views, 150);
});

test("YouTube daily Totals (Engaged views) give exact-date views; Table data gives the rest; Chart data is daily", () => {
  const totals = "Date,Engaged views\n" + Array.from({ length: 17 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")},100`).join("\n");
  const chart = "Date,Content,Video title,Video publish time,Duration,Engaged views\n2026-11-10,v1,One,\"Nov 10, 2026\",19,40";
  const r = parseFiles(
    [fixture("Table data.csv"), { originalname: "Totals.csv", buffer: Buffer.from(totals) }, { originalname: "Chart data.csv", buffer: Buffer.from(chart) }],
    WEEK
  );
  assert.equal(r.values.views, 700); // 9–15 Nov from Totals, not the Table data total
  assert.equal(r.values.likes, 90250); // from Table data
  assert.equal(r.report.find((f) => f.name === "Chart data.csv").format, "Daily table");
});
