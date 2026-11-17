'use client';
// Deals (admin): every client project after it became an account, who has it now, the money position,
// all open client tasks with Reassign, and the step owners (who gets each step's task) with the days allowed.
import { useCallback, useEffect, useState } from 'react';
import { api, notify } from '@/lib/api';
import { fullDay, rupees, todayStr } from '@/lib/hr';
import DealView from '@/lib/deal';

const TABS = [['deals', 'Deals'], ['tasks', 'Client tasks'], ['owners', 'Step owners']];

export default function DealsPage() {
  const [tab, setTab] = useState('deals');
  const [show, setShow] = useState('open');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('open')));
  const load = useCallback(() => api('/api/deals', { query: { show } }).then(setData).catch((e) => notify(e.message, 'error')), [show]);
  useEffect(() => {
    load();
  }, [load]);
  const close = () => {
    setOpen(null);
    window.history.replaceState(null, '', '/deals');
    load();
  };
  const list = data?.list || [];
  const late = list.filter((d) => d.owner?.due && d.owner.due < todayStr()).length;
  const due = list.reduce((n, d) => n + d.due, 0);

  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Deals</h1>
          <p>Every account&apos;s work, step by step: estimate → PO → advance → execution → report → full payment → case study → posts. Each step goes to its owner&apos;s task list on its own.</p>
        </div>
      </div>
      <div className="dl-top">
        <div><b>{list.filter((d) => d.step !== 'complete').length}</b><span>Open deals</span></div>
        <div className={late ? 'late' : ''}><b>{late}</b><span>Late steps</span></div>
        <div><b>{rupees(due)}</b><span>Balance to receive</span></div>
      </div>
      <div className="tabs">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'deals' && (
        <div className="card">
          <div className="tabs">
            {[['open', 'Open'], ['complete', 'Complete'], ['all', 'All']].map(([k, l]) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l}</button>)}
          </div>
          {!data ? <p className="muted">Loading…</p> : list.length === 0 ? (
            <p className="empty">No deals yet. A deal starts when you convert an Opportunity to an account (Pipeline → Convert).</p>
          ) : (
            <div className="table-wrap">
              <table className="cards">
                <thead><tr><th>Company</th><th>Step</th><th>With</th><th>Due</th><th>Value</th><th>Received</th><th>Balance</th></tr></thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d._id}>
                      <td><button className="hr-link" onClick={() => setOpen(d._id)}><b>{d.companyName}</b></button></td>
                      <td data-label="Step"><span className={`badge ${d.step === 'complete' ? 'replied' : 'active'}`}>{d.stepLabel}</span></td>
                      <td data-label="With">{d.owner?.name || (d.step === 'complete' ? '—' : <span className="dl-warn">No owner</span>)}</td>
                      <td data-label="Due" className={d.owner?.due && d.owner.due < todayStr() ? 'dl-late' : ''}>{d.owner?.due ? fullDay(d.owner.due) : '—'}</td>
                      <td data-label="Value">{rupees(d.value)}</td>
                      <td data-label="Received">{rupees(d.received)}</td>
                      <td data-label="Balance">{rupees(d.due)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {tab === 'tasks' && <ClientTasks onOpen={setOpen} />}
      {tab === 'owners' && <Owners />}
      {open && <DealView id={open} isAdmin onClose={close} onChanged={load} />}
    </>
  );
}

