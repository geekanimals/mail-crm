'use client';
// Employees (HR) - admin side. Tabs: employees, attendance, leaves, tasks, weekly reports, targets, holidays, payroll.
// Employees log in at /login with the email + password made here and use their own portal (/portal).
import { useCallback, useEffect, useState } from 'react';
import { api, notify } from '@/lib/api';
import People from './People';
import Attendance from './Attendance';
import Leaves from './Leaves';
import { Reports, Targets, Tasks } from './Work';
import { Holidays, Payroll } from './Payroll';

const TABS = [['people', 'Employees'], ['attendance', 'Attendance'], ['leaves', 'Leaves'], ['tasks', 'Tasks'], ['reports', 'Weekly reports'], ['targets', 'Targets'], ['holidays', 'Holidays'], ['payroll', 'Payroll']];

export default function EmployeesPage() {
  // ?tab=leaves opens that tab straight away
  const [tab, setTab] = useState(() => {
    const first = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab');
    return TABS.some(([k]) => k === first) ? first : 'people';
  });
  const [team, setTeam] = useState(null);
  const [overview, setOverview] = useState(null);

  const loadTeam = useCallback(() => api('/api/team').then(setTeam).catch((e) => notify(e.message, 'error')), []);
  const loadOverview = useCallback(() => api('/api/hr/overview').then(setOverview).catch(() => {}), []);
  const reload = useCallback(() => {
    loadTeam();
    loadOverview();
  }, [loadTeam, loadOverview]);
  useEffect(() => {
    reload();
  }, [reload]);
  const pick = (k) => {
    setTab(k);
    window.history.replaceState(null, '', k === 'people' ? '/team' : `/team?tab=${k}`);
  };

  const active = (team || []).filter((m) => m.active);
  const inToday = (overview?.people || []).filter((p) => p.checkIn).length;
  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Employees</h1>
          <p>Logins, attendance, leaves, tasks, weekly reports, targets and salary for your team.</p>
        </div>
      </div>
      <div className="hr-top">
        <div><b>{active.length}</b><span>Active employees</span></div>
        <div><b>{inToday}</b><span>Checked in today</span></div>
        <button onClick={() => pick('leaves')}><b>{overview?.pendingLeaves ?? '—'}</b><span>Leave requests</span></button>
        <button onClick={() => pick('attendance')}><b>{overview?.pendingFixes ?? '—'}</b><span>Time fix requests</span></button>
      </div>
      <div className="tabs">
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>
            {l}{k === 'leaves' && overview?.pendingLeaves ? ` (${overview.pendingLeaves})` : ''}{k === 'attendance' && overview?.pendingFixes ? ` (${overview.pendingFixes})` : ''}
          </button>
        ))}
      </div>
      {tab === 'people' && <People team={team} overview={overview} reload={reload} />}
      {tab === 'attendance' && <Attendance reloadOverview={loadOverview} />}
      {tab === 'leaves' && <Leaves team={active} reloadOverview={loadOverview} />}
      {tab === 'tasks' && <Tasks team={active} reloadOverview={loadOverview} />}
      {tab === 'reports' && <Reports />}
      {tab === 'targets' && <Targets team={active} />}
      {tab === 'holidays' && <Holidays />}
      {tab === 'payroll' && <Payroll />}
    </>
  );
}

