'use client';
// Portal for team members and clients (they log in with the email + password the admin made).
//   team   -> every account they work on: the team, their tasks (tick when done) and the messages
//   client -> their account: progress, the Geek team on it, and messages with the team
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { LuCircleCheck, LuLogOut } from 'react-icons/lu';
import { api, date, getToken, notify, setRole, setToken } from '@/lib/api';
import { Attendance, Documents, Home, Leaves, PasswordForm, Payslips, Profile, Report, Targets, Tasks, emCss } from './Employee';
import Shell from './Shell';
import IdeaBucket from '@/lib/ideas';
import { TeamWebsiteForms } from '@/lib/website-forms';
import { openFile } from '@/lib/hr';

const LOGO = process.env.NEXT_PUBLIC_LOGO_ICON_URL || '/fav.png';
const STAGE = { cold: 'Cold lead', hot: 'Hot lead', opportunity: 'Opportunity', account: 'Account', old_client: 'Old client' };

export default function PortalPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [tab, setTab] = useState('home');
  const [pw, setPw] = useState(false); // client: change password box
  const [ideas, setIdeas] = useState(false); // client: Idea Bucket
  const [forms, setForms] = useState([]); // employee: website forms the admin gave them
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    api('/api/portal')
      .then((r) => {
        if (r.me.role === 'admin') return router.replace('/');
        if (r.me.role === 'insights') return router.replace('/insights'); // Insights logins only see the Insights Dashboard
        setData(r);
        if (r.me.role === 'team') api('/api/website-leads/mine').then((m) => setForms(m.forms || [])).catch(() => {});
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return undefined;
    }
    load();
    const show = (e) => {
      setToast(e.detail);
      setTimeout(() => setToast(null), 3000);
    };
    window.addEventListener('geek-toast', show);
    return () => window.removeEventListener('geek-toast', show);
  }, [load, router]);

  const logout = () => {
    setToken(null);
    setRole(null);
    router.replace('/login');
  };
  const tick = async (accountId, t) => {
    try {
      await api(`/api/portal/tasks/${accountId}/${t._id}`, { method: 'PUT', body: { done: !t.done } });
      notify(t.done ? 'Marked as not done' : 'Done ✓');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const post = async (accountId, text) => {
    try {
      await api(`/api/portal/messages/${accountId}`, { method: 'POST', body: { text } });
      load();
      return true;
    } catch (e) {
      notify(e.message, 'error');
      return false;
    }
  };

  const me = data?.me;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const isEmployee = me?.role === 'team' && !me.mustChangePassword;

  // employees: sidebar app (desktop) / bottom tabs (phone)
  if (data && isEmployee) {
    return (
      <div className="pt">
        <style>{css + emCss}</style>
        <Shell me={me} tab={tab} setTab={setTab} hideAccounts={!data.accounts.length} showForms={forms.length > 0} onLogout={logout}>
          {tab === 'home' && <Home go={setTab} />}
          {tab === 'tasks' && <Tasks me={me} />}
          {tab === 'attendance' && <Attendance />}
          {tab === 'leaves' && <Leaves />}
          {tab === 'report' && <Report />}
          {tab === 'targets' && <Targets />}
          {tab === 'documents' && <Documents />}
          {tab === 'payslips' && <Payslips />}
          {tab === 'ideas' && <IdeaBucket bare />}
          {tab === 'forms' && <TeamWebsiteForms forms={forms} />}
          {tab === 'profile' && <Profile onPhoto={(photo) => setData((d) => ({ ...d, me: { ...d.me, photo } }))} />}
          {tab === 'accounts' && (
            <>
              <div className="em-row em-between">
                <p className="pt-muted">{data.accounts.reduce((n, a) => n + a.tasks.filter((t) => !t.done).length, 0)} open task(s) across {data.accounts.length} account(s)</p>
                <label className="pt-check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
              </div>
              {data.accounts.length === 0 && <div className="pt-card pt-empty">No work assigned to you yet.</div>}
              {data.accounts.map((a) => {
                const tasks = a.tasks.filter((t) => showDone || !t.done);
                return (
                  <section key={a._id} className="pt-card">
                    <h2>{a.name} <span className={`pt-stage ${a.stage}`}>{STAGE[a.stage]}</span></h2>
                    <Team list={a.team} me={me.name} />
                    <h3 className="pt-sub">My tasks</h3>
                    {tasks.length === 0 && <p className="pt-muted">{a.tasks.length ? 'All your tasks here are done.' : 'No task for you on this account yet.'}</p>}
                    {tasks.map((t) => (
                      <label key={t._id} className={`pt-task ${t.done ? 'done' : ''}`}>
                        <input type="checkbox" checked={t.done} onChange={() => tick(a._id, t)} />
                        <span><b>{t.task}</b><small>Updated {date(t.updatedAt)}</small></span>
                      </label>
                    ))}
                    <h3 className="pt-sub">Messages</h3>
                    <Messages list={a.messages} me={me.name} onSend={(text) => post(a._id, text)} />
                  </section>
                );
              })}
            </>
          )}
        </Shell>
        {toast && <div className={`pt-toast ${toast.type}`}>{toast.text}</div>}
      </div>
    );
  }

  return (
    <div className="pt">
      <style>{css + emCss}</style>
      <header className="pt-head">
        <div className="pt-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} alt="Geek" />
          <div>
            <small>{me?.role === 'client' ? 'Your account with Geek' : 'Geek team'}</small>
            <b>{me ? `${hello}, ${me.name}` : 'Loading…'}</b>
          </div>
        </div>
        <div className="em-row">
          {me?.role === 'client' && <button className="pt-btn ghost" onClick={() => setIdeas(!ideas)}>{ideas ? 'Back to my account' : 'Share an idea'}</button>}
          {me?.role === 'client' && <button className="pt-btn ghost" onClick={() => setPw(!pw)}>Change password</button>}
          <button className="pt-btn ghost" onClick={logout}><LuLogOut /> Log out</button>
        </div>
      </header>

      <main className="pt-main">
        {!data ? (
          <p className="pt-muted">Loading…</p>
        ) : me.mustChangePassword ? (
          <section className="pt-card">
            <h2>Welcome, {me.name}! Please set your own password</h2>
            <p className="pt-muted">For your safety, choose a new password before you start. Only you will know it.</p>
            <PasswordForm first onDone={load} />
          </section>
        ) : null}
        {data && !me.mustChangePassword && me.role === 'client' && pw && (
          <section className="pt-card"><h2>Change password</h2><PasswordForm onDone={() => setPw(false)} /></section>
        )}
        {data && !me.mustChangePassword && me.role === 'client' && ideas && <IdeaBucket />}
        {data && !me.mustChangePassword && me.role === 'client' && !ideas && (!data.account ? (
          <div className="pt-card pt-empty">Your account is being set up. Please check back soon.</div>
        ) : (
          <ClientView account={data.account} project={data.project} me={me.name} onSend={(text) => post(data.account._id, text)} />
        ))}
      </main>
      {toast && <div className={`pt-toast ${toast.type}`}>{toast.text}</div>}
    </div>
  );
}

const DOC = { estimate: 'Estimate', invoice_advance: 'Advance invoice', invoice_final: 'Invoice', report: 'Report', contract: 'Contract', po: 'Purchase order', other: 'Document' };
function Project({ p }) {
  const cur = p.steps.findIndex((s) => s.key === p.step);
  return (
    <>
      <section className="pt-card">
        <h2>Project progress</h2>
        <ol className="pt-steps">
          {p.steps.map((s, i) => (
            <li key={s.key} className={p.step === 'complete' || i < cur ? 'done' : i === cur ? 'now' : ''}><span>{p.step === 'complete' || i < cur ? '✓' : i + 1}</span>{s.label}</li>
          ))}
        </ol>
        {p.deliverables.length > 0 && (
          <>
            <h3 className="pt-sub">Deliverables ({p.deliverables.filter((d) => d.done).length}/{p.deliverables.length})</h3>
            {p.deliverables.map((d) => <div key={d._id} className={`pt-task ro ${d.done ? 'done' : ''}`}>{d.done ? <LuCircleCheck className="pt-ok" /> : <span className="pt-dot" />}<span><b>{d.text}</b></span></div>)}
          </>
        )}
      </section>
      {p.documents.length > 0 && (
        <section className="pt-card">
          <h2>Documents from Geek</h2>
          {[...p.documents].reverse().map((d) => (
            <div key={d._id} className="pt-doc">
              <span><b>{DOC[d.kind] || 'Document'}{d.number ? ` · ${d.number}` : ''}</b><small>{d.amount ? `₹${new Intl.NumberFormat('en-IN').format(d.amount)} · ` : ''}{date(d.at)}</small></span>
              <span className="em-row">
                {d.file && <button className="pt-btn" onClick={() => openFile(d.file)}>Download</button>}
                {d.link && <a className="pt-btn" href={d.link} target="_blank" rel="noopener noreferrer">Open link</a>}
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function ClientView({ account, project, me, onSend }) {
  const total = account.tasks.length;
  const done = account.tasks.filter((t) => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <>
      <div className="pt-title">
        <div>
          <h1>{account.name}</h1>
          <p className="pt-muted">What the Geek team is working on for you</p>
        </div>
      </div>
      {project && <Project p={project} />}
      {(total > 0 || !project) && (
        <>
      <section className="pt-card">
        <div className="pt-progress">
          <div><b>{pct}%</b><span>{done} of {total} done</span></div>
          <div className="pt-bar"><span style={{ width: `${pct}%` }} /></div>
        </div>
      </section>
      <section className="pt-card">
        <h2>Work in progress</h2>
        {account.tasks.filter((t) => !t.done).length === 0 && <p className="pt-muted">Everything is done for now.</p>}
        {account.tasks.filter((t) => !t.done).map((t) => (
          <div key={t._id} className="pt-task ro"><span className="pt-dot" /><span><b>{t.task}</b><small>{t.member} · updated {date(t.updatedAt)}</small></span></div>
        ))}
        {done > 0 && <h2 className="pt-sub">Completed</h2>}
        {account.tasks.filter((t) => t.done).map((t) => (
          <div key={t._id} className="pt-task ro done"><LuCircleCheck className="pt-ok" /><span><b>{t.task}</b><small>{t.member} · {date(t.updatedAt)}</small></span></div>
        ))}
      </section>
        </>
      )}
      {account.team.length > 0 && (
        <section className="pt-card">
          <h2>Your Geek team</h2>
          <Team list={account.team} />
        </section>
      )}
      <section className="pt-card">
        <h2>Messages</h2>
        <Messages list={account.messages} me={me} onSend={onSend} />
      </section>
    </>
  );
}

function Team({ list, me }) {
  if (!list?.length) return null;
  return (
    <div className="pt-team">
      {list.map((m) => <span key={m} className={m === me ? 'me' : ''}>{m}{m === me ? ' (you)' : ''}</span>)}
    </div>
  );
}

function Messages({ list, me, onSend }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    if (await onSend(text.trim())) setText('');
    setBusy(false);
  };
  return (
    <div className="pt-msgs">
      {list.length === 0 && <p className="pt-muted">No messages yet.</p>}
      {list.map((m) => (
        <div key={m._id} className={`pt-msg ${m.role} ${m.author === me ? 'mine' : ''}`}>
          <div className="pt-msghead"><b>{m.author === me ? 'You' : m.author}</b><span>{m.role === 'client' ? 'Client' : m.role === 'team' ? 'Geek team' : 'Geek'} · {new Date(m.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></div>
          <p>{m.text}</p>
        </div>
      ))}
      <form className="pt-msgform" onSubmit={send}>
        <textarea rows={2} placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }} />
        <button className="pt-btn" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

const css = `
.pt { min-height: 100vh; background: linear-gradient(150deg, #e9f9fd 0%, #ffffff 55%, #e3f6fb 100%); color: #0e2a33; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif; }
.pt * { box-sizing: border-box; margin: 0; }
.pt-head { position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; padding: 14px 32px; background: rgba(255,255,255,.7); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%); border-bottom: 1px solid rgba(50,193,223,.18); }
.pt-brand { display: flex; align-items: center; gap: 12px; }
.pt-brand img { width: 42px; height: 42px; border-radius: 12px; background: #fff; box-shadow: 0 8px 18px rgba(50,193,223,.25); }
.pt-brand small { display: block; font-size: 12px; color: #64748b; }
.pt-brand b { font-size: 17px; }
.pt-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(50,193,223,.3); background: #fff; color: #0b87a5; padding: 8px 14px; border-radius: 12px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
.pt-btn:hover { background: #effafc; }
.pt-main { max-width: 900px; margin: 0 auto; padding: 32px; display: flex; flex-direction: column; gap: 16px; }
.pt-title { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.pt-title h1 { font-size: 30px; letter-spacing: -.02em; }
.pt-muted { color: #64748b; font-size: 14px; }
.pt-card { background: rgba(255,255,255,.75); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,.9); box-shadow: 0 10px 30px rgba(30,41,99,.07); border-radius: 20px; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
.pt-card h2 { font-size: 17px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pt-sub { margin-top: 10px; font-size: 14px !important; color: #64748b; }
.pt-empty { text-align: center; color: #64748b; padding: 40px; }
.pt-stage { font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 99px; background: #f1f5f9; color: #475569; }
.pt-stage.account { background: #dcfce7; color: #15803d; }
.pt-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.pt-steps li { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #94a3b8; }
.pt-steps li span { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: #e2e8f0; color: #64748b; font-size: 12px; font-weight: 700; flex: none; }
.pt-steps li.done { color: #15803d; } .pt-steps li.done span { background: #22c55e; color: #fff; }
.pt-steps li.now { color: #0b87a5; font-weight: 600; } .pt-steps li.now span { background: #1aa9c8; color: #fff; }
.pt-doc { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px dashed rgba(148,163,184,.3); }
.pt-doc small { display: block; color: #64748b; font-size: 12px; }
@media (max-width: 640px) { .pt-steps { grid-template-columns: 1fr 1fr; } }
.pt-stage.opportunity { background: #fef9c3; color: #a16207; }
.pt-stage.hot { background: #fff1e6; color: #c2410c; }
.pt-task { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 14px; background: #fff; border: 1px solid rgba(148,163,184,.2); cursor: pointer; font-size: 14px; }
.pt-task.ro { cursor: default; }
.pt-task input { width: 18px; height: 18px; margin-top: 2px; accent-color: #1aa9c8; }
.pt-task b { display: block; font-weight: 600; white-space: pre-wrap; }
.pt-task small { color: #64748b; font-size: 12px; }
.pt-task.done b { text-decoration: line-through; color: #64748b; }
.pt-dot { width: 10px; height: 10px; border-radius: 50%; background: #32c1df; margin-top: 6px; flex-shrink: 0; box-shadow: 0 0 0 4px rgba(50,193,223,.15); }
.pt-ok { color: #16a34a; font-size: 18px; flex-shrink: 0; }
.pt-check { display: flex; gap: 6px; align-items: center; font-size: 14px; color: #475569; }
.pt-progress { display: flex; flex-direction: column; gap: 10px; }
.pt-progress div:first-child { display: flex; align-items: baseline; gap: 10px; }
.pt-progress b { font-size: 34px; color: #0b87a5; }
.pt-progress span { color: #64748b; }
.pt-bar { height: 10px; border-radius: 99px; background: rgba(148,163,184,.2); overflow: hidden; }
.pt-bar span { display: block; height: 100%; background: linear-gradient(90deg, #5fd3eb, #1aa9c8); border-radius: 99px; }
.pt-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #0e2a33; color: #fff; padding: 10px 16px; border-radius: 12px; font-size: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.2); }
.pt-toast.error { background: #be123c; }
.pt-team { display: flex; flex-wrap: wrap; gap: 6px; }
.pt-team span { font-size: 12.5px; font-weight: 600; padding: 4px 11px; border-radius: 99px; background: #e0f6fb; color: #0b87a5; }
.pt-team span.me { background: #0b87a5; color: #fff; }
.pt-msgs { display: flex; flex-direction: column; gap: 8px; }
.pt-msg { background: #fff; border: 1px solid rgba(148,163,184,.2); border-radius: 14px; padding: 10px 14px; font-size: 14px; max-width: 85%; }
.pt-msg.mine { align-self: flex-end; background: #effafc; border-color: rgba(50,193,223,.3); }
.pt-msg.client { border-left: 3px solid #16a34a; }
.pt-msghead { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.pt-msghead span { font-size: 11.5px; color: #94a3b8; }
.pt-msg p { white-space: pre-wrap; }
.pt-msgform { display: flex; gap: 8px; align-items: flex-end; }
.pt-msgform textarea { flex: 1; font: inherit; font-size: 14px; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(148,163,184,.35); resize: vertical; }
.pt-btn:disabled { opacity: .5; cursor: default; }
@media (max-width: 700px) { .pt-head { padding: 12px 20px; } .pt-main { padding: 20px; } .pt-title h1 { font-size: 24px; } }
`;
