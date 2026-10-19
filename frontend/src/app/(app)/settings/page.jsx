'use client';
// Settings: connection status + emergency pause. All values come from the backend .env
import { useCallback, useEffect, useState } from 'react';
import { LuCircleCheck, LuMail, LuPause, LuPlay, LuRefreshCw, LuSend, LuZap } from 'react-icons/lu';
import { api, date, notify } from '@/lib/api';

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [templates, setTemplates] = useState([]);

  const load = useCallback(
    () =>
      api('/api/settings')
        .then((r) => {
          setS(r);
          setCc(r.cc || '');
        })
        .catch((e) => notify(e.message, 'error')),
    []
  );
  useEffect(() => {
    load();
    api('/api/campaigns/defaults').then((d) => setTemplates(d.followUps || [])).catch(() => {});
  }, [load]);

  const call = async (path, body, okMsg) => {
    try {
      const r = await api(path, { method: 'POST', body });
      if (r && r.ok === false) notify(r.error, 'error');
      else notify(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  if (!s) return <p className="muted">Loading…</p>;

  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Settings</h1>
          <p>Change these values in the backend <code>.env</code> file and restart the server.</p>
        </div>
      </div>

      <div className={`card st-pause ${s.paused ? 'off' : ''}`}>
        <div>
          <h2>{s.paused ? 'All sending is paused' : 'Sending is ON'}</h2>
          <p className="muted">Emergency switch — stops every campaign instantly. Nothing is lost.</p>
        </div>
        <button className={`btn ${s.paused ? '' : 'red'}`} onClick={() => call('/api/settings/pause', { paused: !s.paused }, s.paused ? 'Sending resumed' : 'Paused')}>
          {s.paused ? <><LuPlay /> Resume sending</> : <><LuPause /> Pause everything</>}
        </button>
      </div>

      <div className="st-grid">
        <div className="card">
          <h2>SMTP (sending) <span className={`st-dot ${s.smtp.ready ? 'ok' : ''}`}>{s.smtp.ready ? 'Connected' : 'Not set'}</span></h2>
          <p><span>Host</span>{s.smtp.host || '—'}</p>
          <p><span>From</span>{s.smtp.from}</p>
          <div className="row st-actions">
            <button className="btn ghost sm" onClick={() => call('/api/settings/test-smtp', {}, 'SMTP works')}><LuZap /> Test connection</button>
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); call('/api/settings/test-email', { to }, `Test email sent to ${to}`); }}>
            <input type="email" required placeholder="you@example.com" value={to} onChange={(e) => setTo(e.target.value)} className="st-input" />
            <button className="btn soft sm"><LuMail /> Send test email</button>
          </form>
        </div>

        <div className="card">
          <h2>IMAP (reply check) <span className={`st-dot ${s.imap.ready && !s.imap.error ? 'ok' : ''}`}>{!s.imap.ready ? 'Not set' : s.imap.error ? 'Error' : 'Working'}</span></h2>
          <p><span>Host</span>{s.imap.host || '—'}</p>
          <p><span>Checks every</span>{s.imap.every} min + before each follow-up</p>
          <p><span>Last check</span>{s.imap.lastCheck ? new Date(s.imap.lastCheck).toLocaleString('en-IN') : 'Not yet'}</p>
          {s.imap.error && <p className="st-error">{s.imap.error}</p>}
          {!s.imap.ready && <p className="st-error">Without IMAP, replies can&apos;t be detected and follow-ups won&apos;t stop.</p>}
          <button className="btn ghost sm" onClick={() => call('/api/replies/check', {}, (r) => r.skipped || `${r.found} new replies`)}><LuRefreshCw /> Check inbox now</button>
        </div>

        <div className="card">
          <h2>Sending rules</h2>
          <p><span>Daily limit</span>{s.rules.sentToday} / {s.rules.dailyLimit} sent today</p>
          <p><span>Hourly limit</span>{s.rules.sentLastHour} / {s.rules.hourlyLimit} sent in the last hour</p>
          <p><span>Gap between emails</span>{s.rules.delay} sec</p>
          <p><span>Sending hours</span>{s.rules.window} {s.rules.openNow ? '· open now' : '· closed now'}</p>
          <p><span>Default follow-ups</span>{s.rules.sequence}</p>
          <p><span>Weekends</span>{s.rules.weekends}</p>
          <p><span>Last run</span>{s.lastRun ? `${date(s.lastRun)} · ${s.lastResult?.reason || `sent ${s.lastResult?.sent || 0}`}` : '—'}</p>
          <button className="btn ghost sm" onClick={() => call('/api/settings/run', {}, (r) => r.reason ? `Nothing sent: ${r.reason}` : `Sent ${r.sent}`)}><LuSend /> Run send queue now</button>
        </div>

        <div className="card">
          <h2>CC on every email</h2>
          <p className="muted small st-sub">Ye address(es) har email aur follow-up mein CC hote hain. Comma se kai daal sakte ho. Khali = no CC. Default <code>MAIL_CC</code> in .env{s.ccEnv ? ` (${s.ccEnv})` : ''}.</p>
          <form className="row" onSubmit={(e) => { e.preventDefault(); call('/api/settings/cc', { cc }, 'CC saved'); }}>
            <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="mayank@geekcreativeagency.com" className="st-input" />
            <button className="btn sm">Save CC</button>
            <button type="button" className="btn ghost sm" onClick={() => call('/api/settings/cc', { reset: true }, 'CC reset to .env')}>Use .env</button>
          </form>
          <p className="small muted st-sub">New uploads use this CC. A running campaign keeps its own (change it on the campaign page).</p>
        </div>

        <div className="card">
          <h2>Safety</h2>
          <ul className="st-list">
            <li><LuCircleCheck /> Unsubscribe link + Gmail one-click unsubscribe in every email</li>
            <li><LuCircleCheck /> {s.blocked} address(es) permanently blocked (unsubscribed / bounced)</li>
            <li><LuCircleCheck /> Follow-ups stop the moment someone replies</li>
            <li><LuCircleCheck /> Out-of-office auto replies are ignored</li>
            <li><LuCircleCheck /> Admin ID & password only from .env</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <h2>Fixed follow-ups ({templates.length})</h2>
        <p className="muted small st-sub">Sent in the same thread (&quot;Re: first subject&quot;) with the earlier emails quoted below. Only {'{{firstName}}'} and {'{{company}}'} change. To change the text edit <code>backend/templates.js</code> and restart the backend.</p>
        <div className="st-fus">
          {templates.map((t, i) => (
            <details key={i}>
              <summary>Follow-up {i + 1}</summary>
              <pre>{t}</pre>
            </details>
          ))}
        </div>
      </div>
    </>
  );
}

