'use client';
// Attendance (admin): month register for everyone, fix-time requests, edit any day.
import { useCallback, useEffect, useState } from 'react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import { api, notify } from '@/lib/api';
import { STATUS, dayLabel, hhmm, hours, monthLabel, shiftMonth, thisMonth, time } from '@/lib/hr';

export default function Attendance({ reloadOverview }) {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [requests, setRequests] = useState([]);
  const [edit, setEdit] = useState(null); // { user, name, day, checkIn, checkOut, note }
  const [person, setPerson] = useState('');

  const load = useCallback(() => {
    api('/api/hr/attendance', { query: { month } }).then(setData).catch((e) => notify(e.message, 'error'));
    api('/api/hr/attendance/requests').then(setRequests).catch(() => {});
  }, [month]);
  useEffect(() => {
    load();
  }, [load]);

  const decide = async (r, approve) => {
    try {
      await api(`/api/hr/attendance/${r._id}/decide`, { method: 'POST', body: { approve } });
      notify(approve ? 'Time fixed' : 'Request rejected');
      load();
      reloadOverview();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const saveEdit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/hr/attendance', { method: 'PUT', body: { user: edit.user, day: edit.day, checkIn: edit.checkIn, checkOut: edit.checkOut, note: edit.note } });
      notify('Saved');
      setEdit(null);
      load();
      reloadOverview();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const people = (data?.people || []).filter((p) => !person || String(p._id) === person);
  return (
    <>
      {requests.length > 0 && (
        <div className="card">
          <h2>Time fix requests ({requests.length})</h2>
          {requests.map((r) => (
            <div key={r._id} className="hr-item">
              <div>
                <b>{r.name} · {dayLabel(r.day)}</b>
                <small>Asks for in {time(r.request.checkIn)}{r.request.checkOut ? `, out ${time(r.request.checkOut)}` : ''}{r.checkIn ? ` (now: in ${time(r.checkIn)}${r.checkOut ? `, out ${time(r.checkOut)}` : ''})` : ' (no check-in that day)'}</small>
                <small>“{r.request.note}”</small>
              </div>
              <div className="row"><button className="btn sm" onClick={() => decide(r, true)}>Approve</button><button className="btn ghost sm" onClick={() => decide(r, false)}>Reject</button></div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="row hr-between">
          <div className="row">
            <button className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, -1))}><LuChevronLeft /></button>
            <b>{monthLabel(month)}</b>
            <button className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()}><LuChevronRight /></button>
          </div>
          <select value={person} onChange={(e) => setPerson(e.target.value)} className="hr-select">
            <option value="">Everyone</option>
            {(data?.people || []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
        </div>
        <div className="hr-legend">{Object.entries(STATUS).filter(([, [l]]) => l).map(([k, [l, c]]) => <span key={k}><i style={{ background: c }} />{l}</span>)}</div>
        {!data ? <p className="muted">Loading…</p> : people.length === 0 ? <p className="empty">No active employees.</p> : people.map((p) => (
          <div key={p._id} className="hr-month">
            <div className="row hr-between">
              <b>{p.name}</b>
              <span className="muted small">Present {p.summary.present} · Paid leave {p.summary.paidLeave} · Unpaid leave {p.summary.unpaidLeave} · Absent {p.summary.absent}{p.summary.pendingFix ? ` · ${p.summary.pendingFix} fix request(s)` : ''}</span>
            </div>
            <div className="hr-days">
              {p.days.map((d) => {
                const [label, color] = STATUS[d.status] || ['', '#cbd5e1'];
                const tip = `${dayLabel(d.day)} · ${label || d.status}${d.holiday ? ` (${d.holiday})` : ''}${d.checkIn ? ` · in ${time(d.checkIn)}` : ''}${d.checkOut ? ` · out ${time(d.checkOut)}` : ''}${d.leave ? (d.leave.paid ? ' · paid leave' : ' · unpaid leave') : ''}${d.note ? ` · ${d.note}` : ''}`;
                return (
                  <button key={d.day} title={tip} className={`hr-day ${d.request ? 'fix' : ''}`} style={{ background: color }}
                    onClick={() => setEdit({ user: p._id, name: p.name, day: d.day, checkIn: hhmm(d.checkIn), checkOut: hhmm(d.checkOut), note: d.note || '', info: tip })}>
                    {+d.day.slice(8)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="muted small">Click a day to set or fix its times. A working day with no check-in and no approved leave counts as absent (unpaid).</p>
      </div>

      {edit && (
        <div className="hr-overlay" onClick={() => setEdit(null)}>
          <form className="hr-modal" onClick={(e) => e.stopPropagation()} onSubmit={saveEdit}>
            <h2>{edit.name} · {dayLabel(edit.day)}</h2>
            <p className="muted small">{edit.info}</p>
            <div className="hr-grid two">
              <label className="field">Check-in<input type="time" value={edit.checkIn} onChange={(e) => setEdit({ ...edit, checkIn: e.target.value })} /></label>
              <label className="field">Check-out<input type="time" value={edit.checkOut} onChange={(e) => setEdit({ ...edit, checkOut: e.target.value })} /></label>
              <label className="field hr-wide">Note<input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="e.g. corrected after call" /></label>
            </div>
            {edit.checkIn && edit.checkOut && <p className="muted small">Hours: {hours(new Date(`2000-01-01T${edit.checkIn}`), new Date(`2000-01-01T${edit.checkOut}`))}</p>}
            <div className="row">
              <button className="btn sm">Save</button>
              <button type="button" className="btn ghost sm" onClick={() => setEdit({ ...edit, checkIn: '', checkOut: '' })}>Clear times (absent)</button>
              <button type="button" className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
