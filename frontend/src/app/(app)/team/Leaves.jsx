'use client';
// Leaves (admin): approve / reject requests (days beyond the balance become unpaid), add a leave, see all.
import { useCallback, useEffect, useState } from 'react';
import { LuPlus } from 'react-icons/lu';
import { api, notify } from '@/lib/api';
import { dayLabel, todayStr } from '@/lib/hr';

const span = (l) => (l.from === l.to ? dayLabel(l.from) : `${dayLabel(l.from)} – ${dayLabel(l.to)}`);
const len = (n) => `${n} day${n === 1 ? '' : 's'}`;

export default function Leaves({ team, reloadOverview }) {
  const [status, setStatus] = useState('pending');
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null);
  const [notes, setNotes] = useState({});

  const load = useCallback(() => api('/api/hr/leaves', { query: { status } }).then(setList).catch((e) => notify(e.message, 'error')), [status]);
  useEffect(() => {
    load();
  }, [load]);

  const decide = async (l, approve) => {
    try {
      const r = await api(`/api/hr/leaves/${l._id}/decide`, { method: 'POST', body: { approve, note: notes[l._id] || '' } });
      notify(approve ? (r.unpaidDays ? `Approved: ${r.paidDays} paid, ${r.unpaidDays} unpaid` : 'Approved (paid)') : 'Rejected');
      load();
      reloadOverview();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/hr/leaves', { method: 'POST', body: form });
      notify('Leave added');
      setForm(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <>
      <div className="row hr-between">
        <div className="tabs">
          {['pending', 'approved', 'rejected', 'cancelled', ''].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s || 'All'}</button>)}
        </div>
        <button className="btn" onClick={() => setForm({ user: team?.[0]?._id || '', from: todayStr(), to: todayStr(), half: false, reason: '' })}><LuPlus /> Add leave</button>
      </div>
      <p className="muted small">Paid leave: 0.5 day for every month from the joining date, lapses on 31 December. When you approve, days beyond the balance become unpaid (salary cut). Sundays and holidays are not counted.</p>

      {form && (
        <form className="card hr-grid" onSubmit={add}>
          <label className="field">Employee<select value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })}>{(team || []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></label>
          <label className="field">From<input type="date" required value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value, to: form.to < e.target.value ? e.target.value : form.to })} /></label>
          <label className="field">To<input type="date" required value={form.half ? form.from : form.to} disabled={form.half} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} /></label>
          <label className="field">Half day<select value={form.half ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, half: e.target.value === 'yes', to: form.from })}><option value="no">No</option><option value="yes">Yes</option></select></label>
          <label className="field hr-wide">Reason<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          <div className="row hr-wide"><button className="btn sm">Add (approved)</button><button type="button" className="btn ghost sm" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}

      <div className="card">
        {!list ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="empty">No {status || ''} leave requests.</p> : list.map((l) => (
          <div key={l._id} className="hr-item">
            <div>
              <b>{l.name} · {span(l)} · {l.half ? 'half day' : len(l.days)}</b>
              <small>“{l.reason}”</small>
              {l.status === 'pending' && l.balance && (
                <small>Balance {l.balance.available} day(s) → {Math.min(l.days, l.balance.available)} paid{l.days > l.balance.available ? `, ${l.days - Math.min(l.days, l.balance.available)} unpaid` : ''}</small>
              )}
              {l.status === 'approved' && <small>{l.paidDays} paid{l.unpaidDays ? ` · ${l.unpaidDays} unpaid` : ''}{l.adminNote ? ` · ${l.adminNote}` : ''}</small>}
              {l.status === 'rejected' && l.adminNote && <small>Note: {l.adminNote}</small>}
            </div>
            {l.status === 'pending' ? (
              <div className="row">
                <input className="hr-note" placeholder="Note (optional)" value={notes[l._id] || ''} onChange={(e) => setNotes({ ...notes, [l._id]: e.target.value })} />
                <button className="btn sm" onClick={() => decide(l, true)}>Approve</button>
                <button className="btn ghost sm" onClick={() => decide(l, false)}>Reject</button>
              </div>
            ) : <span className={`badge ${l.status === 'approved' ? 'replied' : l.status === 'rejected' ? 'unsubscribed' : ''}`}>{l.status}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