const css = `
.hr-top { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.hr-top > * { background: rgba(255,255,255,.75); border: 1px solid rgba(255,255,255,.9); box-shadow: 0 10px 30px rgba(30,41,99,.06); border-radius: 18px; padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; text-align: left; font: inherit; color: inherit; }
.hr-top button { cursor: pointer; }
.hr-top button:hover { border-color: var(--c-200); }
.hr-top b { font-size: 26px; color: var(--c-700); }
.hr-top span { font-size: 13px; color: #64748b; }
.hr-toolbar { justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; flex-wrap: wrap; }
.hr-between { justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.hr-form { display: flex; flex-direction: column; gap: 12px; }
.hr-form h3, .hr-panel h3 { font-size: 12.5px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; margin-top: 6px; }
.hr-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-items: end; }
.hr-grid.two { grid-template-columns: 1fr 1fr; }
.hr-wide { grid-column: 1 / -1; }
.hr-select { width: auto; min-width: 150px; padding: 8px 10px; }
.hr-select.sm { min-width: 0; padding: 5px 8px; font-size: 13px; }
.hr-link { background: none; border: 0; padding: 0; cursor: pointer; text-align: left; font: inherit; color: inherit; }
.hr-link:hover b { color: var(--c-700); text-decoration: underline; }
.hr-a { color: var(--c-700); font-weight: 600; font-size: 13px; }
.tm-made { border: 1px solid rgba(22,163,74,.25); background: rgba(240,253,244,.85); }
.tm-cred { display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; font-size: 14px; margin: 12px 0; background: #fff; border-radius: 12px; padding: 12px 14px; }
.tm-cred span { color: #64748b; }
.tm-cred b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.tm-pass { display: flex; gap: 6px; }
.tm-sub { display: block; font-size: 12px; color: #64748b; }
.tm-who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.tm-off td { opacity: .55; }
.tm-switch { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; cursor: pointer; }
.tm-switch input { width: auto; }
.tm-actions { gap: 6px; flex-wrap: nowrap; }
.tm-actions .btn, .hr-item .tm-del, .hr-task .tm-del, .hr-point .tm-del { background: transparent; border-color: transparent; box-shadow: none; color: #64748b; font-weight: 500; }
.tm-actions .btn:hover { background: var(--c-100); color: var(--c-700); transform: none; }
.tm-del:hover { background: rgba(225,29,72,.08) !important; color: #e11d48 !important; }
.tm-reset { gap: 6px; flex-wrap: nowrap; }
.tm-reset input { width: 170px; }
.hr-overlay { position: fixed; inset: 0; background: rgba(14,42,51,.2); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); z-index: 40; display: flex; justify-content: flex-end; }
.hr-panel { background: rgba(255,255,255,.95); width: 560px; max-width: 100%; height: 100%; overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 10px; box-shadow: -20px 0 60px rgba(30,41,99,.15); }
.hr-panel-head { justify-content: space-between; align-items: flex-start; flex-wrap: nowrap; }
.hr-modal { margin: auto; background: #fff; border-radius: 20px; padding: 22px; width: 460px; max-width: calc(100% - 24px); display: flex; flex-direction: column; gap: 12px; box-shadow: 0 20px 60px rgba(30,41,99,.2); }
.hr-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.hr-stats div { background: #f8fafc; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; }
.hr-stats b { font-size: 20px; color: var(--c-700); }
.hr-stats span { font-size: 12px; color: #64748b; }
.hr-dl { display: grid; grid-template-columns: 170px 1fr; gap: 6px 12px; font-size: 13.5px; background: rgba(248,250,252,.8); border-radius: 14px; padding: 12px 14px; }
.hr-pair { display: contents; }
.hr-dl dt { color: #64748b; }
.hr-dl dd { white-space: pre-wrap; word-break: break-word; }
.hr-item { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 14px; background: #fff; border: 1px solid rgba(148,163,184,.2); margin-top: 8px; flex-wrap: wrap; }
.hr-item small { display: block; color: #64748b; font-size: 12px; margin-top: 2px; }
.hr-docform { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #f8fafc; padding: 12px; border-radius: 14px; }
.hr-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: #64748b; margin: 10px 0; }
.hr-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
.hr-month { padding: 12px 0; border-top: 1px solid rgba(148,163,184,.2); display: flex; flex-direction: column; gap: 8px; }
.hr-days { display: flex; flex-wrap: wrap; gap: 4px; }
.hr-day { width: 30px; height: 30px; border-radius: 8px; border: 0; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
.hr-day.fix { outline: 2px solid #f59e0b; outline-offset: 1px; }
.hr-day:hover { filter: brightness(.9); }
.hr-note { width: 180px; padding: 7px 10px; }
.hr-task { padding: 12px 14px; border-radius: 14px; background: #fff; border: 1px solid rgba(148,163,184,.2); margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.hr-task small { display: block; color: #64748b; font-size: 12px; }
.hr-task.done > div:first-child b { text-decoration: line-through; color: #64748b; }
.hr-pre { white-space: pre-wrap; font-size: 13.5px; color: #334155; }
.hr-comment { font-size: 13px; background: #f8fafc; border-radius: 10px; padding: 6px 10px; }
.hr-commentform { gap: 6px; flex-wrap: nowrap; }
.hr-commentform input { flex: 1; padding: 7px 10px; }
.hr-point { gap: 8px; flex-wrap: nowrap; }
.hr-point input { flex: 1; }
.hr-progress { height: 8px; border-radius: 99px; background: rgba(148,163,184,.2); overflow: hidden; }
.hr-progress span { display: block; height: 100%; background: linear-gradient(90deg, #5fd3eb, #1aa9c8); }
.hr-check { font-size: 13.5px; }
.hr-check.done { color: #64748b; }
.hr-check small { color: #94a3b8; }
.hr-addrow { gap: 8px; margin: 10px 0; flex-wrap: wrap; }
.hr-addrow input[type=date] { width: 170px; }
.hr-addrow input:not([type=date]) { flex: 1; min-width: 200px; }
.hr-num { width: 90px; padding: 6px 8px; }
@media (max-width: 900px) {
  .hr-top, .hr-grid, .hr-stats { grid-template-columns: 1fr 1fr; }
  .hr-dl, .hr-docform { grid-template-columns: 1fr; }
  .tm-reset { flex-wrap: wrap; }
  .tm-actions { flex-wrap: wrap; }
}
`;
