'use client';
// Contacts: search, filter by status, add, mark replied, unsubscribe, delete, see email history
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuFileSpreadsheet, LuUserPlus } from 'react-icons/lu';
import { api, date, num, notify, stepName } from '@/lib/api';

const TABS = ['', 'new', 'contacted', 'replied', 'unsubscribed', 'bounced'];
const EMPTY = { name: '', email: '', company: '', phone: '' };

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(null); // contact history

  const load = useCallback(() => {
    api('/api/contacts', { query: { search, status, page } }).then(setData).catch((e) => notify(e.message, 'error'));
  }, [search, status, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/contacts', { method: 'POST', body: form });
      notify('Contact added');
      setForm(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const action = async (c, what) => {
    const ask = { unsubscribe: `Unsubscribe ${c.email}? They will never be emailed again.`, delete: `Delete ${c.email}?` }[what];
    if (ask && !window.confirm(ask)) return;
    try {
      if (what === 'delete') await api(`/api/contacts/${c._id}`, { method: 'DELETE' });
      else await api(`/api/contacts/${c._id}/${what}`, { method: 'POST' });
      notify('Done');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const showHistory = (c) => api(`/api/contacts/${c._id}`).then(setOpen).catch((e) => notify(e.message, 'error'));
  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Contacts</h1>
          <p>Replied, unsubscribed and bounced contacts are never emailed again.</p>
        </div>
        <div className="row">
          <Link href="/import" className="btn ghost"><LuFileSpreadsheet /> Import file</Link>
          <button className="btn" onClick={() => setForm(EMPTY)}><LuUserPlus /> Add Contact</button>
        </div>
      </div>

      {form && (
        <form className="card ct-form" onSubmit={add}>
          {Object.keys(EMPTY).map((k) => (
            <label className="field" key={k}>
              {k[0].toUpperCase() + k.slice(1)} {k === 'email' && '*'}
              <input type={k === 'email' ? 'email' : 'text'} required={k === 'email'} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          <div className="row">
            <button className="btn">Save</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="tabs">
          {TABS.map((s) => (
            <button key={s} className={status === s ? 'on' : ''} onClick={() => { setStatus(s); setPage(1); }}>
              {s || 'All'} <span className="ct-count">{num(s ? counts[s] : total)}</span>
            </button>
          ))}
        </div>
        <input className="ct-search" placeholder="Search name, email or company…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />

        {!data ? (
          <p className="muted">Loading…</p>
        ) : data.items.length === 0 ? (
          <p className="empty">No contacts found.</p>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead>
                <tr><th>Name</th><th>Company</th><th>Status</th><th>Last emailed</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c._id}>
                    <td>
                      <button className="ct-name" onClick={() => showHistory(c)}>
                        <b>{c.name || '—'}</b>
                        <small>{c.email}</small>
                      </button>
                    </td>
                    <td data-label="Company">{c.company || '—'}</td>
                    <td data-label="Status"><span className={`badge ${c.status}`}>{c.status}</span></td>
                    <td data-label="Last emailed">{date(c.lastContactedAt)}</td>
                    <td data-label="Actions">
                      <div className="row ct-actions">
                        {!['replied', 'unsubscribed'].includes(c.status) && <button className="btn ghost sm" onClick={() => action(c, 'replied')}>Replied</button>}
                        {c.status !== 'unsubscribed' && <button className="btn ghost sm" onClick={() => action(c, 'unsubscribe')}>Unsubscribe</button>}
                        <button className="btn ghost sm ct-del" onClick={() => action(c, 'delete')}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.pages > 1 && (
          <div className="row ct-pager">
            <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><LuChevronLeft /> Prev</button>
            <span className="small muted">Page {page} of {data.pages}</span>
            <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next <LuChevronRight /></button>
          </div>
        )}
      </div>

      {open && (
        <div className="ct-overlay" onClick={() => setOpen(null)}>
          <div className="ct-panel" onClick={(e) => e.stopPropagation()}>
            <div className="row ct-panel-head">
              <div>
                <h2>{open.contact.name || open.contact.email}</h2>
                <p className="muted small">{open.contact.email} · {open.contact.company || 'No company'}</p>
              </div>
              <button className="btn ghost sm" onClick={() => setOpen(null)}>Close</button>
            </div>
            <span className={`badge ${open.contact.status}`}>{open.contact.status}</span>
            {open.planned?.length > 0 && (
              <>
                <h3>Planned emails ({open.planned.length})</h3>
                {open.planned.map((m, i) => (
                  <div key={i} className={`ct-item plan ${i < open.emails.filter((e) => e.status === 'sent').length ? 'sent' : ''}`}>
                    <b>{i === 0 ? 'First email' : `Follow-up ${i}`}</b>
                    <small>{m.subject || (i === 0 ? '(no subject)' : 'Re: same thread')}</small>
                    <p>{m.body}</p>
                  </div>
                ))}
              </>
            )}
            <h3>Sent emails</h3>
            {open.emails.length === 0 && <p className="muted small">No emails sent yet.</p>}
            {open.emails.map((m) => (
              <div key={m._id} className="ct-item">
                <b>{stepName(m.step)}</b> · {m.campaign?.name || ''}
                <small>{m.subject}</small>
                <small>{date(m.sentAt)} {m.status === 'failed' ? `· failed: ${m.error}` : ''}{m.openedAt ? ' · opened' : ''}</small>
              </div>
            ))}
            {open.replies.length > 0 && <h3>Replies</h3>}
            {open.replies.map((r) => (
              <div key={r._id} className="ct-item reply">
                <small>{date(r.receivedAt)} {r.isAutoReply ? '(auto-reply)' : ''}</small>
                <p>{r.snippet || r.subject}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const css = `
.ct-form { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-items: end; }
.ct-form .row { grid-column: 1 / -1; }
.ct-count { font-size: 11px; background: rgba(148,163,184,.18); padding: 1px 7px; border-radius: 99px; margin-left: 4px; }
.ct-search { margin-bottom: 14px; }
.ct-name { background: none; border: 0; text-align: left; cursor: pointer; }
.ct-name:hover b { color: var(--c-700); }
.ct-name small { display: block; color: #64748b; font-size: 12px; }
.ct-actions { gap: 6px; flex-wrap: nowrap; }
.ct-actions .btn { background: transparent; border-color: transparent; box-shadow: none; color: #64748b; font-weight: 500; }
.ct-actions .btn:hover { background: var(--c-100); color: var(--c-700); transform: none; }
.ct-actions .ct-del:hover { background: rgba(225,29,72,.08); color: #e11d48; }
.ct-pager { justify-content: center; margin-top: 14px; }
.ct-overlay { position: fixed; inset: 0; background: rgba(14,42,51,.2); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); z-index: 40; display: flex; justify-content: flex-end; }
.ct-panel { background: rgba(255,255,255,.82); backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%); border-left: 1px solid rgba(255,255,255,.8); box-shadow: -20px 0 60px rgba(30,41,99,.15); width: 440px; max-width: 100%; height: 100%; overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 10px; }
.ct-panel-head { justify-content: space-between; align-items: flex-start; flex-wrap: nowrap; }
.ct-panel h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; margin-top: 10px; }
.ct-item { background: rgba(255,255,255,.6); border: 1px solid rgba(148,163,184,.25); border-radius: 14px; padding: 10px 12px; font-size: 13.5px; }
.ct-item small { display: block; color: #64748b; font-size: 12px; }
.ct-item.reply { border-left: 3px solid #16a34a; }
.ct-item.plan { border-left: 3px solid var(--c-200); }
.ct-item.plan.sent { border-left-color: var(--c); opacity: .7; }
.ct-item p { white-space: pre-wrap; margin-top: 4px; }
@media (max-width: 900px) {
  .ct-form { grid-template-columns: 1fr; }
  .ct-actions { flex-wrap: wrap; justify-content: flex-end; }
}
`;
