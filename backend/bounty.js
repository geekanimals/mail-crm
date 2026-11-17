// Sync client logins with Bounty (Geek OS, bounty.geekcreativeagency.com/brands).
// Nothing in Bounty is changed: the CRM signs in as a Bounty Super Admin and uses Bounty's own functions,
// exactly as the Super Admin does by hand -
//   api.brand_list / api.brand_save  -> find or create the brand
//   brand-login (Edge Function)      -> make the brand's login (Bounty creates the password)
// The client's CRM login then gets the same email + password, so one login works on both.
// .env: BOUNTY_SUPABASE_URL, BOUNTY_SUPABASE_ANON_KEY, BOUNTY_ADMIN_EMAIL, BOUNTY_ADMIN_PASSWORD
import { fail } from './utils.js';

const env = (k) => String(process.env[k] || '').trim();
const URL_ = () => env('BOUNTY_SUPABASE_URL').replace(/\/+$/, '');
const ANON = () => env('BOUNTY_SUPABASE_ANON_KEY');
export const bountyReady = () => Boolean(URL_() && ANON() && env('BOUNTY_ADMIN_EMAIL') && env('BOUNTY_ADMIN_PASSWORD'));

async function call(path, { method = 'POST', token, body, profile } = {}) {
  const res = await fetch(`${URL_()}${path}`, {
    method,
    headers: {
      apikey: ANON(),
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), // new-style publishable keys go only in apikey
      ...(profile ? { 'Content-Profile': profile, 'Accept-Profile': profile } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  }).catch((e) => {
    throw fail(502, `Bounty could not be reached (${e.message})`);
  });
  const out = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, out };
}

/** sign in to Bounty with an email + password; returns the session or null */
export async function bountySignIn(email, password) {
  if (!URL_() || !ANON()) return null;
  const r = await call('/auth/v1/token?grant_type=password', { body: { email, password } });
  return r.ok && r.out?.access_token ? r.out : null;
}

let adminSession = { token: '', until: 0 };
async function adminToken() {
  if (adminSession.token && Date.now() < adminSession.until) return adminSession.token;
  const s = await bountySignIn(env('BOUNTY_ADMIN_EMAIL'), env('BOUNTY_ADMIN_PASSWORD'));
  if (!s) throw fail(502, 'The CRM could not sign in to Bounty. Check BOUNTY_ADMIN_EMAIL and BOUNTY_ADMIN_PASSWORD in .env.');
  adminSession = { token: s.access_token, until: Date.now() + Math.max(60, (s.expires_in || 3600) - 120) * 1000 };
  return adminSession.token;
}

const errText = (r) => r.out?.error || r.out?.message || r.out?.msg || `Bounty error ${r.status}`;

/** the Bounty brand with this name (same name, any case), or a new one */
export async function bountyBrand({ name, website }) {
  const token = await adminToken();
  const list = await call('/rest/v1/rpc/brand_list', { token, body: { p_q: name }, profile: 'api' });
  if (!list.ok) throw fail(502, `Bounty: ${errText(list)}`);
  const same = (Array.isArray(list.out) ? list.out : []).find((b) => String(b.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());
  if (same) return { brandId: same.brand_id, created: false, hasLogin: Boolean(same.has_login) };
  const made = await call('/rest/v1/rpc/brand_save', { token, body: { p: { name, ...(website ? { website } : {}), status: 'active' } }, profile: 'api' });
  if (!made.ok || !made.out?.brand_id) throw fail(502, `Bounty: ${errText(made)}`);
  return { brandId: made.out.brand_id, created: true, hasLogin: false };
}

/** make the brand's login on Bounty. Returns { email, password, memberId, loginUrl } - the password is shown once. */
export async function bountyBrandLogin({ brandId, email, name }) {
  const token = await adminToken();
  const r = await call('/functions/v1/brand-login', { token, body: { action: 'create', brand_id: brandId, email, name } });
  if (!r.ok || !r.out?.password) throw fail(r.status === 400 ? 409 : 502, `Bounty: ${errText(r)}`);
  return { email: r.out.email, password: r.out.password, memberId: r.out.member_id, loginUrl: r.out.login_url || '' };
}

/** a new password for a brand login on Bounty (Bounty creates it) */
export async function bountyResetLogin({ brandId, memberId }) {
  const token = await adminToken();
  const r = await call('/functions/v1/brand-login', { token, body: { action: 'reset', brand_id: brandId, member_id: memberId } });
  if (!r.ok || !r.out?.password) throw fail(502, `Bounty: ${errText(r)}`);
  return { email: r.out.email, password: r.out.password };
}

/** the client changes their password in the CRM: change it on Bounty too (signed in as the client) */
export async function bountyChangePassword(email, current, next) {
  const s = await bountySignIn(email, current);
  if (!s) return false;
  const r = await call('/auth/v1/user', { method: 'PUT', token: s.access_token, body: { password: next } });
  return r.ok;
}
