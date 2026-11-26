'use client';
// Emails: every email the CRM sent - opened from the dashboard boxes and chart.
// /emails?show=sent|opened|clicked  (&day=YYYY-MM-DD for one day, &step=N for one email of the sequence)
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuSearch, LuX } from 'react-icons/lu';
import { api, campaignName, leadHref, num, notify, stepName } from '@/lib/api';

const SHOWS = [['sent', 'Sent'], ['opened', 'Opened'], ['clicked', 'Clicked']];
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export default function EmailsPage() {
  const [f, setF] = useState(null); // { show, day, step } read from the link
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [d, setD] = useState(null);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const show = SHOWS.some(([k]) => k === qs.get('show')) ? qs.get('show') : 'sent';
    setTimeout(() => setF({ show, day: /^\d{4}-\d{2}-\d{2}$/.test(qs.get('day') || '') ? qs.get('day') : '', step: Number(qs.get('step')) || '' }), 0);
  }, []);
  useEffect(() => {
    if (!f) return undefined;
    let stale = false; // a newer filter replaced this one: drop its answer
    const t = setTimeout(() => api('/api/emails', { query: { ...f, q, page } }).then((r) => !stale && setD(r)).catch((e) => notify(e.message, 'error')), q ? 300 : 0);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [f, q, page]);

  // keep the address bar in step, so a refresh or a shared link shows the same list
  const set = (patch) => {
    const next = { ...f, ...patch };
    setF(next);
    setPage(1);
    const qs = new URLSearchParams();
    qs.set('show', next.show);
    if (next.day) qs.set('day', next.day);
    if (next.step) qs.set('step', String(next.step));
    window.history.replaceState(null, '', `/emails?${qs}`);
  };

  if (!f) return <p className="muted">Loading…</p>;
  const what = { sent: 'Emails sent', opened: 'Emails opened', clicked: 'Emails with a link clicked' }[f.show];
  return (
    <>
      <style>{css}</style>
      <Link href="/" className="em-back"><LuChevronLeft /> Dashboard</Link>
      <div className="page-title">
        <div>
          <h1>{what}{f.day ? ` · ${dayLabel(f.day)}` : ''}{f.step ? ` · ${stepName(f.step)}` : ''}</h1>
          <p>{d ? `${num(d.total)} ${d.total === 1 ? 'email' : 'emails'}` : 'Loading…'}{f.show !== 'sent' ? ` · sorted by when they were ${f.show}` : ', newest first'}</p>
        </div>
      </div>
      <div className="card">
        <div className="em-bar">
          <div className="tabs">
            {SHOWS.map(([k, l]) => <button key={k} className={f.show === k ? 'on' : ''} onClick={() => set({ show: k })}>{l}</button>)}
          </div>
          <div className="em-filters">
            <label className="em-day">Day<input type="date" value={f.day} onChange={(e) => set({ day: e.target.value })} /></label>
            <label className="em-day">Email
              <select value={f.step} onChange={(e) => set({ step: Number(e.target.value) || '' })}>
                <option value="">All emails</option>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{stepName(n)}</option>)}
              </select>
            </label>
            {(f.day || f.step) && <button className="btn ghost sm" onClick={() => set({ day: '', step: '' })}><LuX /> Clear</button>}
            <label className="em-search"><LuSearch /><input placeholder="Search name, email, company, subject…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
          </div>
        </div>

        {!d ? (
          <p className="muted">Loading…</p>
        ) : d.list.length === 0 ? (
          <p className="empty">No emails here.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="cards">
                <thead><tr><th>Person</th><th>Email</th><th>Campaign</th><th>Sent</th><th>Opened</th><th>Clicked</th></tr></thead>
                <tbody>
                  {d.list.map((e) => (
                    <tr key={e._id}>
                      <td>{e.contact ? <Link href={leadHref(e.contact, 'emails')}><b>{e.contact.name || e.contact.email}</b></Link> : <b>Deleted contact</b>}<small>{[e.contact?.email, e.contact?.company].filter(Boolean).join(' · ')}</small></td>
                      <td data-label="Email"><span className="em-step">{stepName(e.step)}</span><small className="em-subject">{e.subject}</small></td>
                      <td data-label="Campaign">{e.campaign ? <Link href={`/campaigns?open=${e.campaign._id}`}>{campaignName(e.campaign.name)}</Link> : '—'}</td>
                      <td data-label="Sent">{when(e.sentAt)}</td>
                      <td data-label="Opened">{e.openedAt ? <span className="em-yes">{when(e.openedAt)}</span> : <span className="muted">—</span>}</td>
                      <td data-label="Clicked">{e.clickedAt ? <span className="em-yes">{when(e.clickedAt)}</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.pages > 1 && (
              <div className="em-pager">
                <button className="btn ghost sm" disabled={d.page <= 1} onClick={() => setPage(d.page - 1)}><LuChevronLeft /> Previous</button>
                <span>Page {d.page} of {d.pages}</span>
                <button className="btn ghost sm" disabled={d.page >= d.pages} onClick={() => setPage(d.page + 1)}>Next <LuChevronRight /></button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

const css = `
.em-back { display: inline-flex; align-items: center; gap: 4px; color: var(--c-700); font-weight: 600; font-size: 13.5px; margin-bottom: 8px; }
.em-bar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 8px; }
.em-filters { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.em-day { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: #64748b; }
.em-day input, .em-day select { width: auto; min-width: 150px; }
.em-search { position: relative; flex: 1 1 240px; min-width: 200px; margin-left: auto; }
.em-search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #64748b; }
.em-search input { width: 100%; padding-left: 36px; }
.em-step { font-weight: 600; font-size: 13px; }
.em-subject { display: block; color: #64748b; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.em-yes { color: #15803d; font-weight: 600; font-size: 13px; }
.em-pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 14px; font-size: 13.5px; color: #64748b; }
@media (max-width: 700px) { .em-search { margin-left: 0; } .em-subject { max-width: 100%; } }
`;
