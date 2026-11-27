// Saves Meta numbers as weekly entries — automatically every week, or when "Fetch now" is clicked.
// Uploaded files keep priority: a week saved from files only gets its empty numbers filled.
import { Connection } from "../models/Connection.js";
import { Entry } from "../models/Entry.js";
import { SyncLog } from "../models/SyncLog.js";
import { addDays } from "../utils/dates.js";
import { freshToken } from "./auth.js";
import { facebookWeek, instagramWeek } from "./fetch.js";

export const SOURCE = "Meta API";
const MAX_AUTO_TRIES = 6; // automatic retries stop after this many failures in a row (Fetch now always works)

const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// Latest Monday–Sunday week that Meta has finished counting (it needs ~1–2 days after Sunday)
export function readyWeek(today = todayIST()) {
  const day = new Date(today + "T00:00:00Z").getUTCDay(); // 0 = Sunday
  let sunday = addDays(today, -(day === 0 ? 7 : day)); // last Sunday before today
  if (addDays(sunday, 2) > today) sunday = addDays(sunday, -7); // on Monday use the week before
  return { start: addDays(sunday, -6), end: sunday };
}

const short = (n) => (n >= 1e5 ? (n / 1e5).toFixed(1) + "L" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));
const summary = (v) => Object.entries(v).map(([k, n]) => `${k} ${short(n)}`).join(", ");

async function saveWeek(conn, week, values) {
  const key = { account: conn.account, platform: conn.platform, week: week.start };
  const existing = await Entry.findOne(key);
  if (existing && !(existing.sourceFiles || []).includes(SOURCE)) {
    // saved from uploaded files → keep them, only fill numbers that are still 0
    let filled = 0;
    for (const [k, v] of Object.entries(values)) if (!existing[k] && v) (existing[k] = v), filled++;
    if (filled) existing.sourceFiles = [...existing.sourceFiles, SOURCE];
    await existing.save();
    return filled ? `kept the uploaded numbers, filled ${filled} empty` : "kept the uploaded numbers";
  }
  await Entry.findOneAndUpdate(key, { ...key, end: week.end, ...values, sourceFiles: [SOURCE] }, { upsert: true, runValidators: true, setDefaultsOnInsert: true });
  return existing ? "updated" : "saved";
}

export async function syncConnection(conn, week, trigger = "auto") {
  try {
    const token = await freshToken(conn);
    const fetcher = conn.platform === "Instagram" ? instagramWeek : facebookWeek;
    const { values, notes } = await fetcher(conn.externalId, token, week);
    const how = await saveWeek(conn, week, values);
    conn.status = "ok";
    conn.lastError = notes.length ? "Note: " + notes.slice(0, 2).join("; ") : "";
    conn.failures = 0;
    conn.lastFetchAt = new Date();
    if (week.start > (conn.lastFetchWeek || "")) conn.lastFetchWeek = week.start;
    await conn.save();
    await SyncLog.create({ account: conn.account, platform: conn.platform, week: week.start, end: week.end, ok: true, trigger, message: `${how}: ${summary(values)}` });
    return { ok: true, week: week.start, values };
  } catch (e) {
    conn.status = "error";
    conn.lastError = e.message;
    conn.failures = (conn.failures || 0) + 1;
    conn.lastFetchAt = new Date();
    await conn.save();
    await SyncLog.create({ account: conn.account, platform: conn.platform, week: week.start, end: week.end, ok: false, trigger, message: e.message });
    console.error(`[insights] Meta fetch failed for ${conn.account} · ${conn.platform}: ${e.message}`);
    return { ok: false, week: week.start, error: e.message };
  }
}

// Every connection that hasn't saved the ready week yet (used by the weekly timer)
export async function syncDue() {
  const week = readyWeek();
  const due = await Connection.find({ lastFetchWeek: { $lt: week.start }, failures: { $lt: MAX_AUTO_TRIES } });
  for (const conn of due) await syncConnection(conn, week, "auto");
  return due.length;
}

// "Fetch now": the last few weeks for one connection (or all), whatever happened before
export async function syncNow({ account, platform, weeks = 1 } = {}) {
  const n = Math.min(Math.max(Number(weeks) || 1, 1), 12);
  const filter = {};
  if (account) filter.account = account;
  if (platform) filter.platform = platform;
  const conns = await Connection.find(filter);
  const last = readyWeek();
  const results = [];
  for (const conn of conns) {
    for (let i = n - 1; i >= 0; i--) {
      const start = addDays(last.start, -7 * i);
      results.push({ account: conn.account, platform: conn.platform, ...(await syncConnection(conn, { start, end: addDays(start, 6) }, "manual")) });
    }
  }
  return results;
}

// Hourly check — the first check after each week is ready fetches it; failures retry every hour (up to 6 times)
let timer = null;
export function startMetaTimer() {
  if (timer) return;
  const tick = () => syncDue().catch((e) => console.error("[insights] Meta timer:", e.message));
  setTimeout(tick, 2 * 60 * 1000);
  timer = setInterval(tick, 60 * 60 * 1000);
}
