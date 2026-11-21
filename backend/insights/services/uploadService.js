// Upload flow: read files → numbers for the chosen dates → (frontend reviews) → save
import { parseFiles } from "../parsers/index.js";
import { UploadLog } from "../models/UploadLog.js";
import { PLATFORMS } from "../constants/metrics.js";
import { isISODate } from "../utils/dates.js";
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
  if (followers !== undefined) result.values.followers = followers;

  if (result.detected && range && (range.end < result.detected.start || range.start > result.detected.end)) {
    warnings.push("The files have no data for the selected dates");
  }
  if (result.wholeRange) {
    warnings.push("YouTube table numbers cover the dates chosen in YouTube Studio — export with the same dates");
  }

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
  };
}

export async function recentUploads(limit = 20) {
  return UploadLog.find().sort({ createdAt: -1 }).limit(Math.min(100, Number(limit) || 20));
}
