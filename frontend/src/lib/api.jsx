'use client';
// Small helpers shared by every page: talk to the backend + format numbers/dates.

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001').replace(/\/$/, '');

export const getToken = () => (typeof window === 'undefined' ? null : localStorage.getItem('geek_token'));
export const setToken = (t) => (t ? localStorage.setItem('geek_token', t) : localStorage.removeItem('geek_token'));

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
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

/** show a small message at the bottom (the layout listens for this) */
export const notify = (text, type = 'ok') => window.dispatchEvent(new CustomEvent('geek-toast', { detail: { text, type } }));

export const num = (n) => new Intl.NumberFormat('en-IN').format(n || 0);
export const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const stepName = (n) => (n <= 1 ? 'First email' : `Follow-up ${n - 1}`);
