'use client';
// Dashboard: totals, daily chart, replies by follow-up, recent campaigns. Every box opens the page behind its number.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LuChevronLeft, LuChevronRight, LuFileSpreadsheet, LuMailOpen, LuPlus, LuReply, LuSearch, LuSend, LuUsers } from 'react-icons/lu';
import { api, date, num, notify } from '@/lib/api';

const dayName = (iso, long = false) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', long ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });

export default function Dashboard() {
  const router = useRouter();
  const [days, setDays] = useState(7);
  const [d, setD] = useState(null);
  const [hover, setHover] = useState(null); // the day under the mouse (chart)

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
          <Stat href="/contacts" icon={LuUsers} color="blue" label="Total Contacts" value={num(t.contacts)} note={`${num(t.active)} in a sequence now`} />
          <Stat href="#history" icon={LuSend} color="green" label="Emails Sent" value={num(t.sent)} note={`${num(t.todaySent)} / ${num(t.dailyLimit)} today`} />
          <Stat href="#history" icon={LuMailOpen} color="orange" label="Opened" value={num(t.opened)} note={`${d.rates.open}% open rate`} />
          <Stat href="/replies" icon={LuReply} color="purple" label="Replied" value={num(t.replied)} note={`${d.rates.reply}% reply rate`} />
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
          <div className="dash-chart" onMouseLeave={() => setHover(null)}>
            <div className="dash-grid-lines" aria-hidden="true">
              {[1, 0.5, 0].map((f) => <i key={f} style={{ bottom: `${f * 100}%` }}><b>{num(Math.round(maxDay * f))}</b></i>)}
            </div>
            {d.chart.map((x, i) => {
              const few = d.chart.length <= 14;
              const showDate = few || i % (d.chart.length <= 31 ? 5 : 15) === 0 || i === d.chart.length - 1;
              return (
                <button type="button" key={x.date} className={`dash-col ${hover?.date === x.date ? 'on' : ''}`} onMouseEnter={() => setHover(x)} onFocus={() => setHover(x)} onClick={() => document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' })} aria-label={`${dayName(x.date, true)}: ${x.sent} sent, ${x.opened} opened, ${x.replied} replies`}>
                  <em className="dash-num">
                    {few && (<>
                      {num(x.sent)}
                      {d.chart.length <= 7 && x.sent > 0 && <small>{num(x.opened)} opened</small>}
                      {x.replied ? <i>{x.replied} {x.replied === 1 ? 'reply' : 'replies'}</i> : null}
                    </>)}
                  </em>
                  <div className="dash-plot">
                    <div className="dash-bar" style={{ height: `${(x.sent / maxDay) * 100}%` }}>
                      {x.replied > 0 && <div className="dash-bar-reply" style={{ height: `${Math.max(6, (x.replied / Math.max(1, x.sent)) * 100)}%` }} />}
                    </div>
                  </div>
                  <span>{showDate ? dayName(x.date) : '\u00a0'}</span>
                </button>
              );
            })}
          </div>
          <div className="dash-detail">
            {hover ? (
              <><b>{dayName(hover.date, true)}</b><span>{num(hover.sent)} sent</span><span>{num(hover.opened)} opened</span><span>{num(hover.replied)} {hover.replied === 1 ? 'reply' : 'replies'}</span></>
            ) : (
              <><b>Last {days} days</b><span>{num(d.chart.reduce((n, x) => n + x.sent, 0))} sent</span><span>{num(d.chart.reduce((n, x) => n + x.opened, 0))} opened</span><span>{num(d.chart.reduce((n, x) => n + x.replied, 0))} replies</span><small>Point at a day for its numbers</small></>
            )}
          </div>
          <p className="small muted"><i className="dot blue" /> Sent &nbsp; <i className="dot orange" /> Replies</p>
        </div>

        <div className="card">
          <h2>Replies by follow-up</h2>
          {d.steps.every((s) => !s.sent) ? (
            <p className="muted">No emails sent yet.</p>
          ) : (
            d.steps.map((s) => (
              <Link key={s.label} href="/replies" className="dash-step">
                <div className="row dash-step-top">
                  <b>{s.label}</b>
                  <span className="small muted">{num(s.replies)} replies · {num(s.sent)} sent · {s.rate}%</span>
                </div>
                <div className="dash-track"><div style={{ width: `${(s.replies / maxStep) * 100}%` }} /></div>
              </Link>
            ))
          )}
          <div className="dash-mini">
            <Link href="#history"><small>Clicked</small><b>{num(t.clicked)}</b></Link>
            <Link href="/contacts?status=unsubscribed"><small>Unsubscribed</small><b>{num(t.unsubscribed)}</b></Link>
            <Link href="/contacts?status=bounced"><small>Bounced</small><b>{num(t.bounced)}</b></Link>
            <Link href="/replies"><small>New replies</small><b>{num(t.unhandled)}</b></Link>
          </div>
        </div>
      </div>

      <CampaignHistory />
    </>
  );
}

