'use client';
// Pipeline: every company / brand by stage (cold lead -> hot lead -> opportunity -> account, + old clients),
// many contact points (members) per company, notes, and team tasks on each account.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LuBuilding2, LuChevronLeft, LuChevronRight, LuCopy, LuExternalLink, LuHandshake, LuKeyRound, LuPlus, LuTrash2, LuUserPlus, LuX } from 'react-icons/lu';
import { api, date, num, notify } from '@/lib/api';

const STAGES = [['cold', 'Cold lead'], ['hot', 'Hot lead'], ['opportunity', 'Opportunity'], ['account', 'Account'], ['old_client', 'Old client']];
const STAGE = Object.fromEntries(STAGES);
const INFO = [['website', 'Website'], ['industry', 'Industry'], ['location', 'Location'], ['linkedin', 'LinkedIn']];
const EMPTY_MEMBER = { name: '', email: '', phone: '', title: '', linkedin: '' };
const makePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const pick = new Uint32Array(12);
  crypto.getRandomValues(pick);
  return Array.from(pick, (n) => chars[n % chars.length]).join('').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
};
const copy = (text) => navigator.clipboard?.writeText(text).then(() => notify('Copied')).catch(() => {});
const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || '').trim());

export default function PipelinePage() {
  const [stage, setStage] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [convertFirst, setConvertFirst] = useState(false); // open the panel straight on "Convert to account"

  const load = useCallback(() => {
    api('/api/companies', { query: { stage, search, page } }).then(setData).catch((e) => notify(e.message, 'error'));
  }, [stage, search, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('open');
    if (id) setTimeout(() => setOpenId(id), 0);
  }, []);

  const update = async (c, body) => {
    try {
      await api(`/api/companies/${c._id}`, { method: 'PUT', body });
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const counts = data?.counts || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Pipeline</h1>
          <p>Cold lead → Hot lead (they replied) → Opportunity (talks going on) → Account (converted). An account gets its team, their tasks and messages.</p>
        </div>
      </div>

      {(
        <>
          <div className="pl-stages">
            <button className={stage === '' ? 'on' : ''} onClick={() => { setStage(''); setPage(1); }}><span>All</span><b>{num(all)}</b></button>
            {STAGES.map(([k, v]) => (
              <button key={k} className={`${stage === k ? 'on' : ''} s-${k}`} onClick={() => { setStage(k); setPage(1); }}><span>{v}</span><b>{num(counts[k] || 0)}</b></button>
            ))}
          </div>

          <div className="card">
            <div className="row pl-filters">
              <input placeholder="Search company, industry or city…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            {!data ? (
              <p className="muted">Loading…</p>
            ) : data.items.length === 0 ? (
              <p className="empty">No companies here yet. Import your sheet from the Import page, or add one.</p>
            ) : (
              <div className="table-wrap">
                <table className="cards">
                  <thead><tr><th>Company</th><th>Stage</th><th>People</th><th>Open tasks</th><th>Updated</th></tr></thead>
                  <tbody>
                    {data.items.map((c) => (
                      <tr key={c._id}>
                        <td>
                          <button className="pl-name" onClick={() => setOpenId(c._id)}>
                            <b>{c.name}</b>
                            <small>{[c.industry, c.location].filter(Boolean).join(' · ') || c.source || ''}</small>
                          </button>
                        </td>
                        <td data-label="Stage">
                          <select className={`pl-stage s-${c.stage}`} value={c.stage} onChange={(e) => (e.target.value === 'account' ? (setConvertFirst(true), setOpenId(c._id)) : update(c, { stage: e.target.value }))}>
                            {STAGES.map(([k, v]) => <option key={k} value={k} disabled={k === 'account' && !['opportunity', 'account'].includes(c.stage)}>{v}{k === 'account' && !['opportunity', 'account'].includes(c.stage) ? ' (after Opportunity)' : ''}</option>)}
                          </select>
                          {c.stage === 'opportunity' && (
                            <button className="pl-convert" title="Convert to account" onClick={() => { setConvertFirst(true); setOpenId(c._id); }}><LuHandshake /> Convert</button>
                          )}
                        </td>
                        <td data-label="People"><b>{c.contacts}</b> <small className="muted">{c.contactNames.join(', ')}</small></td>
                        <td data-label="Open tasks">{c.openTasks || '—'}</td>
                        <td data-label="Updated">{date(c.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data && data.pages > 1 && (
              <div className="row pl-pager">
                <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><LuChevronLeft /> Prev</button>
                <span className="small muted">Page {page} of {data.pages} · {num(data.total)} companies</span>
                <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next <LuChevronRight /></button>
              </div>
            )}
          </div>
        </>
      )}

      {openId && <CompanyPanel id={openId} convertFirst={convertFirst} onClose={() => { setOpenId(null); setConvertFirst(false); load(); }} />}
    </>
  );
}

/* ---------- one company: details, people, team tasks ---------- */
function CompanyPanel({ id, onClose, convertFirst }) {
  const [d, setD] = useState(null);
  const [info, setInfo] = useState(null);
  const [member, setMember] = useState(null);
  const [task, setTask] = useState({ member: '', task: '' });
  const [conv, setConv] = useState(null); // convert-to-account / client login form
  const [shared, setShared] = useState(null); // login details to give the client (shown once)

  const load = useCallback(() => {
    api(`/api/companies/${id}`)
      .then((r) => {
        setD(r);
        if (convertFirst && r.company.stage === 'opportunity') setConv((v) => v || { name: r.contacts[0]?.name || r.company.name, email: r.contacts.find((p) => p.email)?.email || '', password: makePassword() });
        setInfo({ name: r.company.name, stage: r.company.stage, notes: r.company.notes || '', ...Object.fromEntries(INFO.map(([k]) => [k, r.company[k] || ''])) });
      })
      .catch((e) => notify(e.message, 'error'));
  }, [id, convertFirst]);
  useEffect(() => {
    load();
  }, [load]);

  const call = async (path, method, body, msg) => {
    try {
      await api(`/api/companies/${id}${path}`, { method, body });
      if (msg) notify(msg);
      load();
      return true;
    } catch (e) {
      notify(e.message, 'error');
      return false;
    }
  };

  const convert = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/api/companies/${id}/convert`, { method: 'POST', body: conv.email ? conv : {} });
      notify(`${r.company.name} is now an account`);
      if (r.clientLogin) setShared({ email: r.clientLogin.email, password: conv.password });
      setConv(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const saveLogin = async (e) => {
    e.preventDefault();
    try {
      const u = await api(`/api/companies/${id}/client-login`, { method: 'PUT', body: conv });
      if (conv.password) setShared({ email: u.email, password: conv.password });
      notify('Client login saved');
      setConv(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  if (!d || !info) return <div className="pl-overlay"><div className="pl-panel"><p className="muted">Loading…</p></div></div>;
  const c = d.company;
  const team = [...new Set([...d.team, ...c.tasks.map((t) => t.member)].filter(Boolean))];

  return (
    <div className="pl-overlay" onClick={onClose}>
      <div className="pl-panel" onClick={(e) => e.stopPropagation()}>
        <div className="row pl-head">
          <div className="pl-title"><span className="pl-icon"><LuBuilding2 /></span><div><h2>{c.name}</h2><span className={`stage ${c.stage}`}>{STAGE[c.stage]}</span></div></div>
          <button className="btn ghost sm" onClick={onClose}><LuX /></button>
        </div>

        {shared && (
          <div className="pl-shared">
            <b>Client login — share this with the client (password is shown only now)</b>
            <div className="pl-cred"><span>Website</span><code>{window.location.origin}/login</code><span>Email</span><code>{shared.email}</code><span>Password</span><code>{shared.password}</code></div>
            <div className="row">
              <button className="btn soft sm" onClick={() => copy(`Geek CRM - your account\n${window.location.origin}/login\nEmail: ${shared.email}\nPassword: ${shared.password}`)}><LuCopy /> Copy</button>
              <button className="btn ghost sm" onClick={() => setShared(null)}>Done</button>
            </div>
          </div>
        )}

        {['cold', 'hot'].includes(c.stage) ? (
          <p className="pl-hint">A company becomes an account after it is an <b>Opportunity</b>. It moves forward on its own when people reply (1st reply → Hot lead, more replies → Opportunity), or change the stage below.</p>
        ) : c.stage === 'opportunity' ? (
          conv ? (
            <form className="pl-convertbox" onSubmit={convert}>
              <b><LuHandshake /> Convert {c.name} to an account</b>
              <p className="small muted">Optional: create a login for the client so they can see the work your team is doing for them. Leave email empty to skip.</p>
              <div className="pl-grid">
                <label className="field">Client name<input value={conv.name} onChange={(e) => setConv({ ...conv, name: e.target.value })} /></label>
                <label className="field">Login email<input type="email" value={conv.email} onChange={(e) => setConv({ ...conv, email: e.target.value })} placeholder="client@brand.com" /></label>
                <label className="field pl-wide">Password
                  <span className="pl-inputlink"><input minLength={8} value={conv.password} onChange={(e) => setConv({ ...conv, password: e.target.value })} /><button type="button" className="btn ghost sm" onClick={() => setConv({ ...conv, password: makePassword() })}>New</button></span>
                </label>
              </div>
              <div className="row"><button className="btn sm"><LuHandshake /> Convert to account</button><button type="button" className="btn ghost sm" onClick={() => setConv(null)}>Cancel</button></div>
            </form>
          ) : (
            <button className="btn pl-convertbtn" onClick={() => setConv({ name: d.contacts[0]?.name || c.name, email: d.contacts.find((p) => p.email)?.email || '', password: makePassword() })}><LuHandshake /> Convert to account</button>
          )
        ) : (
          <div className="pl-login">
            <b><LuKeyRound /> Client login</b>
            {conv ? (
              <form className="pl-grid" onSubmit={saveLogin}>
                <label className="field">Client name<input value={conv.name} onChange={(e) => setConv({ ...conv, name: e.target.value })} /></label>
                <label className="field">Login email<input type="email" required value={conv.email} onChange={(e) => setConv({ ...conv, email: e.target.value })} /></label>
                <label className="field pl-wide">{d.clientLogin ? 'New password (empty = keep the old one)' : 'Password'}
                  <span className="pl-inputlink"><input minLength={8} required={!d.clientLogin} value={conv.password} onChange={(e) => setConv({ ...conv, password: e.target.value })} /><button type="button" className="btn ghost sm" onClick={() => setConv({ ...conv, password: makePassword() })}>New</button></span>
                </label>
                <div className="row pl-wide"><button className="btn sm">Save login</button><button type="button" className="btn ghost sm" onClick={() => setConv(null)}>Cancel</button></div>
              </form>
            ) : d.clientLogin ? (
              <div className="row pl-loginrow">
                <span>{d.clientLogin.email} · {d.clientLogin.lastLoginAt ? `last login ${date(d.clientLogin.lastLoginAt)}` : 'never logged in'}</span>
                <span className="row">
                  <button className="btn ghost sm" onClick={() => setConv({ name: d.clientLogin.name, email: d.clientLogin.email, password: makePassword() })}>Reset password</button>
                  <button className="btn ghost sm pl-danger" onClick={() => window.confirm('Remove the client login? They will not be able to log in.') && call('/client-login', 'DELETE', undefined, 'Client login removed')}>Remove login</button>
                </span>
              </div>
            ) : (
              <button className="btn soft sm" onClick={() => setConv({ name: d.contacts[0]?.name || c.name, email: d.contacts.find((p) => p.email)?.email || '', password: makePassword() })}>Create client login</button>
            )}
          </div>
        )}

        <form className="pl-grid" onSubmit={(e) => { e.preventDefault(); call('', 'PUT', info, 'Saved'); }}>
          <label className="field">Name<input value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} /></label>
          <label className="field">Stage
            <select value={info.stage} onChange={(e) => setInfo({ ...info, stage: e.target.value })}>
              {STAGES.map(([k, v]) => <option key={k} value={k} disabled={k === 'account' && c.stage !== 'account'}>{v}{k === 'account' && c.stage !== 'account' ? ' (use Convert)' : ''}</option>)}
            </select>
          </label>
          {INFO.map(([k, l]) => (
            <label className="field" key={k}>{l}
              <span className="pl-inputlink">
                <input value={info[k]} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} />
                {isUrl(info[k]) && <a href={info[k]} target="_blank" rel="noopener noreferrer" title="Open"><LuExternalLink /></a>}
              </span>
            </label>
          ))}
          <label className="field pl-wide">Notes<textarea rows={4} value={info.notes} onChange={(e) => setInfo({ ...info, notes: e.target.value })} /></label>
          <div className="pl-wide"><button className="btn sm">Save details</button></div>
        </form>

        <h3>People ({d.contacts.length})</h3>
        {d.contacts.length === 0 && <p className="muted small">No contact points yet.</p>}
        {d.contacts.map((p) => (
          <div key={p._id} className="pl-person">
            <div>
              <b>{p.name || p.email}</b>{p.title && <span className="muted"> · {p.title}</span>}
              <small>{[p.email, p.phone].filter(Boolean).join(' · ') || 'no email / phone'}</small>
              {p.referredBy && <small className="pl-ref">Referred by {p.referredBy}</small>}
              <small>{p.sent ? `${p.sent} email(s) sent · last ${date(p.lastSentAt)}` : 'Not emailed yet'}{p.linkedin && <> · <a href={p.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a></>}</small>
            </div>
            <div className="row">
              <span className={`badge ${p.status}`}>{p.status}</span>
              <button className="btn ghost sm" title="Remove from this company" onClick={() => window.confirm(`Remove ${p.name || p.email} from ${c.name}? (they stay in Contacts)`) && call(`/members/${p._id}`, 'DELETE', undefined, 'Removed')}><LuX /></button>
            </div>
          </div>
        ))}
        {member ? (
          <form className="pl-grid pl-member" onSubmit={async (e) => { e.preventDefault(); if (await call('/members', 'POST', member, 'Member added')) setMember(null); }}>
            {Object.keys(EMPTY_MEMBER).map((k) => (
              <label className="field" key={k}>{k === 'title' ? 'Designation' : k === 'linkedin' ? 'LinkedIn' : k[0].toUpperCase() + k.slice(1)}
                <input type={k === 'email' ? 'email' : 'text'} value={member[k]} onChange={(e) => setMember({ ...member, [k]: e.target.value })} />
              </label>
            ))}
            <div className="pl-wide row"><button className="btn sm">Add member</button><button type="button" className="btn ghost sm" onClick={() => setMember(null)}>Cancel</button></div>
          </form>
        ) : (
          <button className="btn soft sm pl-addbtn" onClick={() => setMember(EMPTY_MEMBER)}><LuUserPlus /> Add member</button>
        )}

        {['account', 'old_client'].includes(c.stage) ? (
          <>
            <h3>Team on this account <Link href="/team" className="pl-teamlink">Manage team →</Link></h3>
            <div className="pl-chips">
              {(c.team || []).length === 0 && <span className="muted small">Nobody yet — add the people who will work on {c.name}.</span>}
              {(c.team || []).map((m) => (
                <span key={m} className="pl-chip">{m}<button title={`Remove ${m}`} onClick={() => call('/team', 'PUT', { team: c.team.filter((x) => x !== m) })}><LuX /></button></span>
              ))}
              {d.team.filter((m) => !(c.team || []).includes(m)).length > 0 && (
                <select className="pl-addmember" value="" onChange={(e) => e.target.value && call('/team', 'PUT', { team: [...(c.team || []), e.target.value] }, `${e.target.value} added`)}>
                  <option value="">+ Add team member</option>
                  {d.team.filter((m) => !(c.team || []).includes(m)).map((m) => <option key={m}>{m}</option>)}
                </select>
              )}
              {d.team.length === 0 && <Link href="/team" className="btn soft sm">Add your team first</Link>}
            </div>

            <h3>Tasks ({c.tasks.filter((t) => !t.done).length} open)</h3>
            {c.tasks.length === 0 && <p className="muted small">No tasks yet. Write what each person has to do.</p>}
            {c.tasks.map((t) => (
              <div key={t._id} className={`pl-task ${t.done ? 'done' : ''}`}>
                <input type="checkbox" checked={t.done} onChange={(e) => call(`/tasks/${t._id}`, 'PUT', { done: e.target.checked })} />
                <div>
                  <b>{t.member}</b>
                  <p>{t.task}</p>
                  <small>{date(t.updatedAt)}</small>
                </div>
                <button className="btn ghost sm" title="Delete task" onClick={() => call(`/tasks/${t._id}`, 'DELETE')}><LuTrash2 /></button>
              </div>
            ))}
            <form className="row pl-taskform" onSubmit={async (e) => { e.preventDefault(); if (await call('/tasks', 'POST', task, 'Task assigned')) setTask({ member: task.member, task: '' }); }}>
              <select required value={task.member} onChange={(e) => setTask({ ...task, member: e.target.value })}>
                <option value="">{(c.team || []).length ? 'Assign to…' : 'Add a team member first'}</option>
                {(c.team || []).map((m) => <option key={m}>{m}</option>)}
              </select>
              <input required placeholder="What needs to be done?" value={task.task} onChange={(e) => setTask({ ...task, task: e.target.value })} />
              <button className="btn sm" disabled={!(c.team || []).length}><LuPlus /> Assign</button>
            </form>

            <h3>Messages</h3>
            <Messages list={c.messages || []} onSend={(text) => call('/messages', 'POST', { text })} hint="Visible to the team on this account and to the client." />
          </>
        ) : (
          <p className="pl-hint">Team, tasks and messages open once this company is converted to an account.</p>
        )}

        {c.fields?.length > 0 && (
          <details className="pl-all">
            <summary>Original sheet row ({c.fields.length})</summary>
            <dl>{c.fields.map((f, i) => <div key={i}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}</dl>
          </details>
        )}
        <div className="row pl-foot">
          <Link className="btn ghost sm" href={`/contacts`}>All contacts</Link>
          <button className="btn ghost sm pl-danger" onClick={() => window.confirm(`Delete ${c.name}? People stay in Contacts.`) && call('', 'DELETE', undefined, 'Company deleted').then((ok) => ok && onClose())}><LuTrash2 /> Delete company</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- conversation on an account (admin, team, client) ---------- */
function Messages({ list, onSend, hint }) {
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
    <div className="pl-msgs">
      {list.length === 0 && <p className="muted small">No messages yet. {hint}</p>}
      {list.map((m) => (
        <div key={m._id} className={`pl-msg ${m.role}`}>
          <div className="pl-msghead"><b>{m.author}</b><span>{m.role === 'client' ? 'Client' : m.role === 'team' ? 'Team' : 'Admin'} · {new Date(m.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></div>
          <p>{m.text}</p>
        </div>
      ))}
      <form className="pl-msgform" onSubmit={send}>
        <textarea rows={2} placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }} />
        <button className="btn sm" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

const css = `
.pl-ref { color: #0b87a5; font-weight: 600; }
.pl-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pl-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--c-100); color: var(--c-700); font-weight: 600; font-size: 13px; padding: 5px 6px 5px 12px; border-radius: 99px; }
.pl-chip button { border: 0; background: none; color: inherit; cursor: pointer; display: grid; place-items: center; padding: 2px; border-radius: 50%; }
.pl-chip button:hover { background: rgba(255,255,255,.7); }
.pl-addmember { width: auto; padding: 5px 10px; font-size: 13px; border-radius: 99px; }
.pl-msgs { display: flex; flex-direction: column; gap: 8px; }
.pl-msg { background: #fff; border: 1px solid rgba(148,163,184,.22); border-radius: 14px; padding: 10px 12px; font-size: 13.5px; }
.pl-msg.client { border-left: 3px solid #16a34a; }
.pl-msg.team { border-left: 3px solid #f59e0b; }
.pl-msg.admin { border-left: 3px solid var(--c); }
.pl-msghead { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.pl-msghead span { font-size: 11.5px; color: #94a3b8; }
.pl-msg p { white-space: pre-wrap; }
.pl-msgform { display: flex; gap: 8px; align-items: flex-end; }
.pl-msgform textarea { flex: 1; }
.pl-form { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; align-items: end; }
.pl-form .row { grid-column: 1 / -1; }
.pl-stages { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
.pl-stages button { border: 1px solid rgba(50,193,223,.2); background: rgba(255,255,255,.65); border-radius: 16px; padding: 12px 14px; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font: inherit; color: #334155; transition: all .15s; }
.pl-stages button span { font-size: 12.5px; color: #64748b; }
.pl-stages button b { font-size: 22px; }
.pl-stages button:hover { border-color: var(--c); }
.pl-stages button.on { background: linear-gradient(150deg, #5fd3eb, #32c1df 55%, #1aa9c8); color: #fff; border-color: transparent; box-shadow: 0 10px 24px rgba(50,193,223,.3); }
.pl-stages button.on span { color: rgba(255,255,255,.9); }
.pl-filters { margin-bottom: 14px; gap: 10px; flex-wrap: wrap; justify-content: space-between; }
.pl-filters input { flex: 1; min-width: 220px; }
.pl-filters select { width: auto; min-width: 160px; }
.pl-name { background: none; border: 0; text-align: left; cursor: pointer; }
.pl-name b { display: block; }
.pl-name:hover b { color: var(--c-700); }
.pl-name small { color: #64748b; font-size: 12px; }
.pl-stage { width: auto; padding: 5px 8px; font-size: 12.5px; border-radius: 99px; }
.pl-stage.s-cold { background: #eef2ff; color: #4f46e5; }
.pl-stage.s-hot { background: #fff1e6; color: #c2410c; }
.pl-stage.s-opportunity { background: #fef9c3; color: #a16207; }
.pl-stage.s-account { background: #dcfce7; color: #15803d; }
.stage { display: inline-flex; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 99px; background: #f1f5f9; color: #475569; }
.stage.cold { background: #eef2ff; color: #4f46e5; }
.stage.hot { background: #fff1e6; color: #c2410c; }
.stage.opportunity { background: #fef9c3; color: #a16207; }
.stage.account { background: #dcfce7; color: #15803d; }
.pl-pager { justify-content: center; margin-top: 14px; }
.pl-overlay { position: fixed; inset: 0; background: rgba(14,42,51,.2); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); z-index: 40; display: flex; justify-content: flex-end; }
.pl-panel { background: rgba(255,255,255,.92); backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%); box-shadow: -20px 0 60px rgba(30,41,99,.15); width: 620px; max-width: 100%; height: 100%; overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 10px; }
.pl-head { justify-content: space-between; flex-wrap: nowrap; align-items: flex-start; }
.pl-title { display: flex; gap: 12px; align-items: center; }
.pl-title h2 { margin-bottom: 4px; }
.pl-icon { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; background: linear-gradient(150deg, #5fd3eb, #32c1df 55%, #1aa9c8); color: #fff; font-size: 20px; flex-shrink: 0; }
.pl-panel h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; margin-top: 12px; }
.pl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pl-wide { grid-column: 1 / -1; }
.pl-member { grid-template-columns: 1fr 1fr; background: rgba(50,193,223,.05); border: 1px solid rgba(50,193,223,.2); border-radius: 14px; padding: 12px; }
.pl-inputlink { display: flex; gap: 6px; align-items: center; }
.pl-inputlink a { color: var(--c-700); }
.pl-person { display: flex; justify-content: space-between; gap: 10px; align-items: center; background: rgba(255,255,255,.65); border: 1px solid rgba(148,163,184,.22); border-radius: 14px; padding: 10px 12px; font-size: 13.5px; }
.pl-person small { display: block; color: #64748b; font-size: 12px; }
.pl-person a { color: var(--c-700); }
.pl-person .row { flex-wrap: nowrap; gap: 4px; }
.pl-addbtn { align-self: flex-start; }
.pl-task { display: flex; gap: 10px; align-items: flex-start; background: rgba(255,255,255,.65); border: 1px solid rgba(148,163,184,.22); border-radius: 14px; padding: 10px 12px; font-size: 13.5px; }
.pl-task input { width: auto; margin-top: 3px; }
.pl-task > div { flex: 1; }
.pl-task p { white-space: pre-wrap; margin-top: 2px; }
.pl-task small { color: #94a3b8; font-size: 11.5px; }
.pl-task.done { opacity: .55; }
.pl-task.done p { text-decoration: line-through; }
.pl-taskform { gap: 8px; flex-wrap: nowrap; }
.pl-taskform select { width: 150px; flex-shrink: 0; }
.pl-taskform input { flex: 1; }
.pl-all summary { cursor: pointer; font-size: 13px; font-weight: 700; color: var(--c-700); margin-top: 10px; }
.pl-all dl { display: grid; gap: 4px; font-size: 13px; margin-top: 8px; }
.pl-all dl div { display: grid; grid-template-columns: 160px 1fr; gap: 10px; }
.pl-all dt { color: #64748b; }
.pl-all dd { white-space: pre-wrap; word-break: break-word; }
.pl-foot { justify-content: space-between; margin-top: 14px; }
.pl-danger { color: #e11d48; }
.pl-hint { font-size: 13px; color: #475569; background: rgba(148,163,184,.1); border-radius: 12px; padding: 10px 12px; }
.pl-convert { margin-left: 6px; border: 1px solid rgba(22,163,74,.25); background: #f0fdf4; color: #15803d; border-radius: 99px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.pl-convert:hover { background: #dcfce7; }
.pl-convertbtn { align-self: flex-start; background: linear-gradient(150deg, #34d399, #16a34a); border-color: transparent; }
.pl-convertbox, .pl-login, .pl-shared { border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; font-size: 13.5px; }
.pl-convertbox { background: #f0fdf4; border: 1px solid rgba(22,163,74,.25); }
.pl-convertbox b, .pl-login b { display: flex; align-items: center; gap: 6px; }
.pl-login { background: rgba(50,193,223,.06); border: 1px solid rgba(50,193,223,.22); }
.pl-loginrow { justify-content: space-between; gap: 8px; }
.pl-shared { background: #fffbeb; border: 1px solid rgba(245,158,11,.35); }
.pl-cred { display: grid; grid-template-columns: 90px 1fr; gap: 4px 10px; background: #fff; border-radius: 10px; padding: 10px 12px; }
.pl-cred span { color: #64748b; }
.pl-cred code { font-size: 13px; word-break: break-all; }
.pl-teamlink { font-size: 12px; text-transform: none; letter-spacing: 0; color: var(--c-700); margin-left: 8px; font-weight: 600; }
.pl-group { margin-bottom: 16px; }
.pl-group h3 { font-size: 14px; margin-bottom: 8px; }
.pl-group .pl-task { margin-bottom: 8px; }
.pl-link { background: none; border: 0; padding: 0; font: inherit; font-weight: 700; cursor: pointer; color: #0f172a; }
.pl-link:hover { color: var(--c-700); }
.pl-check { display: flex; gap: 6px; align-items: center; font-size: 13px; }
.pl-check input { width: auto; }
@media (max-width: 1000px) { .pl-stages { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 700px) {
  .pl-stages { grid-template-columns: repeat(2, 1fr); }
  .pl-form, .pl-grid, .pl-member { grid-template-columns: 1fr; }
  .pl-taskform { flex-wrap: wrap; }
  .pl-taskform select { width: 100%; }
}
`;
