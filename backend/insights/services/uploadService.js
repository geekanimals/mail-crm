// Upload flow: read files → numbers for the chosen dates → (frontend reviews) → save
import { parseFiles } from "../parsers/index.js";
import { UploadLog } from "../models/UploadLog.js";
import { PLATFORMS } from "../constants/metrics.js";
import { fullWeeks, isISODate, rangeDays } from "../utils/dates.js";
import { badRequest } from "../utils/httpError.js";
import { previousEntry } from "./entryService.js";

export async function previewUpload({ files, account, platform, week, end }) {
  if (!files?.length) throw badRequest("Please attach at least one file");
  if (platform && !PLATFORMS.includes(platform)) throw badRequest("Unknown platform");
  const range = isISODate(week) && isISODate(end) && end >= week ? { start: week, end } : null;

  const result = parseFiles(files, range);
  const warnings = [];

  // Total followers: from the file if it has it, otherwise last saved total + new followers
  const prev = account && platform && range ? await previousEntry(account, platform, range.start) : null;
  let followers = result.totalFollowers;
  if (followers === undefined && result.values.newFollowers !== undefined && prev) {
    followers = prev.followers + result.values.newFollowers;
  }
  // file has no followers at all (e.g. a video-only export) → keep the last known total
  if (followers === undefined && prev) followers = prev.followers;
  if (followers !== undefined) result.values.followers = followers;

  if (result.detected && range && (range.end < result.detected.start || range.start > result.detected.end)) {
    warnings.push("The files have no data for the selected dates");
  }
  if (result.wholeRange) {
    warnings.push("YouTube table numbers cover the dates chosen in YouTube Studio — export with the same dates");
  }

  // Longer than a week → split into full Monday–Sunday weeks, each saved as its own entry
  const split = range && rangeDays(range.start, range.end) > 7 ? await splitWeeks(files, range, result, prev, account, platform) : null;
  if (split?.warning) warnings.push(split.warning);

  await UploadLog.create({
    account,
    platform,
    week,
    end,
    files: result.report.map((r) => ({ name: r.name, format: r.format, ok: r.ok, message: r.message })),
  });

  return {
    values: result.values,
    report: result.report,
    detected: result.detected,
    rows: result.rows, // weekly rows from summary sheets (saved with POST /api/entries/bulk)
    warnings,
    previous: prev ? { week: prev.week, end: prev.end, followers: prev.followers } : null,
    split, // { weeks: [{ week, end, ...numbers }], skipped: [{ start, end }] } when the range is longer than a week
  };
}

// Numbers for every full week inside the range. Total followers: carried from the last saved week
// (+ new followers week by week), or worked back from the file's total when nothing is saved yet.
export async function splitWeeks(files, range, whole, prev, account, platform) {
  if (whole.rows?.length) return null; // weekly summary sheets already have one row per week
  const all = fullWeeks(range.start, range.end);
  const skipped = [...all.skipped];
  // only weeks the files fully cover (no empty future weeks, no half-covered weeks)
  const d = whole.detected;
  const weeks = all.weeks.filter((w) => {
    const covered = !d || (w.start >= d.start && w.end <= d.end);
    if (!covered) skipped.push({ start: w.start, end: w.end, reason: "not fully in the files" });
    return covered;
  });
  if (whole.wholeRange) {
    return { weeks: [], skipped, warning: "These YouTube files hold one total for the whole export, so they can't be split into weeks — export one week (7 days) at a time" };
  }
  if (!weeks.length) {
    return { weeks: [], skipped, warning: "No full week (Monday–Sunday) inside these dates that the files cover — pick at least one full week" };
  }

  const rows = weeks.map((w) => ({ week: w.start, end: w.end, account, platform, ...parseFiles(files, w).values }));

  const base = prev && prev.week < weeks[0].start ? prev.followers : undefined;
  if (base !== undefined) {
    let total = base;
    rows.forEach((r) => {
      if (r.newFollowers !== undefined) total += r.newFollowers;
      r.followers = total;
    });
  } else if (whole.totalFollowers !== undefined) {
    // file total is at the end of the export → walk back week by week
    let total = whole.totalFollowers;
    for (let i = rows.length - 1; i >= 0; i--) {
      rows[i].followers = total;
      total -= rows[i].newFollowers || 0;
    }
  }

  const sourceFiles = files.map((f) => f.originalname);
  rows.forEach((r) => (r.sourceFiles = sourceFiles));
  return { weeks: rows, skipped };
}

export async function recentUploads(limit = 20) {
  return UploadLog.find().sort({ createdAt: -1 }).limit(Math.min(100, Number(limit) || 20));
}
