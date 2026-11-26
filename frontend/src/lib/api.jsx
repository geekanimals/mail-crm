'use client';
// Small helpers shared by every page: talk to the backend + format numbers/dates.

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001').replace(/\/$/, '');

export const getToken = () => (typeof window === 'undefined' ? null : localStorage.getItem('geek_token'));
export const setToken = (t) => (t ? localStorage.setItem('geek_token', t) : localStorage.removeItem('geek_token'));
// admin | team | client - decides where the person lands after login
export const getRole = () => (typeof window === 'undefined' ? null : localStorage.getItem('geek_role') || 'admin');
export const setRole = (r) => (r ? localStorage.setItem('geek_role', r) : localStorage.removeItem('geek_role'));

/** api('/api/contacts', { method: 'POST', body: {...}, query: {...} }) */
export async function api(path, { method = 'GET', body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v != null)) : '';
  let res;
  try {
    res = await fetch(API_URL + path + qs, {
      method,
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Backend is not reachable. Is it running on ' + API_URL + '?');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && !path.includes('/login')) {
    setToken(null);
    window.location.replace('/login');
  }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Error ${res.status}`), { status: res.status, data });
  return data;
}

/** show a small message at the bottom (the layout listens for this) */
export const notify = (text, type = 'ok') => window.dispatchEvent(new CustomEvent('geek-toast', { detail: { text, type } }));

export const num = (n) => new Intl.NumberFormat('en-IN').format(n || 0);
export const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const KIND_NAME = { later: 'Future follow-up', winback: 'Win-back email', after_meeting: 'Follow-up after the meeting' };
/** 1 = first email, 2 = follow-up 1 ...; kind = a planned follow-up from Needs you */
export const stepName = (n, kind) => (kind ? KIND_NAME[kind] || 'Follow-up' : !n ? 'Email' : n <= 1 ? 'First email' : `Follow-up ${n - 1}`);
/** the one page for a lead: its company with every person on it (jumps to this person), or the person alone */
/** the lead page link; tab: 'emails' | 'replies' | 'sheet' opens that person on that tab */
export const leadHref = (c, tab) => {
  const cid = c?.companyId?._id || c?.companyId;
  const t = tab && c?._id ? `&tab=${tab}` : '';
  return cid ? `/lead?company=${cid}${c?._id ? `&person=${c._id}` : ''}${t}` : `/lead?person=${c?._id || c}${t}`;
};
/** a campaign / upload name shown the same way everywhere: "GeekCreative leads 2026-11-26" -> "GeekCreative leads · 26 Nov 2026" */
export const campaignName = (n) =>
  String(n || '').replace(/\s*(\d{4})-(\d{2})-(\d{2})\b/, (_m, y, mo, d) => ` · ${new Date(`${y}-${mo}-${d}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`);
/** "7 getting emails · 3 bounced before": why a file campaign emails fewer people than the file had (same 10 as Contacts / Pipeline) */
export const fileLine = (f, emailing) => {
  if (!f) return '';
  const why = [['bounced', 'bounced before'], ['unsubscribed', 'unsubscribed'], ['replied', 'already replied'], ['noEmail', 'no email']]
    .filter(([k]) => f[k]).map(([k, l]) => `${f[k]} ${l}`);
  return [`${emailing} getting emails`, ...why].join(' · ');
};
