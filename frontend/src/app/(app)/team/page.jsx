'use client';
// Team: the admin adds team members here (name, email, password). They log in with that email + password
// and see only the tasks assigned to them. Tasks on accounts (Pipeline) are assigned to these people.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LuCopy, LuKeyRound, LuPlus, LuTrash2, LuUserPlus } from 'react-icons/lu';
import { api, date, notify } from '@/lib/api';

const EMPTY = { name: '', title: '', email: '', password: '' };
// readable random password (no 0/O, 1/l)
const makePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const pick = new Uint32Array(12);
  crypto.getRandomValues(pick);
  return Array.from(pick, (n) => chars[n % chars.length]).join('').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
};

export default function TeamPage() {
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null);
  const [made, setMade] = useState(null); // login details to share once
  const [reset, setReset] = useState(null); // { id, password }

  const load = useCallback(() => api('/api/team').then(setList).catch((e) => notify(e.message, 'error')), []);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      const u = await api('/api/team', { method: 'POST', body: form });
      setMade({ name: u.name, email: u.email, password: form.password });
      setForm(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const update = async (m, body, msg) => {
    try {
      await api(`/api/team/${m._id}`, { method: 'PUT', body });
      if (msg) notify(msg);
      load();
      return true;
    } catch (e) {
      notify(e.message, 'error');
      return false;
    }
  };
  const remove = async (m) => {
    if (!window.confirm(`Delete ${m.name}? Their login stops working. Their ${m.openTasks} open task(s) stay on the accounts so you can give them to someone else.`)) return;
    try {
      await api(`/api/team/${m._id}`, { method: 'DELETE' });
      notify(`${m.name} deleted`);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => notify('Copied')).catch(() => {});

  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Team</h1>
          <p>Add your team here. Each person logs in with their email + the password you set, and sees only the work assigned to them.</p>
        </div>
        <button className="btn" onClick={() => setForm({ ...EMPTY, password: makePassword() })}><LuUserPlus /> Add team member</button>
      </div>

      {made && (
        <div className="card tm-made">
          <h2>Login created for {made.name}</h2>
          <p className="muted small">Share these with {made.name}. The password is not shown again (you can reset it any time).</p>
          <div className="tm-cred">
            <span>Website</span><b>{typeof window !== 'undefined' ? window.location.origin : ''}/login</b>
            <span>Email</span><b>{made.email}</b>
            <span>Password</span><b>{made.password}</b>
          </div>
          <div className="row">
            <button className="btn soft sm" onClick={() => copy(`Geek CRM login\n${window.location.origin}/login\nEmail: ${made.email}\nPassword: ${made.password}`)}><LuCopy /> Copy login details</button>
            <button className="btn ghost sm" onClick={() => setMade(null)}>Done</button>
          </div>
        </div>
      )}

      {form && (
        <form className="card tm-form" onSubmit={add}>
          <label className="field">Name *<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Aanchal" /></label>
          <label className="field">Designation<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Account manager" /></label>
          <label className="field">Email (login ID) *<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="aanchal@geekcreativeagency.com" /></label>
          <label className="field">Password *
            <span className="tm-pass">
              <input required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" className="btn ghost sm" onClick={() => setForm({ ...form, password: makePassword() })}>New</button>
            </span>
          </label>
          <div className="row tm-wide">
            <button className="btn"><LuPlus /> Create login</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        {!list ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="empty">No team members yet. Add your team — then you can assign them work on accounts in <Link href="/pipeline">Pipeline</Link>.</p>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead><tr><th>Name</th><th>Email (login)</th><th>Open tasks</th><th>Last login</th><th>Access</th><th>Actions</th></tr></thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m._id} className={m.active ? '' : 'tm-off'}>
                    <td><b>{m.name}</b>{m.title && <small className="tm-sub">{m.title}</small>}</td>
                    <td data-label="Email">{m.email}</td>
                    <td data-label="Open tasks">{m.openTasks || '—'}</td>
                    <td data-label="Last login">{m.lastLoginAt ? date(m.lastLoginAt) : 'Never'}</td>
                    <td data-label="Access">
                      <label className="tm-switch">
                        <input type="checkbox" checked={m.active} onChange={(e) => update(m, { active: e.target.checked }, e.target.checked ? 'Login turned on' : 'Login turned off')} />
                        {m.active ? 'Can log in' : 'Blocked'}
                      </label>
                    </td>
                    <td data-label="Actions">
                      {reset?.id === m._id ? (
                        <form className="row tm-reset" onSubmit={async (e) => { e.preventDefault(); if (await update(m, { password: reset.password })) { setMade({ name: m.name, email: m.email, password: reset.password }); setReset(null); } }}>
                          <input minLength={8} required value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} />
                          <button className="btn sm">Save</button>
                          <button type="button" className="btn ghost sm" onClick={() => setReset(null)}>Cancel</button>
                        </form>
                      ) : (
                        <div className="row tm-actions">
                          <button className="btn ghost sm" onClick={() => setReset({ id: m._id, password: makePassword() })}><LuKeyRound /> Reset password</button>
                          <button className="btn ghost sm tm-del" onClick={() => remove(m)}><LuTrash2 /> Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const css = `
.tm-form { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-items: end; }
.tm-wide { grid-column: 1 / -1; }
.tm-pass { display: flex; gap: 6px; }
.tm-made { border: 1px solid rgba(22,163,74,.25); background: rgba(240,253,244,.85); }
.tm-cred { display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; font-size: 14px; margin: 12px 0; background: #fff; border-radius: 12px; padding: 12px 14px; }
.tm-cred span { color: #64748b; }
.tm-cred b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.tm-sub { display: block; font-size: 12px; color: #64748b; }
.tm-off td { opacity: .55; }
.tm-switch { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; cursor: pointer; }
.tm-switch input { width: auto; }
.tm-actions { gap: 6px; flex-wrap: nowrap; }
.tm-actions .btn { background: transparent; border-color: transparent; box-shadow: none; color: #64748b; font-weight: 500; }
.tm-actions .btn:hover { background: var(--c-100); color: var(--c-700); transform: none; }
.tm-actions .tm-del:hover { background: rgba(225,29,72,.08); color: #e11d48; }
.tm-reset { gap: 6px; flex-wrap: nowrap; }
.tm-reset input { width: 170px; }
@media (max-width: 900px) { .tm-form { grid-template-columns: 1fr; } .tm-reset { flex-wrap: wrap; } }
`;
