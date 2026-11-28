// Meta connections for Insights
//  - connectRoutes (behind login, /api/insights/meta): status, start a login, pick a Page, fetch now, disconnect
//  - oauthRoutes   (public, /api/insights-oauth): where Meta sends the person back after login
import { Router } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { addDays } from "../utils/dates.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { verify } from "../utils/secret.js";
import { Connection } from "../models/Connection.js";
import { SyncLog } from "../models/SyncLog.js";
import { choosePage, facebookPages, frontendUrl, instagramConnect, keepPending, loginUrl, metaSetup, readPending, readState, refreshFacebookPages, youtubeConnect } from "./auth.js";
import { readyWeek, syncNow } from "./sync.js";
import { freshToken } from "./auth.js";
import { instagramCheck } from "./fetch.js";

export const connectRoutes = Router();

connectRoutes.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const [connections, logs] = await Promise.all([Connection.find().sort({ account: 1, platform: 1 }), SyncLog.find().sort({ createdAt: -1 }).limit(40)]);
    res.json({ setup: metaSetup(), readyWeek: readyWeek(), connections, logs });
  })
);

connectRoutes.post(
  "/connect",
  asyncHandler(async (req, res) => {
    res.json({ url: loginUrl({ account: String(req.body?.account || "").trim(), platform: req.body?.platform, user: req.user }) });
  })
);

// Facebook: Pages the person manages, to pick the company's Page
connectRoutes.get(
  "/pending/:id",
  asyncHandler(async (req, res) => {
    const p = readPending(req.params.id);
    res.json({ account: p.account, pages: p.pages.map(({ id, name }) => ({ id, name })) });
  })
);

connectRoutes.post(
  "/pending/:id",
  asyncHandler(async (req, res) => {
    let conn;
    try {
      conn = await choosePage(req.params.id, String(req.body?.pageId || ""));
    } catch (e) {
      let account = "";
      try {
        account = readPending(req.params.id).account;
      } catch {
        /* the list expired — account unknown */
      }
      await logConnect({ account, platform: "Facebook", ok: false, message: `Picking the Page failed: ${e.message}` });
      throw e;
    }
    await logConnect({ account: conn.account, platform: "Facebook", ok: true, message: `Connected Page "${conn.name}"` });
    const first = await firstFetch(conn.account, conn.platform);
    res.json({ connection: conn, firstFetch: first });
  })
);

// Check (read-only): Instagram views of one week, broken down, with Facebook views of crossposted reels
// GET /check?account=GBTG&week=2026-11-16   (week = Monday; default the last finished week)
connectRoutes.get(
  "/check",
  asyncHandler(async (req, res) => {
    const conn = await Connection.findOne({ account: String(req.query.account || ""), platform: "Instagram" });
    if (!conn) throw notFound("This company has no Instagram connected");
    const week = req.query.week ? { start: String(req.query.week), end: addDays(String(req.query.week), 6) } : readyWeek();
    res.json(await instagramCheck(conn.externalId, await freshToken(conn), week));
  })
);

// "Fetch now" — { account?, platform?, weeks? (1–12) }
connectRoutes.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const results = await syncNow(req.body || {});
    if (!results.length) throw badRequest("Nothing is connected yet");
    res.json({ results });
  })
);

connectRoutes.delete(
  "/connections/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound("Connection not found");
    const conn = await Connection.findByIdAndDelete(req.params.id);
    if (!conn) throw notFound("Connection not found");
    res.json({ deleted: true }); // saved weekly numbers stay
  })
);

export const oauthRoutes = Router();

const back = (res, params) => res.redirect(`${frontendUrl()}/insights/connections?${new URLSearchParams(params)}`);

// Every connect attempt is written to the history (and the server log), so a failed login never disappears silently
export async function logConnect({ account, platform, ok, message }) {
  if (!ok) console.error(`[insights] Connect failed for ${account || "?"} · ${platform}: ${message}`);
  await SyncLog.create({ account: account || "—", platform, ok, trigger: "connect", message }).catch(() => {});
}
const accountOf = (state) => verify(String(state || ""))?.account || "";

// After a new connection: last week is fetched straight away; the 12 weeks before it follow in the background
async function firstFetch(account, platform) {
  const [first] = await syncNow({ account, platform, weeks: 1 });
  syncNow({ account, platform, weeks: 12 }).catch((e) => console.error(`[insights] 12-week fetch failed for ${account} · ${platform}: ${e.message}`));
  return first;
}

async function failed(res, req, platform, message) {
  await logConnect({ account: accountOf(req.query.state), platform, ok: false, message });
  back(res, { error: message });
}

oauthRoutes.get("/facebook/callback", async (req, res) => {
  try {
    if (req.query.error) return failed(res, req, "Facebook", String(req.query.error_description || "Facebook login was cancelled"));
    const state = readState(req.query.state, "Facebook");
    const pages = await facebookPages(String(req.query.code || ""));
    if (!pages.length) return failed(res, req, "Facebook", "Facebook login worked, but no Facebook Page was shared — connect again and tick the company's Page (the login must be a Page admin)");
    const refreshed = await refreshFacebookPages(pages);
    await logConnect({
      account: state.account,
      platform: "Facebook",
      ok: true,
      message:
        `Logged in — ${pages.length} Page${pages.length === 1 ? "" : "s"} shared (${pages.map((p) => p.name).join(", ")}). Waiting for the Page to be picked.` +
        (refreshed.length ? ` Login refreshed for: ${refreshed.join(", ")}.` : ""),
    });
    back(res, { pick: keepPending(state, pages), account: state.account });
  } catch (e) {
    await failed(res, req, "Facebook", e.message);
  }
});

oauthRoutes.get("/instagram/callback", async (req, res) => {
  try {
    if (req.query.error) return failed(res, req, "Instagram", String(req.query.error_description || "Instagram login was cancelled"));
    const state = readState(req.query.state, "Instagram");
    const conn = await instagramConnect(String(req.query.code || "").replace(/#_$/, ""), state);
    await logConnect({ account: conn.account, platform: "Instagram", ok: true, message: `Connected ${conn.name || "the Instagram account"}` });
    const first = await firstFetch(conn.account, "Instagram");
    back(res, { connected: "Instagram", account: conn.account, name: conn.name, fetched: first?.ok ? "1" : "0" });
  } catch (e) {
    await failed(res, req, "Instagram", e.message);
  }
});

oauthRoutes.get("/youtube/callback", async (req, res) => {
  try {
    if (req.query.error) return failed(res, req, "YouTube", req.query.error === "access_denied" ? "YouTube login was cancelled" : String(req.query.error));
    const state = readState(req.query.state, "YouTube");
    const conn = await youtubeConnect(String(req.query.code || ""), state);
    await logConnect({ account: conn.account, platform: "YouTube", ok: true, message: `Connected ${conn.name || "the YouTube channel"}` });
    const first = await firstFetch(conn.account, "YouTube");
    back(res, { connected: "YouTube", account: conn.account, name: conn.name, fetched: first?.ok ? "1" : "0" });
  } catch (e) {
    await failed(res, req, "YouTube", e.message);
  }
});
