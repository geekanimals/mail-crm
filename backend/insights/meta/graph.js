// Small helper for Meta's Graph APIs: GET/POST with readable errors
import { config } from "../../config.js";

export const FB_GRAPH = () => `https://graph.facebook.com/${config.meta.graphVersion}`;
export const IG_GRAPH = () => `https://graph.instagram.com/${config.meta.graphVersion}`;

export class MetaError extends Error {
  constructor(message, { code, reconnect = false, retry = false } = {}) {
    super(message);
    this.code = code;
    this.reconnect = reconnect; // the login expired or was removed → user must reconnect
    this.retry = retry; // temporary (rate limit / Meta down) → try again later
    this.status = 502;
  }
}

// Turns Meta's error JSON into a sentence the team can act on
function explain(err, status) {
  const code = err?.code;
  const msg = err?.error_user_msg || err?.message || `Meta answered ${status}`;
  if (code === 190 || code === 102) return new MetaError("Login expired or was removed — click Reconnect", { code, reconnect: true });
  if (code === 10 || (code >= 200 && code < 300)) return new MetaError(`Permission missing — reconnect and allow every permission (${msg})`, { code, reconnect: true });
  if ([4, 17, 32, 613].includes(code) || status >= 500) return new MetaError(`Meta is busy or down right now — will try again (${msg})`, { code, retry: true });
  return new MetaError(msg, { code });
}

export async function graphGet(url, params = {}) {
  const u = new URL(url);
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== "" && u.searchParams.set(k, v));
  let res;
  try {
    res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new MetaError("Couldn't reach Meta (network) — will try again", { retry: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw explain(data.error, res.status);
  return data;
}

export async function graphPostForm(url, fields) {
  let res;
  try {
    res = await fetch(url, { method: "POST", body: new URLSearchParams(fields), signal: AbortSignal.timeout(20000) });
  } catch {
    throw new MetaError("Couldn't reach Meta (network) — try again", { retry: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || data.error_message) throw explain(data.error || { message: data.error_message, code: data.code }, res.status);
  return data;
}
