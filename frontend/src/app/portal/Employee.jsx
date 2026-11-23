'use client';
// Employee portal (team members): home, tasks, attendance, leaves, weekly report, targets, documents, payslips, profile.
import { useCallback, useEffect, useState } from 'react';
import { LuLock, LuPencil } from 'react-icons/lu';
import DealView from '@/lib/deal';
import { api, date, notify } from '@/lib/api';
import {
  AttachButton, FileList, PayslipView, PhotoPicker, STATUS, addDay, dayLabel, fullDay, hhmm, hours, monthLabel, shiftMonth, thisMonth, time, todayStr,
} from '@/lib/hr';

export const TABS = [['home', 'Home'], ['tasks', 'Tasks'], ['attendance', 'Attendance'], ['leaves', 'Leaves'], ['report', 'Weekly report'], ['targets', 'Targets'], ['documents', 'Documents'], ['payslips', 'Payslips'], ['accounts', 'Accounts'], ['profile', 'Profile']];
const ST = { todo: 'To do', doing: 'Doing', done: 'Done' };
const PRI = { high: 'High', normal: 'Normal', low: 'Low' };
const useLoad = (path, query) => {
  const [data, setData] = useState(null);
  const q = JSON.stringify(query || {});
  const load = useCallback(() => api(path, { query: JSON.parse(q) }).then(setData).catch((e) => notify(e.message, 'error')), [path, q]);
  useEffect(() => {
    load();
  }, [load]);
  return [data, load, setData];
};

