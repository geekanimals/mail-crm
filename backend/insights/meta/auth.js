// Meta logins for Insights:
//  - Facebook Page: Facebook Login for Business → long-lived Page token (no expiry)
//  - Instagram:     Instagram Login → long-lived token (60 days, refreshed automatically)
import { config } from "../../config.js";
import { badRequest } from "../utils/httpError.js";
import { decrypt, encrypt, sign, verify } from "../utils/secret.js";
import { Connection } from "../models/Connection.js";
import { FB_GRAPH, IG_GRAPH, graphGet, graphPostForm } from "./graph.js";

export const redirectUri = (provider) => `${config.publicUrl}/api/insights-oauth/${provider}/callback`;
export const frontendUrl = () => config.frontendUrls[0];

export function metaSetup() {
  const m = config.meta;
  return {
    facebook: Boolean(m.appId && m.appSecret && m.loginConfigId),
    instagram: Boolean(m.igAppId && m.igAppSecret),
    redirectUris: { facebook: redirectUri("facebook"), instagram: redirectUri("instagram") },
  };
}

// Link that sends the admin to Meta's login page for one company + platform
export function loginUrl({ account, platform, user }) {
  if (!account) throw badRequest("Pick a company first");
  const state = sign({ account, platform, user, exp: Date.now() + 15 * 60 * 1000 });
  const m = config.meta;
  if (platform === "Facebook") {
    if (!metaSetup().facebook) throw badRequest("Facebook connect isn't set up on the server yet (META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID)");
    const u = new URL(`https://www.facebook.com/${m.graphVersion}/dialog/oauth`);
    u.search = new URLSearchParams({ client_id: m.appId, redirect_uri: redirectUri("facebook"), config_id: m.loginConfigId, response_type: "code", state }).toString();
    return u.toString();
  }
  if (platform === "Instagram") {
    if (!metaSetup().instagram) throw badRequest("Instagram connect isn't set up on the server yet (META_IG_APP_ID, META_IG_APP_SECRET)");
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.search = new URLSearchParams({
      client_id: m.igAppId,
      redirect_uri: redirectUri("instagram"),
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_manage_insights",
      state,
    }).toString();
    return u.toString();
  }
  throw badRequest("Only Facebook and Instagram can be connected");
}

export function readState(state, platform) {
  const s = verify(state);
  if (!s || s.platform !== platform) throw badRequest("This login link expired — start again from Connections");
  return s;
}

// ---- Facebook: code → user token → long-lived → list of Pages the person manages ----
export async function facebookPages(code) {
  const m = config.meta;
  const short = await graphGet(`${FB_GRAPH()}/oauth/access_token`, { client_id: m.appId, client_secret: m.appSecret, redirect_uri: redirectUri("facebook"), code });
  const long = await graphGet(`${FB_GRAPH()}/oauth/access_token`, { grant_type: "fb_exchange_token", client_id: m.appId, client_secret: m.appSecret, fb_exchange_token: short.access_token });
  const pages = await graphGet(`${FB_GRAPH()}/me/accounts`, { fields: "id,name,access_token", limit: 100, access_token: long.access_token });
  return (pages.data || []).map((p) => ({ id: p.id, name: p.name, token: p.access_token }));
}

// Pages waiting for the admin to pick which one belongs to the company (kept 15 minutes, in memory)
const pending = new Map();
export function keepPending(state, pages) {
  const id = sign({ n: Math.random(), exp: Date.now() + 15 * 60 * 1000 }).slice(-24);
  pending.set(id, { ...state, pages, exp: Date.now() + 15 * 60 * 1000 });
  for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
  return id;
}
export function readPending(id) {
  const p = pending.get(id);
  if (!p || p.exp < Date.now()) throw badRequest("The page list expired — connect again");
  return p;
}
export async function choosePage(id, pageId) {
  const p = readPending(id);
  const page = p.pages.find((x) => x.id === pageId);
  if (!page) throw badRequest("Pick one of the listed Pages");
  pending.delete(id);
  return saveConnection({ account: p.account, platform: "Facebook", externalId: page.id, name: page.name, token: page.token, expiresAt: null, user: p.user });
}

// ---- Instagram: code → short token → long-lived (60 days) → account details ----
export async function instagramConnect(code, state) {
  const m = config.meta;
  const short = await graphPostForm("https://api.instagram.com/oauth/access_token", {
    client_id: m.igAppId,
    client_secret: m.igAppSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri("instagram"),
    code,
  });
  const long = await graphGet("https://graph.instagram.com/access_token", { grant_type: "ig_exchange_token", client_secret: m.igAppSecret, access_token: short.access_token });
  const me = await graphGet(`${IG_GRAPH()}/me`, { fields: "user_id,username,account_type", access_token: long.access_token });
  return saveConnection({
    account: state.account,
    platform: "Instagram",
    externalId: String(me.user_id || short.user_id),
    name: me.username ? "@" + me.username : "",
    token: long.access_token,
    expiresAt: new Date(Date.now() + (long.expires_in || 60 * 86400) * 1000),
    user: state.user,
  });
}

// Instagram tokens: refresh when less than 15 days are left
export async function freshToken(conn) {
  const token = decrypt(conn.tokenEnc);
  if (conn.platform !== "Instagram" || !conn.tokenExpiresAt) return token;
  if (conn.tokenExpiresAt - Date.now() > 15 * 86400 * 1000) return token;
  const r = await graphGet("https://graph.instagram.com/refresh_access_token", { grant_type: "ig_refresh_token", access_token: token });
  conn.tokenEnc = encrypt(r.access_token);
  conn.tokenExpiresAt = new Date(Date.now() + (r.expires_in || 60 * 86400) * 1000);
  await conn.save();
  return r.access_token;
}

async function saveConnection({ account, platform, externalId, name, token, expiresAt, user }) {
  return Connection.findOneAndUpdate(
    { account, platform },
    { account, platform, externalId, name, tokenEnc: encrypt(token), tokenExpiresAt: expiresAt, connectedBy: user || "", status: "ok", lastError: "", failures: 0 },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