const STATUSES = [['', 'All'], ['active', 'Active'], ['paused', 'Paused'], ['completed', 'Completed'], ['draft', 'Draft']];

/** every campaign ever run (newest first), 10 to a page: open one for its details, or create a new one */
function CampaignHistory() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [h, setH] = useState(null);
  useEffect(() => {
    const t = setTimeout(
      () =>
        api('/api/campaigns', { query: { page, status, q } })
          .then((r) => {
            setH(r);
            // back from a campaign (/#history): scroll to this list once it is on the page
            if (window.location.hash === '#history') {
              setTimeout(() => document.getElementById('history')?.scrollIntoView({ block: 'start' }), 50);
              window.history.replaceState(null, '', '/');
            }
          })
          .catch((e) => notify(e.message, 'error')),
      q ? 300 : 0
    );
    return () => clearTimeout(t);
  }, [page, status, q]);
  const all = h ? Object.values(h.counts).reduce((n, c) => n + c, 0) : 0;
  return (
    <div className="card" id="history">
      <div className="dash-head">
        <div>
          <h2>Campaign history</h2>
          <p className="small muted dash-sub">Every campaign, newest first. Open one to see who got which email, pause it or edit it.</p>
        </div>
        <Link href="/campaigns?new=1" className="btn"><LuPlus /> Create campaign</Link>
      </div>
      <div className="dash-hbar">
        <div className="tabs">
          {STATUSES.map(([k, l]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => { setStatus(k); setPage(1); }}>{l} <span className="dash-count">{num(k ? h?.counts[k] || 0 : all)}</span></button>
          ))}
        </div>
        <label className="dash-search"><LuSearch /><input placeholder="Search campaigns…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
      </div>
      {!h ? (
        <p className="muted">Loading…</p>
      ) : h.list.length === 0 ? (
        <p className="empty">{q || status ? 'No campaigns match.' : 'No campaigns yet.'}</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="cards">
              <thead>
                <tr><th>Campaign</th><th>Status</th><th>Emails</th><th>Contacts</th><th>Sent</th><th>Opened</th><th>Replied</th></tr>
              </thead>
              <tbody>
                {h.list.map((c) => (
                  <tr key={c._id} className="dash-row" onClick={() => router.push(`/campaigns?open=${c._id}`)}>
                    <td><Link href={`/campaigns?open=${c._id}`} onClick={(e) => e.stopPropagation()}><b>{c.name}</b></Link><small>{date(c.createdAt)}</small></td>
                    <td data-label="Status"><span className={`badge ${c.status}`}>{c.status}</span></td>
                    <td data-label="Emails">{c.fromFile ? 'From file' : c.emails}</td>
                    <td data-label="Contacts">{num(c.stats.contacts)}</td>
                    <td data-label="Sent">{num(c.stats.sent)}</td>
                    <td data-label="Opened">{num(c.stats.opened)}<small>{c.stats.openRate}%</small></td>
                    <td data-label="Replied">{num(c.stats.replied)}<small>{c.stats.replyRate}%</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {h.pages > 1 && (
            <div className="dash-pager">
              <button className="btn ghost sm" disabled={h.page <= 1} onClick={() => setPage(h.page - 1)}><LuChevronLeft /> Previous</button>
              <span>Page {h.page} of {h.pages} · {num(h.total)} campaigns</span>
              <button className="btn ghost sm" disabled={h.page >= h.pages} onClick={() => setPage(h.page + 1)}>Next <LuChevronRight /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ href, icon: Icon, color, label, value, note }) {
  return (
    <Link href={href} className={`dash-stat ${color}`}>
      <span className="dash-stat-icon"><Icon /></span>
      <span>{label}</span>
      <b>{value}</b>
      <small>{note}</small>
    </Link>
  );
}

const css = `
.dash-welcome .page-title { margin-bottom: 18px; }
.dash-welcome h1 { font-size: 30px; font-weight: 700; letter-spacing: -.03em; }
.dash-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.dash-stat { color: inherit; text-decoration: none; cursor: pointer; position: relative; border-radius: 20px; padding: 18px; display: flex; flex-direction: column; gap: 2px; background: rgba(255,255,255,.75); border: 1px solid var(--c-100); transition: border-color .2s, box-shadow .2s, transform .2s; }
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
#history { scroll-margin-top: 110px; }
.dash-sub { margin: 4px 0 0; }
.dash-hbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.dash-count { font-size: 11.5px; opacity: .7; margin-left: 2px; }
.dash-search { position: relative; flex: 0 1 260px; min-width: 200px; }
.dash-search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #64748b; }
.dash-search input { width: 100%; padding-left: 36px; }
.dash-row { cursor: pointer; }
.dash-row:hover td { background: rgba(50,193,223,.06); }
.dash-pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 14px; font-size: 13.5px; color: #64748b; flex-wrap: wrap; }
.dash-chart { position: relative; height: 270px; display: flex; align-items: stretch; gap: 6px; padding: 0 0 0 34px; border-bottom: 1px solid rgba(148,163,184,.25); margin-bottom: 10px; }
.dash-col { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; position: relative; z-index: 1; min-width: 0; background: none; border: 0; padding: 0; font: inherit; cursor: pointer; border-radius: 10px; }
.dash-col span { font-size: 11px; color: #64748b; white-space: nowrap; height: 18px; line-height: 18px; flex: none; }
.dash-col.on { background: rgba(50,193,223,.08); }
.dash-col.on .dash-bar { filter: brightness(1.06); box-shadow: 0 8px 20px rgba(50,193,223,.4); }
.dash-num { font-style: normal; font-size: 11.5px; font-weight: 700; color: var(--c-700); display: flex; flex-direction: column; align-items: center; justify-content: flex-end; line-height: 1.25; height: 46px; flex: none; }
.dash-plot { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; min-height: 0; position: relative; z-index: 1; }
.dash-num small { font-weight: 600; color: #64748b; font-size: 10px; }
.dash-grid-lines { position: absolute; left: 0; right: 0; top: 50px; bottom: 22px; pointer-events: none; } /* = the bar area: below the numbers, above the dates */
.dash-grid-lines i { position: absolute; left: 34px; right: 0; border-top: 1px dashed rgba(148,163,184,.3); }
.dash-grid-lines b { position: absolute; left: -34px; top: -8px; width: 30px; text-align: right; font-size: 10.5px; font-weight: 600; color: #94a3b8; }
.dash-num i { font-style: normal; font-weight: 700; color: #0b6e86; font-size: 10.5px; }
.dash-detail { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 14px; padding: 10px 12px; margin-bottom: 8px; border-radius: 12px; background: var(--c-50, #f0fbfe); border: 1px solid var(--c-100); font-size: 13.5px; min-height: 42px; }
.dash-detail b { color: var(--text); }
.dash-detail span { color: var(--c-700); font-weight: 600; }
.dash-detail small { color: #64748b; margin-left: auto; font-size: 12px; }
.dash-bar { width: 100%; max-width: 34px; min-height: 3px; background: linear-gradient(#7ad9ee, #32c1df); border-radius: 9px 9px 4px 4px; box-shadow: 0 6px 14px rgba(50,193,223,.25); display: flex; align-items: flex-end; overflow: hidden; }
.dash-bar-reply { width: 100%; background: #0b87a5; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; vertical-align: middle; }
.dot.blue { background: #32c1df; } .dot.orange { background: #0b87a5; }

.dash-step { display: block; margin-bottom: 6px; padding: 6px 8px; border-radius: 12px; color: inherit; text-decoration: none; transition: background .15s; }
.dash-step:hover { background: rgba(50,193,223,.08); }
.dash-step-top { justify-content: space-between; margin-bottom: 5px; font-size: 13.5px; }
.dash-track { height: 8px; background: var(--c-100); border-radius: 99px; overflow: hidden; }
.dash-track div { height: 100%; min-width: 2px; background: linear-gradient(90deg, #32c1df, #6fd6ec); border-radius: 99px; }
.dash-mini { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px dashed rgba(148,163,184,.3); }
.dash-mini > a { color: inherit; text-decoration: none; padding: 6px 8px; border-radius: 12px; transition: background .15s; }
.dash-mini > a:hover { background: rgba(50,193,223,.08); }
.dash-mini > a:hover b { color: var(--c-700); }
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
