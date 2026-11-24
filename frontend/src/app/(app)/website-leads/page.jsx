'use client';
// Website Leads (admin): every "Work with us" (client) form sent on geekcreativeagency.com.
// The email still goes out as before; each lead is also here, and its company is a Hot lead in Pipeline,
// so Aanchal gets "Reply and book a meeting" on her own. Track it here with a status and notes.
import { useCallback, useEffect, useState } from 'react';
import { LuChevronDown, LuChevronUp, LuGlobe, LuMail, LuPhone, LuSearch, LuTrash2 } from 'react-icons/lu';
import { api, date, notify } from '@/lib/api';
import { ConfirmDialog } from '@/lib/hr';

const STAGE = { cold: 'Cold lead', hot: 'Hot lead', opportunity: 'Opportunity', account: 'Account', old_client: 'Old client' };
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

export default function WebsiteLeadsPage() {
  const [d, setD] = useState(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null);

  const load = useCallback(
    () => api('/api/website-leads', { query: { status, q } }).then(setD).catch((e) => notify(e.message, 'error')),
    [status, q]
  );
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => {
    const t = setInterval(load, 30000); // new enquiries show up without a refresh
    return () => clearInterval(t);
  }, [load]);

  const update = (lead) => setD((x) => (x ? { ...x, list: x.list.map((l) => (l._id === lead._id ? lead : l)) } : x));
  const setLeadStatus = async (l, s) => {
    try {
      update(await api(`/api/website-leads/${l._id}`, { method: 'PUT', body: { status: s } }));
      notify('Status saved');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const addNote = async (e, l) => {
    e.preventDefault();
    if (!note.trim() || busy) return;
    setBusy(true);
    try {
      update(await api(`/api/website-leads/${l._id}/notes`, { method: 'POST', body: { text: note } }));
      setNote('');
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };
  const delNote = (l, n) => api(`/api/website-leads/${l._id}/notes/${n._id}`, { method: 'DELETE' }).then(update).catch((e) => notify(e.message, 'error'));
  const remove = (l) => setAsk({
    title: `Delete the lead from ${l.name || l.email}?`,
    text: 'It is removed from this list only. The company and the contact stay in Pipeline and Contacts.',
    confirm: 'Yes, delete',
    danger: true,
    run: async () => {
      await api(`/api/website-leads/${l._id}`, { method: 'DELETE' });
      setOpen(null);
      load();
    },
  });

  if (!d) return <p className="muted">Loading…</p>;
  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Website Leads</h1>
          <p>Every client form from geekcreativeagency.com. Each one is also a Hot lead in Pipeline, and Aanchal gets a task to reply and book a meeting.</p>
        </div>
      </div>
      {!d.ready && (
        <div className="card wl-warn">
          <b>Not connected yet.</b>
          <span>Add the same WEBSITE_LEAD_SECRET to the CRM backend .env and to the website .env (with CRM_LEAD_URL), then restart both.</span>
        </div>
      )}

      <div className="card">
        <div className="wl-bar">
          <div className="tabs">
            <button className={status === '' ? 'on' : ''} onClick={() => setStatus('')}>All ({d.counts.all})</button>
            {d.statuses.map((s) => (
              <button key={s.key} className={status === s.key ? 'on' : ''} onClick={() => setStatus(s.key)}>{s.label} ({d.counts[s.key]})</button>
            ))}
          </div>
          <label className="wl-search"><LuSearch /><input placeholder="Search name, email, company, phone…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>

        {d.list.length === 0 && <p className="empty">{q || status ? 'No leads match.' : 'No website leads yet. They appear here as soon as someone sends the client form.'}</p>}
        {d.list.map((l) => {
          const isOpen = open === l._id;
          return (
            <div key={l._id} className={`wl-item s-${l.status}`}>
              <button type="button" className="wl-head" onClick={() => { setOpen(isOpen ? null : l._id); setNote(''); }} aria-expanded={isOpen}>
                <div className="wl-who">
                  <b>{l.name || l.email}</b>
                  <small>{[l.designation, l.company].filter(Boolean).join(' · ') || l.email}</small>
                </div>
                <div className="wl-tags">
                  {l.budget && <span className="wl-chip">{l.budget}</span>}
                  {l.stage && <span className={`wl-stage ${l.stage}`}>{STAGE[l.stage]}</span>}
                  {l.times > 1 && <span className="wl-chip">Sent {l.times} times</span>}
                  <span className={`wl-status ${l.status}`}>{l.statusLabel}</span>
                  <small className="muted">{when(l.lastAt)}</small>
                  {isOpen ? <LuChevronUp /> : <LuChevronDown />}
                </div>
              </button>

              {isOpen && (
                <div className="wl-body">
                  <div className="wl-contact">
                    <a href={`mailto:${l.email}?subject=${encodeURIComponent('Your enquiry with Geek Creative Agency')}`}><LuMail /> {l.email}</a>
                    {l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}><LuPhone /> {l.phone}</a>}
                    {l.page && <a href={l.page} target="_blank" rel="noreferrer"><LuGlobe /> Form page</a>}
                  </div>
                  <dl className="wl-grid">
                    <div><dt>Company</dt><dd>{l.company || '—'}</dd></div>
                    <div><dt>Designation</dt><dd>{l.designation || '—'}</dd></div>
                    <div><dt>Budget</dt><dd>{l.budget || '—'}</dd></div>
                    <div><dt>Timeline</dt><dd>{l.timeline || '—'}</dd></div>
                    <div><dt>First sent</dt><dd>{date(l.createdAt)}</dd></div>
                    <div><dt>Pipeline</dt><dd>{l.stage ? STAGE[l.stage] : 'Not added'}</dd></div>
                  </dl>
                  {l.goal && <div className="wl-goal"><dt>Goal</dt><p>{l.goal}</p></div>}

                  {l.submissions.length > 1 && (
                    <details className="wl-subs">
                      <summary>Every time the form was sent ({l.submissions.length})</summary>
                      {[...l.submissions].reverse().map((s, i) => (
                        <div key={i} className="wl-sub">
                          <small className="muted">{when(s.at)}</small>
                          <span>{[s.company, s.budget, s.timeline].filter(Boolean).join(' · ')}</span>
                          {s.goal && <p>{s.goal}</p>}
                        </div>
                      ))}
                    </details>
                  )}

                  <div className="wl-row">
                    <label className="field wl-select">Status
                      <select value={l.status} onChange={(e) => setLeadStatus(l, e.target.value)}>
                        {d.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </label>
                    <a className="btn ghost sm" href="/pipeline">Open Pipeline</a>
                    <button type="button" className="btn red sm" onClick={() => remove(l)}><LuTrash2 /> Delete</button>
                  </div>

                  <div className="wl-notes">
                    <h3>Notes</h3>
                    {l.notes.length === 0 && <p className="small muted">No notes yet.</p>}
                    {[...l.notes].reverse().map((n) => (
                      <div key={n._id} className="wl-note">
                        <div><b>{n.by}</b> <small className="muted">{when(n.at)}</small><p>{n.text}</p></div>
                        {n.by === 'Admin' && <button type="button" className="wl-x" onClick={() => delNote(l, n)} aria-label="Delete note">×</button>}
                      </div>
                    ))}
                    <form className="wl-add" onSubmit={(e) => addNote(e, l)}>
                      <input maxLength={2000} placeholder="Add a note (call done, meeting booked…)" value={note} onChange={(e) => setNote(e.target.value)} />
                      <button className="btn sm" disabled={!note.trim() || busy}>{busy ? 'Saving…' : 'Add'}</button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}

const css = `
.wl-warn { display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(217,119,6,.3); background: #fffbeb; color: #92400e; }
.wl-bar { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.wl-bar .tabs { margin-bottom: 12px; }
.wl-search { position: relative; flex: 0 1 300px; min-width: 200px; margin-bottom: 12px; }
.wl-search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); }
.wl-search input { padding-left: 36px; }
.wl-item { border-bottom: 1px solid rgba(148,163,184,.2); }
.wl-item:last-child { border-bottom: 0; }
.wl-item.s-spam, .wl-item.s-closed { opacity: .7; }
.wl-head { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 4px; background: none; border: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; flex-wrap: wrap; }
.wl-head:hover b { color: var(--c-700); }
.wl-who { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 220px; }
.wl-who b, .wl-who small { overflow-wrap: anywhere; }
.wl-who small { color: var(--muted); font-size: 12.5px; }
.wl-tags { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.wl-chip { font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 99px; background: var(--c-50); color: var(--c-700); border: 1px solid var(--c-100); }
.wl-stage { font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 99px; background: #f1f5f9; color: #475569; }
.wl-stage.hot { background: #fff1e6; color: #c2410c; }
.wl-stage.opportunity { background: #fef9c3; color: #a16207; }
.wl-stage.account, .wl-stage.old_client { background: #dcfce7; color: #15803d; }
.wl-status { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 99px; background: #f1f5f9; color: #475569; }
.wl-status.new { background: #e0f2fe; color: #0369a1; }
.wl-status.contacted { background: #fef3c7; color: #a16207; }
.wl-status.converted { background: #dcfce7; color: #15803d; }
.wl-status.spam { background: #ffe4e6; color: #be123c; }
.wl-body { padding: 4px 4px 18px; display: flex; flex-direction: column; gap: 14px; }
.wl-contact { display: flex; gap: 8px 18px; flex-wrap: wrap; }
.wl-contact a { display: inline-flex; align-items: center; gap: 6px; color: var(--c-700); font-weight: 600; font-size: 13.5px; overflow-wrap: anywhere; }
.wl-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0; }
.wl-grid > div, .wl-goal { background: rgba(255,255,255,.65); border: 1px solid var(--line); border-radius: 12px; padding: 9px 12px; min-width: 0; }
.wl-grid dt, .wl-goal dt { font-size: 11.5px; color: var(--muted); font-weight: 600; }
.wl-grid dd { margin: 2px 0 0; font-size: 13.5px; overflow-wrap: anywhere; }
.wl-goal p { margin: 4px 0 0; white-space: pre-wrap; font-size: 13.5px; overflow-wrap: anywhere; }
.wl-subs summary { cursor: pointer; font-weight: 600; font-size: 13px; color: var(--c-700); }
.wl-sub { padding: 8px 0; border-bottom: 1px dashed var(--line); display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.wl-sub p { margin: 0; white-space: pre-wrap; color: #334155; overflow-wrap: anywhere; }
.wl-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.wl-select { width: 200px; }
.wl-notes h3 { font-size: 14px; margin: 0 0 6px; }
.wl-note { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px dashed var(--line); font-size: 13.5px; }
.wl-note p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.wl-x { background: none; border: 0; color: var(--muted); font-size: 18px; cursor: pointer; line-height: 1; }
.wl-x:hover { color: #e11d48; }
.wl-add { display: flex; gap: 8px; margin-top: 10px; }
.wl-add input { flex: 1; min-width: 0; }
@media (max-width: 700px) {
  .wl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wl-tags { justify-content: flex-start; }
  .wl-search { flex: 1 1 100%; }
}
`;
