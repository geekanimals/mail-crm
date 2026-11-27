// YouTube for Insights (free): Google login once per channel → refresh token kept encrypted →
// every week the YouTube Analytics API gives the channel's numbers for the finished Monday–Sunday.
// Only the read-only Analytics permission is asked for (a non-sensitive Google scope, so the app needs
// no Google verification). Public details — channel name, subscriber count, when videos were published —
// come from the YouTube Data API with a plain API key (YOUTUBE_API_KEY).
import { config } from "../../config.js";
import { badRequest } from "../utils/httpError.js";
import { decrypt } from "../utils/secret.js";
import { MetaError } from "./graph.js";

const SCOPES = ["https://www.googleapis.com/auth/yt-analytics.readonly"];
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

export const youtubeSetup = () => Boolean(config.youtube.clientId && config.youtube.clientSecret);

// Google's error JSON → a sentence the team can act on
function explain(data, status) {
  const err = data?.error;
  const msg = (typeof err === "object" ? err?.message : data?.error_description || err) || `Google answered ${status}`;
  if (err === "invalid_grant" || status === 401) return new MetaError("YouTube login expired or was removed — click Reconnect", { reconnect: true });
  if (status === 403 && /quota/i.test(msg)) return new MetaError(`YouTube's daily limit is used up — will try again (${msg})`, { retry: true });
  if (status === 403) return new MetaError(`YouTube permission missing — reconnect and allow access (${msg})`, { reconnect: true });
  if (status === 429 || status >= 500) return new MetaError(`YouTube is busy right now — will try again (${msg})`, { retry: true });
  return new MetaError(msg);
}

async function call(url, { params, form, token, key } = {}) {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => v !== undefined && v !== "" && u.searchParams.set(k, v));
  if (key) u.searchParams.set("key", config.youtube.apiKey);
  let res;
  try {
    res = await fetch(u, {
      method: form ? "POST" : "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new MetaError("Couldn't reach YouTube (network) — will try again", { retry: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw explain(data, res.status);
  return data;
}

// ---- login ----
export function youtubeLoginUrl({ redirectUri, state }) {
  if (!youtubeSetup()) throw badRequest("YouTube connect isn't set up on the server yet (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET)");
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: config.youtube.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // gives a refresh token, so the weekly fetch works without logging in again
    prompt: "consent select_account", // always ask, so Google sends the refresh token and lets them pick the brand channel
    include_granted_scopes: "true",
    state,
  }).toString();
  return u.toString();
}

// code → refresh token + the channel that was picked
export async function youtubeExchange(code, redirectUri) {
  const t = await call(TOKEN_URL, {
    form: { code, client_id: config.youtube.clientId, client_secret: config.youtube.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" },
  });
  if (!t.refresh_token) throw new MetaError("Google didn't send a long-term login — remove the app's access in your Google account and connect again");
  const today = new Date().toISOString().slice(0, 10);
  const probe = await call(ANALYTICS_API, { params: { ids: "channel==MINE", startDate: "2005-01-01", endDate: today, metrics: "views", dimensions: "video", sort: "-views", maxResults: 1 }, token: t.access_token });
  const videoId = probe.rows?.[0]?.[0];
  const info = videoId ? (await videoDetails([videoId]))[0] : null;
  return { refreshToken: t.refresh_token, channelId: info?.channelId || "MINE", name: info?.channelTitle || "YouTube channel" };
}

// Public video details (channel, title, publish time) with the API key — 50 ids per call
async function videoDetails(ids) {
  if (!config.youtube.apiKey || !ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await call(`${DATA_API}/videos`, { params: { part: "snippet", id: ids.slice(i, i + 50).join(","), maxResults: 50 }, key: true });
    for (const v of r.items || []) out.push({ id: v.id, channelId: v.snippet?.channelId, channelTitle: v.snippet?.channelTitle, publishedAt: v.snippet?.publishedAt });
  }
  return out;
}

// stored refresh token → short access token (Google's last 1 hour)
export async function youtubeAccessToken(conn) {
  const t = await call(TOKEN_URL, {
    form: { refresh_token: decrypt(conn.tokenEnc), client_id: config.youtube.clientId, client_secret: config.youtube.clientSecret, grant_type: "refresh_token" },
  });
  return t.access_token;
}

// ---- one week of numbers ----
const METRICS = ["views", "estimatedMinutesWatched", "likes", "comments", "shares", "subscribersGained", "subscribersLost"];

export async function youtubeWeek(channelId, token, { start, end }) {
  const values = {};
  const notes = [];

  const r = await call(ANALYTICS_API, { params: { ids: "channel==MINE", startDate: start, endDate: end, metrics: METRICS.join(",") }, token });
  const names = (r.columnHeaders || []).map((h) => h.name);
  const row = r.rows?.[0] || [];
  const get = (k) => (names.includes(k) ? Number(row[names.indexOf(k)]) || 0 : undefined);
  if (row.length) {
    values.views = get("views");
    values.watchTime = Math.round(((get("estimatedMinutesWatched") || 0) / 60) * 10) / 10; // hours
    values.likes = get("likes");
    values.comments = get("comments");
    values.shares = get("shares");
    values.interactions = (values.likes || 0) + (values.comments || 0) + (values.shares || 0); // YouTube has no single total
    const net = (get("subscribersGained") || 0) - (get("subscribersLost") || 0);
    if (net < 0) notes.push(`subscribers: ${net} this week (more left than joined), saved as 0`);
    values.newFollowers = Math.max(0, net);
  } else {
    notes.push("YouTube has no numbers for this week yet (it can take 2–3 days)");
  }

  // videos published in the week (from the videos that got views this week) + subscribers today (latest week only)
  if (!config.youtube.apiKey) notes.push("posts / total subscribers: add YOUTUBE_API_KEY to the backend .env");
  else {
    try {
      const vids = await call(ANALYTICS_API, { params: { ids: "channel==MINE", startDate: start, endDate: end, metrics: "views", dimensions: "video", sort: "-views", maxResults: 200 }, token });
      const details = await videoDetails((vids.rows || []).map((x) => x[0]));
      values.posts = details.filter((v) => {
        const day = v.publishedAt && new Date(Date.parse(v.publishedAt) + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
        return day && day >= start && day <= end;
      }).length;
      const id = channelId && channelId !== "MINE" ? channelId : details[0]?.channelId;
      const recent = Date.parse(end + "T23:59:59+05:30") > Date.now() - 9 * 86400 * 1000;
      if (id && recent) {
        const ch = await call(`${DATA_API}/channels`, { params: { part: "statistics", id }, key: true });
        const subs = Number(ch.items?.[0]?.statistics?.subscriberCount);
        if (subs) values.followers = subs;
      }
    } catch (e) {
      if (e.reconnect || e.retry) throw e;
      notes.push(`videos: ${e.message}`);
    }
  }

  if (!Object.keys(values).length) throw new MetaError(notes[0] || "YouTube returned no numbers for this week");
  return { values, notes };
}