/* ---------------- home ---------------- */
export function Home({ go }) {
  const [d, load] = useLoad('/api/me/home');
  const [busy, setBusy] = useState(false);
  const punch = async (what) => {
    setBusy(true);
    try {
      await api(`/api/me/${what}`, { method: 'POST' });
      notify(what === 'check-in' ? 'Checked in ✓' : 'Checked out ✓');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
    setBusy(false);
  };
  if (!d) return <p className="pt-muted">Loading…</p>;
  const a = d.attendance;
  return (
    <>
      <section className="pt-card em-today">
        <h2>Today · {dayLabel(d.today)}</h2>
        <div className="em-punch">
          <div><span>Check-in</span><b>{time(a?.checkIn)}</b></div>
          <div><span>Check-out</span><b>{time(a?.checkOut)}</b></div>
          <div><span>Hours</span><b>{hours(a?.checkIn, a?.checkOut) || '—'}</b></div>
        </div>
        <div className="em-row">
          {!a?.checkIn ? <button className="pt-btn solid" disabled={busy} onClick={() => punch('check-in')}>Check in</button>
            : <button className="pt-btn solid" disabled={busy} onClick={() => punch('check-out')}>{a.checkOut ? 'Check out again (update time)' : 'Check out'}</button>}
          <button className="pt-btn" onClick={() => go('attendance')}>Forgot / wrong time? Ask to fix</button>
        </div>
      </section>
      <div className="em-tiles">
        <button onClick={() => go('tasks')}><b>{d.openTasks}</b><span>Open tasks</span></button>
        <button onClick={() => go('leaves')}><b>{d.balance.available}</b><span>Paid leave left{d.pendingLeaves ? ` · ${d.pendingLeaves} pending` : ''}</span></button>
        <button onClick={() => go('targets')}><b>{d.target ? `${d.target.done}/${d.target.total}` : '—'}</b><span>This month&apos;s target</span></button>
        <button onClick={() => go('report')}><b>{d.reportThisWeek ? '✓' : '!'}</b><span>{d.reportThisWeek ? 'Weekly report sent' : 'Weekly report not sent'}</span></button>
      </div>
    </>
  );
}

/* ---------------- tasks ---------------- */
export function Tasks({ me }) {
  const [list, load] = useLoad('/api/me/tasks');
  const [showDone, setShowDone] = useState(false);
  const [deal, setDeal] = useState(null); // client project opened from a task
  const [comment, setComment] = useState({});
  const setStatus = (t, status) => api(`/api/me/tasks/${t._id}`, { method: 'PUT', body: { status } }).then(() => { notify(status === 'done' ? 'Done ✓' : 'Updated'); load(); }).catch((e) => notify(e.message, 'error'));
  const send = async (t) => {
    const text = (comment[t._id] || '').trim();
    if (!text) return;
    try {
      await api(`/api/me/tasks/${t._id}/comments`, { method: 'POST', body: { text } });
      setComment({ ...comment, [t._id]: '' });
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  if (!list) return <p className="pt-muted">Loading…</p>;
  const shown = list.filter((t) => showDone || t.status !== 'done');
  return (
    <section className="pt-card">
      <div className="em-row em-between">
        <h2>My tasks</h2>
        <label className="pt-check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      {shown.length === 0 && <p className="pt-muted">{list.length ? 'All your tasks are done.' : 'No tasks given to you yet.'}</p>}
      {shown.map((t) => (
        <div key={t._id} className={`em-task ${t.status}`}>
          <div className="em-row em-between">
            <div>
              <b>{t.title}</b>
              <small>{PRI[t.priority]} priority{t.due ? ` · due ${dayLabel(t.due)}` : ''}{t.due && t.due < todayStr() && t.status !== 'done' ? ' · overdue' : ''}</small>
            </div>
            {t.step ? (
              <span className="em-row">
                {t.status !== 'done' && <span className="em-auto">Client task</span>}
                {t.deal && <button className="pt-btn solid" onClick={() => setDeal(t.deal)}>{t.status === 'done' ? 'View deal' : 'Open deal'}</button>}
                {t.status === 'done' && <span className="em-auto done">Done</span>}
              </span>
            ) : (
              <select value={t.status} onChange={(e) => setStatus(t, e.target.value)}>{Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            )}
          </div>
          {t.details && <p className="em-pre">{t.details}</p>}
          {t.comments?.map((c) => <p key={c._id} className="em-comment"><b>{c.author}:</b> {c.text}</p>)}
          <div className="em-row">
            <input className="em-grow" placeholder="Write a comment…" value={comment[t._id] || ''} onChange={(e) => setComment({ ...comment, [t._id]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && send(t)} />
            <button className="pt-btn" onClick={() => send(t)}>Send</button>
          </div>
        </div>
      ))}
      {deal && <DealView id={deal} me={me?._id} onClose={() => { setDeal(null); load(); }} onChanged={load} />}
    </section>
  );
}

/* ---------------- attendance ---------------- */
export function Attendance() {
  const [month, setMonth] = useState(thisMonth());
  const [reg, load] = useLoad('/api/me/attendance', { month });
  const [fix, setFix] = useState(null);
  const ask = async (e) => {
    e.preventDefault();
    try {
      await api('/api/me/attendance/request', { method: 'POST', body: fix });
      notify('Sent to the admin');
      setFix(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  return (
    <section className="pt-card">
      <div className="em-row em-between">
        <div className="em-row">
          <button className="pt-btn" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <h2>{monthLabel(month)}</h2>
          <button className="pt-btn" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>
        <button className="pt-btn" onClick={() => setFix({ day: todayStr(), checkIn: '', checkOut: '', note: '' })}>Ask to fix a time</button>
      </div>
      {fix && (
        <form className="em-form" onSubmit={ask}>
          <label>Day<input type="date" max={todayStr()} required value={fix.day} onChange={(e) => setFix({ ...fix, day: e.target.value })} /></label>
          <label>Check-in<input type="time" required value={fix.checkIn} onChange={(e) => setFix({ ...fix, checkIn: e.target.value })} /></label>
          <label>Check-out<input type="time" value={fix.checkOut} onChange={(e) => setFix({ ...fix, checkOut: e.target.value })} /></label>
          <label className="em-wide">Why?<input required value={fix.note} onChange={(e) => setFix({ ...fix, note: e.target.value })} placeholder="e.g. forgot to check out" /></label>
          <div className="em-row em-wide"><button className="pt-btn solid">Send request</button><button type="button" className="pt-btn" onClick={() => setFix(null)}>Cancel</button></div>
        </form>
      )}
      {!reg ? <p className="pt-muted">Loading…</p> : (
        <>
          <div className="em-sum">
            <span>Present <b>{reg.summary.present}</b></span><span>Paid leave <b>{reg.summary.paidLeave}</b></span>
            <span>Unpaid leave <b>{reg.summary.unpaidLeave}</b></span><span>Absent <b>{reg.summary.absent}</b></span>
          </div>
          <div className="em-table">
            {reg.days.filter((d) => d.day <= todayStr() || d.status === 'leave' || d.status === 'half-leave').reverse().map((d) => {
              const [label, color] = STATUS[d.status] || ['', '#cbd5e1'];
              return (
                <div key={d.day} className="em-dayrow">
                  <span className="em-dot" style={{ background: color }} />
                  <b>{dayLabel(d.day)}</b>
                  <span>{label}{d.holiday ? ` · ${d.holiday}` : ''}{d.leave ? (d.leave.paid ? ' · paid leave' : ' · unpaid leave') : ''}</span>
                  <span className="em-time">
                    {d.checkIn ? `${time(d.checkIn)} – ${d.checkOut ? time(d.checkOut) : 'no check-out'}` : ''}
                    {hours(d.checkIn, d.checkOut) && <i> · {hours(d.checkIn, d.checkOut)}</i>}
                    {d.request && <i> · fix requested</i>}
                  </span>
                  {d.day <= todayStr() && d.status !== 'off' && d.status !== 'holiday' && d.status !== 'before-join' && !d.request
                    ? <button className="em-link" onClick={() => setFix({ day: d.day, checkIn: hhmm(d.checkIn), checkOut: hhmm(d.checkOut), note: '' })}>Fix</button>
                    : <span />}
                </div>
              );
            })}
          </div>
          <p className="pt-muted">A working day without check-in or approved leave counts as absent at the end of the month.</p>
        </>
      )}
    </section>
  );
}

/* ---------------- leaves ---------------- */
export function Leaves() {
  const [d, load] = useLoad('/api/me/leaves');
  const [form, setForm] = useState(null);
  const apply = async (e) => {
    e.preventDefault();
    try {
      await api('/api/me/leaves', { method: 'POST', body: { ...form, to: form.half ? form.from : form.to } });
      notify('Leave request sent');
      setForm(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const cancel = async (l) => {
    if (!window.confirm('Cancel this leave request?')) return;
    api(`/api/me/leaves/${l._id}`, { method: 'DELETE' }).then(load).catch((e) => notify(e.message, 'error'));
  };
  if (!d) return <p className="pt-muted">Loading…</p>;
  const b = d.balance;
  return (
    <>
      <section className="pt-card">
        <div className="em-row em-between">
          <h2>Paid leave {b.year}</h2>
          {!form && <button className="pt-btn solid" onClick={() => setForm({ from: todayStr(), to: todayStr(), half: false, reason: '' })}>Apply for leave</button>}
        </div>
        <div className="em-tiles small">
          <div><b>{b.available}</b><span>Available</span></div>
          <div><b>{b.earned}</b><span>Earned so far</span></div>
          <div><b>{b.used}</b><span>Used</span></div>
          <div><b>{b.pending}</b><span>Waiting for approval</span></div>
        </div>
        <p className="pt-muted">You earn 0.5 paid leave every month. Unused leave lapses on 31 December. Leave beyond your balance is unpaid.</p>
        {form && (
          <form className="em-form" onSubmit={apply}>
            <label>From<input type="date" required value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value, to: form.to < e.target.value ? e.target.value : form.to })} /></label>
            <label>To<input type="date" required disabled={form.half} min={form.from} value={form.half ? form.from : form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></label>
            <label>Half day<select value={form.half ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, half: e.target.value === 'yes' })}><option value="no">No</option><option value="yes">Yes</option></select></label>
            <label className="em-wide">Reason<input required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
            <div className="em-row em-wide"><button className="pt-btn solid">Send request</button><button type="button" className="pt-btn" onClick={() => setForm(null)}>Cancel</button></div>
          </form>
        )}
      </section>
      <section className="pt-card">
        <h2>My leave requests</h2>
        {d.list.length === 0 && <p className="pt-muted">No leave requests yet.</p>}
        {d.list.map((l) => (
          <div key={l._id} className="em-task">
            <div className="em-row em-between">
              <div>
                <b>{l.from === l.to ? dayLabel(l.from) : `${dayLabel(l.from)} – ${dayLabel(l.to)}`} · {l.half ? 'half day' : `${l.days} day${l.days === 1 ? '' : 's'}`}</b>
                <small>{l.reason}{l.status === 'approved' ? ` · ${l.paidDays} paid${l.unpaidDays ? `, ${l.unpaidDays} unpaid` : ''}` : ''}{l.adminNote ? ` · Admin: ${l.adminNote}` : ''}</small>
              </div>
              <div className="em-row">
                <span className={`em-badge ${l.status}`}>{l.status}</span>
                {l.status === 'pending' && <button className="em-link" onClick={() => cancel(l)}>Cancel</button>}
              </div>
            </div>
          </div>
        ))}
      </section>
      <section className="pt-card">
        <h2>Holidays {b.year}</h2>
        {d.holidays.length === 0 && <p className="pt-muted">The holiday list has not been added yet.</p>}
        {d.holidays.map((h) => <div key={h.day} className="em-hist"><b>{dayLabel(h.day)}</b><span>{h.name}</span></div>)}
      </section>
    </>
  );
}

/* ---------------- weekly report ---------------- */
export function Report() {
  const [d, load] = useLoad('/api/me/reports');
  const [week, setWeek] = useState(null);
  if (!d) return <p className="pt-muted">Loading…</p>;
  const current = week || d.week;
  const existing = d.list.find((r) => r.week === current);
  return (
    <>
      <section className="pt-card">
        <div className="em-row em-between">
          <div className="em-row">
            <button className="pt-btn" onClick={() => setWeek(addDay(current, -7))}>‹</button>
            <h2>Week of {fullDay(current)}</h2>
            <button className="pt-btn" disabled={current >= d.week} onClick={() => setWeek(addDay(current, 7))}>›</button>
          </div>
          {existing && <span className="em-badge approved">Sent {date(existing.updatedAt)}</span>}
        </div>
        <ReportForm key={`${current}-${existing?.updatedAt || ''}`} week={current} existing={existing} onSaved={load} />
        {existing?.adminNote && <p className="em-comment"><b>Admin:</b> {existing.adminNote}</p>}
      </section>
      <section className="pt-card">
        <h2>Earlier reports</h2>
        {d.list.length === 0 && <p className="pt-muted">No reports yet.</p>}
        {d.list.map((r) => (
          <button key={r._id} className="em-listbtn" onClick={() => setWeek(r.week)}>
            <b>Week of {fullDay(r.week)}</b><span className="pt-muted">{r.files.length ? `${r.files.length} file(s)` : ''} {r.adminNote ? '· admin note' : ''}</span>
          </button>
        ))}
      </section>
    </>
  );
}

function ReportForm({ week, existing, onSaved }) {
  const [draft, setDraft] = useState({ text: existing?.text || '', files: existing?.files || [] });
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/me/reports/${week}`, { method: 'PUT', body: { text: draft.text, files: draft.files.map((f) => f.id) } });
      notify('Report saved');
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  return (
    <form onSubmit={save} className="em-col">
      <textarea rows={8} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder={'What did you do this week?\nWhat is pending or blocked?\nPlan for next week?'} />
      <div className="em-row"><FileList files={draft.files} onRemove={(i) => setDraft({ ...draft, files: draft.files.filter((_, j) => j !== i) })} /><AttachButton className="pt-btn" label="Attach report file" onAdd={(f) => setDraft({ ...draft, files: [...draft.files, ...f] })} /></div>
      <div className="em-row"><button className="pt-btn solid">{existing ? 'Update report' : 'Send report'}</button></div>
    </form>
  );
}

/* ---------------- targets ---------------- */
export function Targets() {
  const [list, load] = useLoad('/api/me/targets');
  const tick = (t, i) => api(`/api/me/targets/${t._id}/items/${i._id}`, { method: 'PUT', body: { done: !i.done } }).then(load).catch((e) => notify(e.message, 'error'));
  const attach = (t, files) => api(`/api/me/targets/${t._id}/files`, { method: 'POST', body: { files: files.map((f) => f.id) } }).then(() => { notify('File added'); load(); }).catch((e) => notify(e.message, 'error'));
  if (!list) return <p className="pt-muted">Loading…</p>;
  if (!list.length) return <section className="pt-card pt-empty">No targets set for you yet.</section>;
  return list.map((t) => {
    const done = t.items.filter((i) => i.done).length;
    const pct = t.items.length ? Math.round((done / t.items.length) * 100) : 0;
    return (
      <section key={t._id} className="pt-card">
        <h2>{monthLabel(t.month)}{t.title ? ` · ${t.title}` : ''}</h2>
        <div className="pt-progress"><div><b>{pct}%</b><span>{done} of {t.items.length} done · {t.items.length - done} left</span></div><div className="pt-bar"><span style={{ width: `${pct}%` }} /></div></div>
        {t.items.map((i) => (
          <label key={i._id} className={`pt-task ${i.done ? 'done' : ''}`}>
            <input type="checkbox" checked={i.done} onChange={() => tick(t, i)} disabled={t.month < thisMonth()} />
            <span><b>{i.text}</b>{i.doneAt && <small>Done {date(i.doneAt)}</small>}</span>
          </label>
        ))}
        {t.note && <p className="em-pre">{t.note}</p>}
        <div className="em-row"><FileList files={t.files} />{t.month >= thisMonth() && <AttachButton className="pt-btn" label="Attach proof / file" onAdd={(f) => attach(t, f)} />}</div>
      </section>
    );
  });
}

/* ---------------- documents ---------------- */
export function Documents() {
  const [list, load] = useLoad('/api/me/documents');
  const [form, setForm] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/api/me/documents', { method: 'POST', body: { name: form.name, category: form.category, file: form.file?.id, link: form.link } });
      notify('Document saved');
      setForm(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  return (
    <section className="pt-card">
      <div className="em-row em-between">
        <h2>My documents</h2>
        {!form && <button className="pt-btn solid" onClick={() => setForm({ name: '', category: 'ID proof', link: '', file: null })}>Add document</button>}
      </div>
      {form && (
        <form className="em-form" onSubmit={save}>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="PAN card" /></label>
          <label>Type<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{['ID proof', 'Address proof', 'PAN card', 'Certificate', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="em-wide">Google Drive / other link<input disabled={Boolean(form.file)} value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://drive.google.com/…" /></label>
          <div className="em-row em-wide">{form.file ? <FileList files={[form.file]} onRemove={() => setForm({ ...form, file: null })} /> : <AttachButton className="pt-btn" multiple={false} label="Or upload a file" onAdd={([f]) => setForm({ ...form, file: f, link: '' })} />}</div>
          <div className="em-row em-wide"><button className="pt-btn solid">Save</button><button type="button" className="pt-btn" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      {!list ? <p className="pt-muted">Loading…</p> : list.length === 0 ? <p className="pt-muted">No documents yet.</p> : list.map((d) => (
        <div key={d._id} className="em-task">
          <div className="em-row em-between">
            <div><b>{d.name}</b><small>{d.category} · added by {d.uploadedBy} · {date(d.createdAt)}</small></div>
            {d.file?.id ? <FileList files={[d.file]} /> : <a className="em-link" href={d.link} target="_blank" rel="noopener noreferrer">Open link</a>}
          </div>
        </div>
      ))}
    </section>
  );
}

/* ---------------- payslips ---------------- */
export function Payslips() {
  const [d] = useLoad('/api/me/payslips');
  const [view, setView] = useState(null);
  if (!d) return <p className="pt-muted">Loading…</p>;
  return (
    <section className="pt-card">
      <h2>My salary slips</h2>
      {d.list.length === 0 && <p className="pt-muted">No salary slips yet.</p>}
      {d.list.map((s) => (
        <button key={s._id} className="em-listbtn" onClick={() => setView(s)}>
          <b>{monthLabel(s.month)}</b><span>Net ₹{new Intl.NumberFormat('en-IN').format(s.net)} · {s.status === 'paid' ? `paid ${fullDay(s.paidOn)}` : 'ready'}</span>
        </button>
      ))}
      {view && <PayslipView slip={view} company={d.company} onClose={() => setView(null)} />}
    </section>
  );
}

/* ---------------- profile + password ---------------- */
// Employees edit only their personal details and photo. Job, salary, bank and ID details are kept by the admin.
const SELF = [
  ['phone', 'Phone', 'tel'],
  ['personalEmail', 'Personal email', 'email'],
  ['dob', 'Date of birth', 'date'],
  ['gender', 'Gender', 'select'],
  ['emergencyName', 'Emergency contact name', 'text'],
  ['emergencyPhone', 'Emergency contact phone', 'tel'],
  ['address', 'Address', 'textarea'],
];
export function Profile({ onPhoto }) {
  const [p, , setP] = useLoad('/api/me/profile');
  const [edit, setEdit] = useState(null); // form values while editing
  const [busy, setBusy] = useState(false);
  if (!p) return <p className="pt-muted">Loading…</p>;
  const e = p.employee || {};
  const savePhoto = async (photo) => {
    const out = await api('/api/me/profile', { method: 'PUT', body: { photo } });
    setP(out);
    onPhoto?.(out.photo);
  };
  const start = () => setEdit(Object.fromEntries(SELF.map(([k]) => [k, e[k] || ''])));
  const save = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    try {
      setP(await api('/api/me/profile', { method: 'PUT', body: edit }));
      setEdit(null);
      notify('Profile updated ✓');
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };
  const job = [['Employee ID', e.code], ['Designation', p.title], ['Department', e.department], ['Email (login)', p.email], ['Joining date', e.joiningDate && fullDay(e.joiningDate)], ['PAN', e.pan], ['Bank', [e.bankName, e.bankAccount, e.ifsc].filter(Boolean).join(' · ')]];
  const personal = [['Phone', e.phone], ['Personal email', e.personalEmail], ['Date of birth', e.dob && fullDay(e.dob)], ['Gender', e.gender], ['Emergency contact', [e.emergencyName, e.emergencyPhone].filter(Boolean).join(' · ')], ['Address', e.address]];
  const today = todayStr();
  return (
    <>
      <section className="pt-card em-hero">
        <PhotoPicker name={p.name} photo={p.photo} onSave={savePhoto} size={88} />
        <div className="em-heroname"><b>{p.name}</b><span>{[p.title, e.department].filter(Boolean).join(' · ') || p.email}</span></div>
      </section>

      <section className="pt-card">
        <div className="em-row em-between">
          <h2>Personal details</h2>
          {!edit && <button className="pt-btn" onClick={start}><LuPencil /> Edit</button>}
        </div>
        {!edit && <dl className="em-dl">{personal.map(([k, v]) => <div key={k} className="em-pair"><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl>}
        {edit && (
          <form className="em-form" onSubmit={save}>
            {SELF.map(([k, label, type]) => (
              <label key={k} className={type === 'textarea' ? 'em-wide' : ''}>
                {label}
                {type === 'textarea' ? (
                  <textarea rows={3} maxLength={1000} value={edit[k]} onChange={(x) => setEdit({ ...edit, [k]: x.target.value })} />
                ) : type === 'select' ? (
                  <select value={edit[k]} onChange={(x) => setEdit({ ...edit, [k]: x.target.value })}>
                    <option value="">—</option>
                    {['Male', 'Female', 'Other', 'Prefer not to say'].map((g) => <option key={g}>{g}</option>)}
                  </select>
                ) : (
                  <input type={type} max={type === 'date' ? today : undefined} maxLength={150} value={edit[k]} onChange={(x) => setEdit({ ...edit, [k]: x.target.value })} />
                )}
              </label>
            ))}
            <div className="em-row em-wide">
              <button className="pt-btn solid" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className="pt-btn" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      <section className="pt-card">
        <div className="em-row em-between">
          <h2>Job &amp; bank details</h2>
          <span className="em-lock"><LuLock /> Managed by admin</span>
        </div>
        <dl className="em-dl">{job.map(([k, v]) => <div key={k} className="em-pair"><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl>
        <p className="pt-muted">Something wrong here? Ask the admin to update it.</p>
      </section>
      <section className="pt-card">
        <h2>Job history</h2>
        {(p.history || []).length === 0 && <p className="pt-muted">Nothing yet.</p>}
        {[...(p.history || [])].reverse().map((h, i) => <div key={i} className="em-hist"><b>{fullDay(h.date)}</b><span>{h.text}</span></div>)}
      </section>
      <section className="pt-card">
        <h2>Change password</h2>
        <PasswordForm />
      </section>
    </>
  );
}

export function PasswordForm({ first, onDone }) {
  const [f, setF] = useState({ current: '', password: '', again: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (f.password !== f.again) return notify('The two new passwords are not the same', 'error');
    setBusy(true);
    try {
      await api('/api/auth/password', { method: 'POST', body: { current: f.current, password: f.password } });
      notify('Password changed ✓');
      setF({ current: '', password: '', again: '' });
      onDone?.();
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <form className="em-col" onSubmit={save}>
      <label className="em-label">{first ? 'Password the admin gave you' : 'Current password'}<input type="password" required autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
      <label className="em-label">New password (at least 8 characters)<input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      <label className="em-label">New password again<input type="password" required minLength={8} autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></label>
      <div className="em-row"><button className="pt-btn solid" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button></div>
    </form>
  );
}

export const emCss = `
.em-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 4px; border-radius: 14px; background: rgba(255,255,255,.7); border: 1px solid rgba(50,193,223,.18); }
.em-tabs button { background: none; border: 0; border-radius: 11px; padding: 8px 13px; font: inherit; font-size: 14px; font-weight: 600; color: #64748b; cursor: pointer; white-space: nowrap; }
.em-tabs button.on { background: #fff; color: #0b87a5; box-shadow: 0 2px 10px rgba(50,193,223,.18); }
.em-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.em-between { justify-content: space-between; }
.em-col { display: flex; flex-direction: column; gap: 10px; }
.em-grow { flex: 1; min-width: 160px; }
.pt-btn.solid { background: linear-gradient(150deg, #4fcde7, #1aa9c8); color: #fff; border-color: transparent; }
.pt-btn.solid:hover { filter: brightness(.96); background: linear-gradient(150deg, #4fcde7, #1aa9c8); }
.pt .em-col textarea, .pt input, .pt select { font: inherit; font-size: 14px; padding: 9px 11px; border-radius: 11px; border: 1px solid rgba(148,163,184,.35); background: #fff; color: inherit; }
.em-punch { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.em-punch div { background: #fff; border-radius: 14px; padding: 12px 14px; border: 1px solid rgba(148,163,184,.2); display: flex; flex-direction: column; }
.em-punch span { font-size: 12px; color: #64748b; }
.em-punch b { font-size: 22px; color: #0b87a5; }
.em-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.em-tiles > * { background: rgba(255,255,255,.8); border: 1px solid rgba(255,255,255,.9); box-shadow: 0 10px 30px rgba(30,41,99,.06); border-radius: 18px; padding: 14px; text-align: left; font: inherit; color: inherit; display: flex; flex-direction: column; gap: 2px; }
.em-tiles button { cursor: pointer; }
.em-tiles.small > * { box-shadow: none; background: #fff; border-color: rgba(148,163,184,.2); }
.em-tiles b { font-size: 24px; color: #0b87a5; }
.em-tiles span { font-size: 12.5px; color: #64748b; }
.em-task { padding: 12px 14px; border-radius: 14px; background: #fff; border: 1px solid rgba(148,163,184,.2); display: flex; flex-direction: column; gap: 6px; }
.em-task small { display: block; color: #64748b; font-size: 12px; }
.em-task.done > div:first-child b { text-decoration: line-through; color: #64748b; }
.em-pre { white-space: pre-wrap; font-size: 13.5px; color: #334155; }
.em-comment { font-size: 13px; background: #f8fafc; border-radius: 10px; padding: 6px 10px; }
.em-form { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; background: #f8fafc; padding: 12px; border-radius: 14px; }
.em-form label, .em-label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 600; color: #3a5560; }
.em-wide { grid-column: 1 / -1; }
.em-auto { font-size: 11.5px; font-weight: 700; color: #0b87a5; background: #e0f7fc; border-radius: 99px; padding: 3px 9px; }
.em-auto.done { color: #15803d; background: #dcfce7; }
.em-hero { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; justify-content: space-between; flex-direction: row-reverse; }
.em-heroname { display: flex; flex-direction: column; gap: 2px; margin-right: auto; }
.em-heroname b { font-size: 20px; color: #0f2a33; }
.em-heroname span { font-size: 13.5px; color: #64748b; }
.em-lock { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: #64748b; background: #f1f5f9; border-radius: 999px; padding: 4px 10px; }
.em-sum { display: flex; gap: 16px; flex-wrap: wrap; font-size: 14px; color: #475569; }
.em-sum b { color: #0b87a5; }
.em-table { display: flex; flex-direction: column; }
.em-dayrow { display: grid; grid-template-columns: 14px 120px 1fr 240px 44px; gap: 10px; align-items: center; padding: 8px 4px; border-bottom: 1px solid rgba(148,163,184,.15); font-size: 13.5px; }
.em-hist { display: grid; grid-template-columns: 130px 1fr; gap: 10px; padding: 8px 4px; border-bottom: 1px solid rgba(148,163,184,.15); font-size: 13.5px; }
.em-time i { font-style: normal; color: #94a3b8; }
.em-dot { width: 10px; height: 10px; border-radius: 50%; }
.em-link { background: none; border: 0; color: #0b87a5; font-weight: 600; cursor: pointer; font: inherit; font-size: 13px; padding: 0; }
.em-badge { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 99px; background: #f1f5f9; color: #475569; text-transform: capitalize; }
.em-badge.approved { background: #dcfce7; color: #15803d; }
.em-badge.pending { background: #fef9c3; color: #a16207; }
.em-badge.rejected { background: #ffe4e6; color: #be123c; }
.em-listbtn { display: flex; justify-content: space-between; gap: 10px; padding: 11px 14px; border-radius: 14px; background: #fff; border: 1px solid rgba(148,163,184,.2); font: inherit; color: inherit; cursor: pointer; text-align: left; }
.em-listbtn:hover { border-color: rgba(50,193,223,.4); }
.em-dl { display: grid; grid-template-columns: 170px 1fr; gap: 8px 12px; font-size: 14px; }
.em-pair { display: contents; }
.em-dl dt { color: #64748b; }
.em-dl dd { white-space: pre-wrap; word-break: break-word; }
@media (max-width: 700px) {
  .em-tiles, .em-punch { grid-template-columns: 1fr 1fr; }
  .em-form, .em-dl { grid-template-columns: 1fr; }
  .em-dayrow { grid-template-columns: 14px 1fr auto; row-gap: 2px; }
  .em-dayrow > span:nth-child(3) { text-align: right; color: #475569; }
  .em-dayrow > .em-time { grid-column: 2; font-size: 12.5px; color: #64748b; }
  .em-dayrow > .em-time:empty { display: none; }
  .em-dayrow > :last-child { grid-column: 3; justify-self: end; }
}
`;