const css = `
.st-pause { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.st-pause h2::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #16a34a; margin-right: 10px; vertical-align: 2px; box-shadow: 0 0 0 4px rgba(22,163,74,.15); }
.st-pause.off h2::before { background: #f59e0b; box-shadow: 0 0 0 4px rgba(245,158,11,.18); }
.st-pause.off { background: rgba(255,247,237,.75); }
.st-pause h2 { margin-bottom: 4px; }
.st-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.st-grid .card p { display: flex; gap: 12px; font-size: 13.5px; margin-bottom: 8px; word-break: break-word; }
.st-grid .card p span { width: 140px; flex-shrink: 0; color: #64748b; }
.st-dot { font-size: 12px; font-weight: 600; color: #e11d48; margin-left: 8px; }
.st-dot.ok { color: #16a34a; }
.st-actions { margin: 10px 0; }
.st-input { flex: 1; min-width: 180px; }
.st-sub { margin-bottom: 12px; }
.st-sub code, .st-grid code { background: #f1f5f9; padding: 1px 6px; border-radius: 6px; font-size: 12px; }
.st-fus { display: flex; flex-direction: column; gap: 8px; }
.st-fus details { border: 1px solid rgba(50,193,223,.22); border-radius: 12px; padding: 10px 14px; background: rgba(255,255,255,.55); }
.st-fus summary { cursor: pointer; font-weight: 600; font-size: 13.5px; color: var(--c-700); }
.st-fus pre { white-space: pre-wrap; font-family: inherit; font-size: 13px; color: #334155; margin-top: 10px; line-height: 1.55; }
.st-error { background: #fff0f3; color: #9f1239; padding: 8px 10px; border-radius: 8px; }
.st-list li { display: flex; gap: 8px; align-items: flex-start; }
.st-list svg { color: #16a34a; flex-shrink: 0; margin-top: 2px; font-size: 17px; }
.st-list { list-style: none; display: flex; flex-direction: column; gap: 10px; font-size: 13.5px; }
.page-title code { background: #f1f5f9; padding: 1px 6px; border-radius: 6px; }
@media (max-width: 900px) { .st-grid { grid-template-columns: 1fr; } .st-pause .btn { width: 100%; } }
`;