function ClientTasks({ onOpen }) {
  const [list, setList] = useState(null);
  const [team, setTeam] = useState([]);
  const load = useCallback(() => {
    api('/api/deals/tasks').then(setList).catch((e) => notify(e.message, 'error'));
    api('/api/deals/owners').then((r) => setTeam(r.team)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const move = async (t, user) => {
    if (!user || user === String(t.user)) return;
    try {
      await api(`/api/deals/tasks/${t._id}/reassign`, { method: 'POST', body: { user } });
      notify('Task reassigned');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  return (
    <div className="card">
      <p className="muted small">Every open client task the CRM has given out. Change the person to hand a task over (for example when someone is on leave).</p>
      {!list ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="empty">No open client tasks.</p> : (
        <div className="table-wrap">
          <table className="cards">
            <thead><tr><th>Task</th><th>Due</th><th>Assigned to</th><th></th></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t._id}>
                  <td><b>{t.title}</b></td>
                  <td data-label="Due" className={t.due < todayStr() ? 'dl-late' : ''}>{fullDay(t.due)}</td>
                  <td data-label="Assigned to">
                    <select value={String(t.user)} onChange={(e) => move(t, e.target.value)}>
                      {!team.some((m) => String(m._id) === String(t.user)) && <option value={String(t.user)}>{t.name}</option>}
                      {team.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
                    </select>
                  </td>
                  <td>{t.deal && <button className="btn ghost sm" onClick={() => onOpen(t.deal)}>Open deal</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Owners() {
  const [r, setR] = useState(null);
  const [f, setF] = useState(null);
  useEffect(() => {
    api('/api/deals/owners')
      .then((x) => {
        setR(x);
        setF({ owners: Object.fromEntries(x.steps.map((s) => [s.key, x.owners[s.key]?._id || ''])), days: { ...x.days } });
      })
      .catch((e) => notify(e.message, 'error'));
  }, []);
  if (!r || !f) return <p className="muted">Loading…</p>;
  const save = async (e) => {
    e.preventDefault();
    try {
      const out = await api('/api/deals/owners', { method: 'PUT', body: f });
      setR({ ...r, owners: out.owners, days: out.days });
      notify('Saved – new tasks go to these people');
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  return (
    <form className="card" onSubmit={save}>
      <p className="muted small">Who gets the task of each step, and how many days they have. Changing a person here applies to new tasks; to move a task that is already open, use Client tasks.</p>
      {r.team.length === 0 && <p className="empty">Add employees first (Employees → Add employee).</p>}
      <div className="dl-owners">
        {r.steps.map((s) => (
          <div key={s.key} className="dl-owner">
            <b>{s.label}{s.sales ? <small> · sales</small> : null}</b>
            <select value={f.owners[s.key]} onChange={(e) => setF({ ...f, owners: { ...f.owners, [s.key]: e.target.value } })}>
              <option value="">— Nobody —</option>
              {r.team.map((m) => <option key={m._id} value={m._id}>{m.name}{m.title ? ` (${m.title})` : ''}</option>)}
            </select>
            <label className="dl-days"><input type="number" min="1" max="90" value={f.days[s.key]} onChange={(e) => setF({ ...f, days: { ...f.days, [s.key]: e.target.value } })} /> days</label>
          </div>
        ))}
      </div>
      <div className="row"><button className="btn">Save step owners</button></div>
    </form>
  );
}

const css = `
.dl-top { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px; }
.dl-top > div { background: rgba(255,255,255,.8); border: 1px solid rgba(255,255,255,.9); box-shadow: 0 10px 30px rgba(30,41,99,.06); border-radius: 18px; padding: 14px 16px; display: flex; flex-direction: column; }
.dl-top b { font-size: 24px; color: #0b87a5; }
.dl-top span { font-size: 12.5px; color: #64748b; }
.dl-top .late b { color: #dc2626; }
.dl-late { color: #dc2626; font-weight: 600; }
.dl-warn { color: #b45309; font-weight: 600; }
.dl-owners { display: flex; flex-direction: column; gap: 8px; margin: 10px 0 14px; }
.dl-owner { display: grid; grid-template-columns: 1fr 240px 110px; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px dashed rgba(148,163,184,.3); }
.dl-owner small { color: #64748b; font-weight: 500; }
.dl-owner select, .dl-days input { font: inherit; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(148,163,184,.4); background: #fff; }
.dl-days { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #64748b; }
.dl-days input { width: 64px; }
.hr-link { border: 0; background: none; padding: 0; font: inherit; color: #0b87a5; cursor: pointer; text-align: left; }
@media (max-width: 700px) {
  .dl-top { grid-template-columns: 1fr 1fr; }
  .dl-top b { font-size: 19px; }
  .dl-owner { grid-template-columns: 1fr 1fr; }
  .dl-owner b { grid-column: 1 / -1; }
}
`;
