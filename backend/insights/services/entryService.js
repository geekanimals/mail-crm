// Saved weekly entries: list, save (add or replace), bulk save, delete one / many
import mongoose from "mongoose";
import { Entry } from "../models/Entry.js";
import { METRIC_KEYS, PLATFORMS } from "../constants/metrics.js";
import { addAccount } from "./accountService.js";
import { addDays, isISODate } from "../utils/dates.js";
import { toNumber } from "../utils/numbers.js";
import { badRequest, notFound } from "../utils/httpError.js";

// Checks and cleans one incoming row
export function cleanEntry(input) {
  const week = input.week || input.start;
  const end = input.end || (isISODate(week) ? addDays(week, 6) : "");
  const account = String(input.account || "").trim();
  const platform = String(input.platform || "").trim();

  if (!isISODate(week)) throw badRequest("Start date must be YYYY-MM-DD");
  if (!isISODate(end)) throw badRequest("End date must be YYYY-MM-DD");
  if (end < week) throw badRequest("End date cannot be before start date");
  if (!account) throw badRequest("Company / account is required");
  if (!PLATFORMS.includes(platform)) throw badRequest(`Platform must be one of: ${PLATFORMS.join(", ")}`);

  const row = { week, end, account, platform, sourceFiles: Array.isArray(input.sourceFiles) ? input.sourceFiles : [] };
  METRIC_KEYS.forEach((k) => (row[k] = Math.max(0, toNumber(input[k]))));
  return row;
}

export async function listEntries({ account, platform, from, to } = {}) {
  const q = {};
  if (account && account !== "All") q.account = account;
  if (platform && platform !== "All") q.platform = platform;
  if (from || to) q.week = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  return Entry.find(q).sort({ week: 1, account: 1, platform: 1 });
}

// Add or replace (same account + platform + start date)
export async function saveEntry(input) {
  const row = cleanEntry(input);
  const { account } = await addAccount(row.account); // new company is added automatically
  row.account = account.name;
  const existed = await Entry.exists({ account: row.account, platform: row.platform, week: row.week });
  const entry = await Entry.findOneAndUpdate(
    { account: row.account, platform: row.platform, week: row.week },
    { $set: row },
    { new: true, upsert: true, runValidators: true }
  );
  return { entry, replaced: Boolean(existed) };
}

// Many rows at once (summary sheets). Bad rows are reported, good rows are saved.
export async function saveMany(rows) {
  if (!Array.isArray(rows) || !rows.length) throw badRequest("No rows to save");
  const saved = [];
  const errors = [];
  for (const [i, r] of rows.entries()) {
    try {
      saved.push((await saveEntry(r)).entry);
    } catch (err) {
      errors.push({ row: i + 1, message: err.message });
    }
  }
  return { saved, errors };
}

export async function deleteEntry(id) {
  const entry = await Entry.findByIdAndDelete(id);
  if (!entry) throw notFound("Entry not found");
}

// Delete many entries by id (only what the user picked on the All Data page — never automatic)
export async function deleteEntries(ids) {
  if (!Array.isArray(ids) || !ids.length) throw badRequest("Pick at least one entry to delete");
  if (ids.length > 5000) throw badRequest("Too many entries at once (max 5000)");
  const valid = ids.filter((id) => mongoose.isValidObjectId(id));
  if (valid.length !== ids.length) throw badRequest("Some entry ids are not valid");
  const { deletedCount } = await Entry.deleteMany({ _id: { $in: valid } });
  return deletedCount;
}

// Latest entry before a date (used to work out total followers)
export async function previousEntry(account, platform, beforeWeek) {
  return Entry.findOne({ account, platform, week: { $lt: beforeWeek } }).sort({ week: -1 });
}
