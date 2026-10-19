'use client';
// Dashboard: totals, daily chart, replies by follow-up, recent campaigns
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LuFileSpreadsheet, LuMailOpen, LuReply, LuSend, LuUsers } from 'react-icons/lu';
import { api, num, notify } from '@/lib/api';

export default function Dashboard() {
  const [days, setDays] = useState(7);
  const [d, setD] = useState(null);

  useEffect(() => {
    api('/api/dashboard', { query: { days } }).then(setD).catch((e) => notify(e.message, 'error'));
  }, [days]);

  if (!d) return <p className="muted">Loading…</p>;
  const t = d.totals;
  const maxDay = Math.max(1, ...d.chart.map((x) => x.sent));
  const maxStep = Math.max(1, ...d.steps.map((s) => s.replies));

  return (
    <>
      <style>{css}</style>
      <div className="card dash-welcome">
        <div className="page-title">
          <div>
            <h1>Your outreach today</h1>
            <p>
              {num(t.todaySent)} of {num(t.dailyLimit)} emails sent.{' '}
              {t.unhandled ? <Link href="/replies" className="dash-link">{num(t.unhandled)} {t.unhandled === 1 ? 'reply needs' : 'replies need'} your attention</Link> : 'No new replies waiting.'}
            </p>
          </div>
          <Link href="/import" className="btn"><LuFileSpreadsheet /> Upload file & send</Link>
        </div>
        <div className="dash-stats">
          <Stat icon={LuUsers} color="blue" label="Total Contacts" value={num(t.contacts)} note={`${num(t.active)} in a sequence now`} />
          <Stat icon={LuSend} color="green" label="Emails Sent" value={num(t.sent)} note={`${num(t.todaySent)} / ${num(t.dailyLimit)} today`} />
          <Stat icon={LuMailOpen} color="orange" label="Opened" value={num(t.opened)} note={`${d.rates.open}% open rate`} />
          <Stat icon={LuReply} color="purple" label="Replied" value={num(t.replied)} note={`${d.rates.reply}% reply rate`} />
        </div>
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="dash-head">
            <h2>Emails per day</h2>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
          <div className="dash-chart">
            {d.chart.map((x) => (
              <div key={x.date} className="dash-col" title={`${x.date}: ${x.sent} sent, ${x.replied} replies`}>
                <div className="dash-bar" style={{ height: `${(x.sent / maxDay) * 100}%` }}>
                  {x.replied > 0 && <div className="dash-bar-reply" style={{ height: `${Math.max(6, (x.replied / Math.max(1, x.sent)) * 100)}%` }} />}
                </div>
                {d.chart.length <= 14 && <span>{x.date.slice(8)}</span>}
              </div>
            ))}
          </div>
          <p className="small muted"><i className="dot blue" /> Sent &nbsp; <i className="dot orange" /> Replies</p>
        </div>

        <div className="card">
          <h2>Replies by follow-up</h2>
          {d.steps.every((s) => !s.sent) ? (
            <p className="muted">No emails sent yet.</p>
          ) : (
            d.steps.map((s) => (
              <div key={s.label} className="dash-step">
                <div className="row dash-step-top">
                  <b>{s.label}</b>
                  <span className="small muted">{num(s.replies)} replies · {num(s.sent)} sent · {s.rate}%</span>
                </div>
                <div className="dash-track"><div style={{ width: `${(s.replies / maxStep) * 100}%` }} /></div>
              </div>
            ))
          )}
          <div className="dash-mini">
            <div><small>Clicked</small><b>{num(t.clicked)}</b></div>
            <div><small>Unsubscribed</small><b>{num(t.unsubscribed)}</b></div>
            <div><small>Bounced</small><b>{num(t.bounced)}</b></div>
            <div><small>New replies</small><b><Link href="/replies">{num(t.unhandled)}</Link></b></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="dash-head">
          <h2>Recent campaigns</h2>
          <Link href="/campaigns" className="dash-link">View all</Link>
        </div>
        {d.recent.length === 0 ? (
          <p className="empty">No campaigns yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead>
                <tr><th>Campaign</th><th>Status</th><th>Contacts</th><th>Sent</th><th>Opened</th><th>Replied</th></tr>
              </thead>
              <tbody>
                {d.recent.map((c) => (
                  <tr key={c._id}>
                    <td><Link href={`/campaigns?open=${c._id}`}><b>{c.name}</b></Link></td>
                    <td data-label="Status"><span className={`badge ${c.status}`}>{c.status}</span></td>
                    <td data-label="Contacts">{num(c.stats.contacts)}</td>
                    <td data-label="Sent">{num(c.stats.sent)}</td>
                    <td data-label="Opened">{num(c.stats.opened)}<small>{c.stats.openRate}%</small></td>
                    <td data-label="Replied">{num(c.stats.replied)}<small>{c.stats.replyRate}%</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ icon: Icon, color, label, value, note }) {
  return (
    <div className={`dash-stat ${color}`}>
      <span className="dash-stat-icon"><Icon /></span>
      <span>{label}</span>
      <b>{value}</b>
      <small>{note}</small>
    </div>
  );
}

const css = `
.dash-welcome .page-title { margin-bottom: 18px; }
.dash-welcome h1 { font-size: 30px; font-weight: 700; letter-spacing: -.03em; }
.dash-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.dash-stat { position: relative; border-radius: 20px; padding: 18px; display: flex; flex-direction: column; gap: 2px; background: rgba(255,255,255,.75); border: 1px solid var(--c-100); transition: border-color .2s, box-shadow .2s, transform .2s; }
.dash-stat:hover { border-color: var(--c-200); box-shadow: 0 12px 30px rgba(50,193,223,.16); transform: translateY(-2px); }
.dash-stat-icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; font-size: 19px; margin-bottom: 12px; color: var(--c-700); background: var(--c-100); transition: background .2s, color .2s; }
.dash-stat:hover .dash-stat-icon { background: var(--c); color: #fff; }
.dash-stat span:not(.dash-stat-icon) { font-size: 13px; color: #64748b; font-weight: 500; }
.dash-stat b { font-size: 30px; letter-spacing: -.03em; color: var(--text); line-height: 1.2; }
.dash-stat small { font-size: 12.5px; font-weight: 500; color: #64748b; }
.dash-stat.blue .dash-stat-icon { background: linear-gradient(150deg, #5fd3eb, #32c1df 55%, #1aa9c8); color: #fff; box-shadow: 0 8px 18px var(--c-glow); }
.dash-stat.purple small { color: var(--c-700); font-weight: 600; }

.dash-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 20px; }
.dash-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; }
.dash-head h2 { margin: 0; }
.dash-head select { width: auto; }
.dash-link { color: var(--c-700); font-weight: 600; font-size: 13.5px; }
.dash-chart { height: 220px; display: flex; align-items: flex-end; gap: 6px; padding: 10px 0 0; border-bottom: 1px solid rgba(148,163,184,.25); margin-bottom: 10px; }
.dash-col { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; min-width: 0; }
.dash-col span { font-size: 11px; color: #64748b; }
.dash-bar { width: 100%; max-width: 34px; min-height: 3px; background: linear-gradient(#7ad9ee, #32c1df); border-radius: 9px 9px 4px 4px; box-shadow: 0 6px 14px rgba(50,193,223,.25); display: flex; align-items: flex-end; overflow: hidden; }
.dash-bar-reply { width: 100%; background: #0b87a5; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; vertical-align: middle; }
.dot.blue { background: #32c1df; } .dot.orange { background: #0b87a5; }

.dash-step { margin-bottom: 12px; }
.dash-step-top { justify-content: space-between; margin-bottom: 5px; font-size: 13.5px; }
.dash-track { height: 8px; background: var(--c-100); border-radius: 99px; overflow: hidden; }
.dash-track div { height: 100%; min-width: 2px; background: linear-gradient(90deg, #32c1df, #6fd6ec); border-radius: 99px; }
.dash-mini { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px dashed rgba(148,163,184,.3); }
.dash-mini small { display: block; color: #64748b; font-size: 12px; }
.dash-mini b { font-size: 18px; }

@media (max-width: 1100px) { .dash-grid { grid-template-columns: 1fr; } .dash-stats { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) {
  .dash-welcome h1 { font-size: 21px; }
  .dash-stats { gap: 10px; }
  .dash-stat { padding: 14px; }
  .dash-stat b { font-size: 22px; }
  .dash-mini { grid-template-columns: repeat(2, 1fr); }
}
`;
