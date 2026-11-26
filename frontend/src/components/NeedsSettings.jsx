'use client';
// Settings → Needs you: the saved follow-up messages, the default months, and the calendars.
import { useCallback, useEffect, useState } from 'react';
import { LuPlus, LuRefreshCw, LuTrash2 } from 'react-icons/lu';
import { api, date, notify } from '@/lib/api';

export default function NeedsSettings() {
  const [s, setS] = useState(null);
  const [draft, setDraft] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const load = useCallback(() => {
    api('/api/actions/settings')
      .then((r) => {
        setS(r);
        setDraft({ templates: r.templates.map((t) => ({ ...t })), laterMonths: r.laterMonths, winbackMonths: r.winbackMonths });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (!s || !draft) return null;
  const setT = (i, patch) => setDraft({ ...draft, templates: draft.templates.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const save = async () => {
    try {
      await api('/api/actions/settings', { method: 'PUT', body: draft });
      notify('Saved');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api('/api/actions/calendar/sync', { method: 'POST' });
      notify(`Calendar read: ${r.events} meetings in the next 60 days, ${r.matched} with leads${r.errors?.length ? ` · ${r.errors.length} error(s)` : ''}`);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
    setSyncing(false);
  };
  const last = s.calendarLastSync;
  return (
    <div className="card ns">
      <style>{css}</style>
      <h2>Needs you: follow-up messages</h2>
      <p className="muted small">Chosen when you decide a follow-up. {'{{firstName}}'} and {'{{company}}'} are filled in. The signature is added.</p>
      {draft.templates.map((t, i) => (
        <div key={t.key || i} className="ns-tpl">
          <div className="ns-row">
            <input value={t.name} maxLength={60} placeholder="Name" onChange={(e) => setT(i, { name: e.target.value })} />
            <button className="btn ghost sm" disabled={draft.templates.length === 1} onClick={() => setDraft({ ...draft, templates: draft.templates.filter((_, j) => j !== i) })} title="Remove"><LuTrash2 /></button>
          </div>
          <textarea rows={5} value={t.body} onChange={(e) => setT(i, { body: e.target.value })} />
        </div>
      ))}
      <button className="btn ghost sm" onClick={() => setDraft({ ...draft, templates: [...draft.templates, { key: '', name: '', body: 'Hi {{firstName}},\n\n' }] })}><LuPlus /> Add a message</button>
      <div className="ns-row ns-months">
        <label>&quot;Later&quot; with no date = <input type="number" min={1} max={24} value={draft.laterMonths} onChange={(e) => setDraft({ ...draft, laterMonths: e.target.value })} /> months</label>
        <label>Win-back after <input type="number" min={1} max={24} value={draft.winbackMonths} onChange={(e) => setDraft({ ...draft, winbackMonths: e.target.value })} /> months</label>
      </div>
      <button className="btn sm" onClick={save}>Save</button>

      <h3>Calendars</h3>
      {s.calendars ? (
        <>
          <p className="small">{s.calendars} calendar{s.calendars === 1 ? '' : 's'} connected. Read every 30 minutes; meetings with leads show up in Needs you.</p>
          {last && <p className="muted small">Last read {date(last.at)} · {last.events} meetings · {last.matched} new or changed with leads{last.errors?.length ? ` · ${last.errors.join('; ')}` : ''}</p>}
          <button className="btn ghost sm" disabled={syncing} onClick={sync}><LuRefreshCw /> {syncing ? 'Reading…' : 'Read now'}</button>
        </>
      ) : (
        <p className="muted small">Not connected. In Google Calendar → Settings → the calendar → Integrate calendar, copy the <b>Secret address in iCal format</b> and add it to the server .env as <code>CALENDAR_ICS_URLS=</code> (several links: separate with commas). Then restart the backend.</p>
      )}
    </div>
  );
}

const css = `
.ns { display: flex; flex-direction: column; gap: 10px; }
.ns-tpl { display: flex; flex-direction: column; gap: 6px; border: 1px solid #eef2f6; border-radius: 12px; padding: 10px; }
.ns-tpl textarea { width: 100%; font: inherit; font-size: 13px; }
.ns-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ns-row input:not([type=number]) { flex: 1; min-width: 0; font-weight: 600; }
.ns-months label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.ns-months input { width: 64px; }
.ns h3 { margin: 10px 0 0; }
`;
