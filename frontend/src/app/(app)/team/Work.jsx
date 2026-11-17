'use client';
// Tasks, weekly reports and monthly targets (admin side).
import { useCallback, useEffect, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuPlus, LuTrash2 } from 'react-icons/lu';
import { api, date, notify } from '@/lib/api';
import { AttachButton, FileList, addDay, dayLabel, fullDay, mondayOf, monthLabel, shiftMonth, thisMonth, todayStr } from '@/lib/hr';

const PRI = { high: 'High', normal: 'Normal', low: 'Low' };
const ST = { todo: 'To do', doing: 'Doing', done: 'Done' };

/* ---------------- tasks ---------------- */
export function Tasks({ team, reloadOverview }) {
  const [filter, setFilter] = useState({ user: '', status: 'open' });
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null);
  const [comment, setComment] = useState({});

  const load = useCallback(() => api('/api/hr/tasks', { query: filter }).then(setList).catch((e) => notify(e.message, 'error')), [filter]);
  useEffect(() => {
    load();
  }, [load]);
  const done = () => { load(); reloadOverview(); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form._id) await api(`/api/hr/tasks/${form._id}`, { method: 'PUT', body: form });
      else await api('/api/hr/tasks', { method: 'POST', body: form });
      notify(form._id ? 'Task saved' : 'Task given');
      setForm(null);
      done();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const setStatus = (t, status) => api(`/api/hr/tasks/${t._id}`, { method: 'PUT', body: { status } }).then(done).catch((e) => notify(e.message, 'error'));
  const remove = async (t) => {
    if (!window.confirm(`Delete the task "${t.title}"?`)) return;
    api(`/api/hr/tasks/${t._id}`, { method: 'DELETE' }).then(done).catch((e) => notify(e.message, 'error'));
  };
  const addComment = async (t) => {
    const text = (comment[t._id] || '').trim();
    if (!text) return;
    try {
      await api(`/api/hr/tasks/${t._id}/comments`, { method: 'POST', body: { text } });
      setComment({ ...comment, [t._id]: '' });
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  return (
    <>
      <div className="row hr-between">
        <div className="row">
          <select className="hr-select" value={filter.user} onChange={(e) => setFilter({ ...filter, user: e.target.value })}>
            <option value="">Everyone</option>
            {(team || []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
          </select>
          <div className="tabs">{[['open', 'Open'], ['done', 'Done'], ['', 'All']].map(([k, l]) => <button key={k} className={filter.status === k ? 'on' : ''} onClick={() => setFilter({ ...filter, status: k })}>{l}</button>)}</div>
        </div>
        <button className="btn" onClick={() => setForm({ user: filter.user || team?.[0]?._id || '', title: '', details: '', due: '', priority: 'normal' })}><LuPlus /> Give a task</button>
      </div>

      {form && (
        <form className="card hr-grid" onSubmit={save}>
          <label className="field">Employee<select value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })}>{(team || []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></label>
          <label className="field">Due date<input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></label>
          <label className="field">Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{Object.entries(PRI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field hr-wide">Task *<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Shortlist 20 creators for Bubz" /></label>
          <label className="field hr-wide">Details<textarea rows={3} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} /></label>
          <div className="row hr-wide"><button className="btn sm">{form._id ? 'Save task' : 'Give task'}</button><button type="button" className="btn ghost sm" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}

      <div className="card">
        {!list ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="empty">No tasks here.</p> : list.map((t) => (
          <div key={t._id} className={`hr-task ${t.status}`}>
            <div className="row hr-between">
              <div>
                <b>{t.title}</b>
                <small>{t.name} · {PRI[t.priority]} priority{t.due ? ` · due ${dayLabel(t.due)}` : ''}{t.due && t.due < todayStr() && t.status !== 'done' ? ' · overdue' : ''}{t.doneAt ? ` · done ${date(t.doneAt)}` : ''}</small>
              </div>
              <div className="row">
                <select className="hr-select sm" value={t.status} onChange={(e) => setStatus(t, e.target.value)}>{Object.entries(ST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <button className="btn ghost sm" onClick={() => setForm({ _id: t._id, user: t.user, title: t.title, details: t.details, due: t.due, priority: t.priority })}>Edit</button>
                <button className="btn ghost sm tm-del" onClick={() => remove(t)}><LuTrash2 /></button>
              </div>
            </div>
            {t.details && <p className="hr-pre">{t.details}</p>}
            {t.comments?.map((c) => <p key={c._id} className="hr-comment"><b>{c.author}:</b> {c.text}</p>)}
            <div className="row hr-commentform">
              <input placeholder="Write a comment…" value={comment[t._id] || ''} onChange={(e) => setComment({ ...comment, [t._id]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addComment(t)} />
              <button className="btn ghost sm" onClick={() => addComment(t)}>Send</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- weekly reports ---------------- */
export function Reports() {
  const [week, setWeek] = useState(mondayOf(todayStr()));
  const [data, setData] = useState(null);
  const [note, setNote] = useState({});
  const load = useCallback(() => api('/api/hr/reports', { query: { week } }).then(setData).catch((e) => notify(e.message, 'error')), [week]);
  useEffect(() => {
    load();
  }, [load]);
  const saveNote = async (r) => {
    try {
      await api(`/api/hr/reports/${r._id}/note`, { method: 'PUT', body: { note: note[r._id] ?? r.adminNote } });
      notify('Note saved');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const sent = (data?.people || []).filter((p) => p.report).length;
  return (
    <div className="card">
      <div className="row hr-between">
        <div className="row">
          <button className="btn ghost sm" onClick={() => setWeek(addDay(week, -7))}><LuChevronLeft /></button>
          <b>Week of {fullDay(week)} – {dayLabel(addDay(week, 6))}</b>
          <button className="btn ghost sm" disabled={week >= mondayOf(todayStr())} onClick={() => setWeek(addDay(week, 7))}><LuChevronRight /></button>
        </div>
        {data && <span className="muted small">{sent} of {data.people.length} sent</span>}
      </div>
      {!data ? <p className="muted">Loading…</p> : data.people.map((p) => (
        <div key={p._id} className="hr-task">
          <div className="row hr-between">
            <b>{p.name}</b>
            {p.report ? <span className="badge replied">Sent {date(p.report.updatedAt)}</span> : <span className="badge unsubscribed">Not sent</span>}
          </div>
          {p.report && (
            <>
              {p.report.text && <p className="hr-pre">{p.report.text}</p>}
              <FileList files={p.report.files} />
              <div className="row hr-commentform">
                <input placeholder="Your note on this report (the employee sees it)" defaultValue={p.report.adminNote} onChange={(e) => setNote({ ...note, [p.report._id]: e.target.value })} />
                <button className="btn ghost sm" onClick={() => saveNote(p.report)}>Save note</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- monthly targets ---------------- */
export function Targets({ team }) {
  const [month, setMonth] = useState(thisMonth());
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null); // { _id?, user, title, items: [{text}], files, note }
  const load = useCallback(() => api('/api/hr/targets', { query: { month } }).then(setList).catch((e) => notify(e.message, 'error')), [month]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    const body = { ...form, month, items: form.items.filter((i) => i.text.trim()), files: form.files.map((f) => f.id) };
    try {
      if (form._id) await api(`/api/hr/targets/${form._id}`, { method: 'PUT', body });
      else await api('/api/hr/targets', { method: 'POST', body });
      notify('Target saved');
      setForm(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete ${t.name}'s target for ${monthLabel(month)}?`)) return;
    api(`/api/hr/targets/${t._id}`, { method: 'DELETE' }).then(load).catch((e) => notify(e.message, 'error'));
  };
  const setItem = (i, text) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, text } : x)) });

  return (
    <>
      <div className="row hr-between">
        <div className="row">
          <button className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, -1))}><LuChevronLeft /></button>
          <b>{monthLabel(month)}</b>
          <button className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, 1))}><LuChevronRight /></button>
        </div>
        <button className="btn" onClick={() => setForm({ user: team?.[0]?._id || '', title: '', items: [{ text: '' }, { text: '' }, { text: '' }], files: [], note: '' })}><LuPlus /> Set a target</button>
      </div>
      <p className="muted small">Write the target as points. The employee ticks each point when it is done; what is not ticked is still pending. You can also attach a target file.</p>

      {form && (
        <form className="card hr-form" onSubmit={save}>
          <div className="hr-grid">
            <label className="field">Employee<select value={form.user} disabled={Boolean(form._id)} onChange={(e) => setForm({ ...form, user: e.target.value, files: [] })}>{(team || []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></label>
            <label className="field hr-wide">Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={`Target for ${monthLabel(month)}`} /></label>
          </div>
          <h3>Points</h3>
          {form.items.map((it, i) => (
            <div key={it._id || i} className="row hr-point">
              <span className="muted small">{i + 1}.</span>
              <input value={it.text} onChange={(e) => setItem(i, e.target.value)} placeholder="e.g. Close 2 new accounts" />
              {it.done && <span className="badge replied">done</span>}
              <button type="button" className="btn ghost sm tm-del" onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}><LuTrash2 /></button>
            </div>
          ))}
          <button type="button" className="btn ghost sm" onClick={() => setForm({ ...form, items: [...form.items, { text: '' }] })}><LuPlus /> Add point</button>
          <label className="field">Note<textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <div className="row"><FileList files={form.files} onRemove={(i) => setForm({ ...form, files: form.files.filter((_, j) => j !== i) })} /><AttachButton className="btn ghost sm" forUser={form.user} label="Attach target file" onAdd={(f) => setForm({ ...form, files: [...form.files, ...f] })} /></div>
          <div className="row"><button className="btn sm">Save target</button><button type="button" className="btn ghost sm" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}

      <div className="card">
        {!list ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="empty">No targets for {monthLabel(month)} yet.</p> : list.map((t) => {
          const doneN = t.items.filter((i) => i.done).length;
          return (
            <div key={t._id} className="hr-task">
              <div className="row hr-between">
                <div><b>{t.name}{t.title ? ` · ${t.title}` : ''}</b><small>{doneN} of {t.items.length} done</small></div>
                <div className="row">
                  <button className="btn ghost sm" onClick={() => setForm({ _id: t._id, user: t.user, title: t.title, items: t.items.map((i) => ({ _id: i._id, text: i.text, done: i.done })), files: t.files || [], note: t.note })}>Edit</button>
                  <button className="btn ghost sm tm-del" onClick={() => remove(t)}><LuTrash2 /></button>
                </div>
              </div>
              <div className="hr-progress"><span style={{ width: `${t.items.length ? Math.round((doneN / t.items.length) * 100) : 0}%` }} /></div>
              {t.items.map((i) => <p key={i._id} className={`hr-check ${i.done ? 'done' : ''}`}>{i.done ? '✅' : '⬜'} {i.text}{i.doneAt ? <small> · {date(i.doneAt)}</small> : null}</p>)}
              {t.note && <p className="hr-pre">{t.note}</p>}
              <FileList files={t.files} />
            </div>
          );
        })}
      </div>
    </>
  );
}
