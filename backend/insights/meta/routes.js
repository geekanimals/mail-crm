// Meta connections for Insights
//  - connectRoutes (behind login, /api/insights/meta): status, start a login, pick a Page, fetch now, disconnect
//  - oauthRoutes   (public, /api/insights-oauth): where Meta sends the person back after login
import { Router } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { addDays } from "../utils/dates.js";
import { badRequest, notFound } from "../utils/httpError.js";
import { Connection } from "../models/Connection.js";
import { SyncLog } from "../models/SyncLog.js";
import { choosePage, facebookPages, frontendUrl, instagramConnect, keepPending, loginUrl, metaSetup, readPending, readState, youtubeConnect } from "./auth.js";
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
    const conn = await choosePage(req.params.id, String(req.body?.pageId || ""));
    const [first] = await syncNow({ account: conn.account, platform: conn.platform, weeks: 1 });
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

oauthRoutes.get("/facebook/callback", async (req, res) => {
  try {
    if (req.query.error) return back(res, { error: String(req.query.error_description || "Facebook login was cancelled") });
    const state = readState(req.query.state, "Facebook");
    const pages = await facebookPages(String(req.query.code || ""));
    if (!pages.length) return back(res, { error: "No Facebook Pages were shared — log in again and tick the company's Page" });
    back(res, { pick: keepPending(state, pages), account: state.account });
  } catch (e) {
    back(res, { error: e.message });
  }
});

oauthRoutes.get("/instagram/callback", async (req, res) => {
  try {
    if (req.query.error) return back(res, { error: String(req.query.error_description || "Instagram login was cancelled") });
    const state = readState(req.query.state, "Instagram");
    const conn = await instagramConnect(String(req.query.code || "").replace(/#_$/, ""), state);
    const [first] = await syncNow({ account: conn.account, platform: "Instagram", weeks: 1 });
    back(res, { connected: "Instagram", account: conn.account, name: conn.name, fetched: first?.ok ? "1" : "0" });
  } catch (e) {
    back(res, { error: e.message });
  }
});

oauthRoutes.get("/youtube/callback", async (req, res) => {
  try {
    if (req.query.error) return back(res, { error: req.query.error === "access_denied" ? "YouTube login was cancelled" : String(req.query.error) });
    const state = readState(req.query.state, "YouTube");
    const conn = await youtubeConnect(String(req.query.code || ""), state);
    const [first] = await syncNow({ account: conn.account, platform: "YouTube", weeks: 1 });
    back(res, { connected: "YouTube", account: conn.account, name: conn.name, fetched: first?.ok ? "1" : "0" });
  } catch (e) {
    back(res, { error: e.message });
  }
});
