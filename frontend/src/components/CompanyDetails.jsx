'use client';
// One company: stage, convert to account + client login, details, people, team tasks and messages.
// The same view everywhere: the lead page (inline) and the side panel.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LuBuilding2, LuCheck, LuCopy, LuExternalLink, LuHandshake, LuKeyRound, LuMail, LuPaperclip, LuPlus, LuTrash2, LuUserPlus, LuX } from 'react-icons/lu';
import { api, date, notify } from '@/lib/api';
import { label, Value } from '@/components/PersonDetails';
import { openFile, uploadFile } from '@/lib/hr';

// sheet columns about the person (shown on their own tab), not the company
const PERSON_COL = /^(dm[\s_]|email[\s_]|e-?mail$|name$|first[\s_]?name|last[\s_]?name|phone$|designation$)/i;

export const STAGES = [['cold', 'Cold lead'], ['hot', 'Hot lead'], ['opportunity', 'Opportunity'], ['account', 'Account'], ['old_client', 'Old client']];
export const STAGE = Object.fromEntries(STAGES);
const INFO = [['website', 'Website'], ['industry', 'Industry'], ['location', 'Location'], ['linkedin', 'Company LinkedIn']];
const HINT = { website: 'https://brand.com', linkedin: 'linkedin.com/company/…' };
const EMPTY_MEMBER = { name: '', email: '', phone: '', title: '', linkedin: '' };
const makePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const pick = new Uint32Array(12);
  crypto.getRandomValues(pick);
  return Array.from(pick, (n) => chars[n % chars.length]).join('').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
};
const copy = (text) => navigator.clipboard?.writeText(text).then(() => notify('Copied')).catch(() => {});
const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || '').trim());

/** company details that the people's uploaded sheets already have: shown in empty boxes (saved only with "Save details") */
const fromSheet = (contacts) => {
  const get = (names) => {
    for (const p of contacts) for (const f of p.fields || []) {
      const k = label(f.k).toLowerCase();
      const v = String(f.v ?? '').trim();
      if (names.includes(k) && v && !/^(none|n\/a|-|not verified|unknown)$/i.test(v)) return v;
    }
    return '';
  };
  const hq = get(['headcount evidence', 'headcount']).match(/\bHQ\s+([^()]+?)\s*(?:\(|$)/i)?.[1]?.replace(/[,\s]+$/, '') || '';
  const li = get(['linkedin url', 'company linkedin', 'company linkedin url', 'linkedin']);
  return {
    industry: get(['service category', 'industry', 'category', 'sector']),
    location: get(['location', 'city', 'hq', 'headquarters']) || hq,
    linkedin: /linkedin\.com\/company/i.test(li) ? li : '',
    website: get(['website', 'company website']),
  };
};

/* ---------- one company: details, people, team tasks ---------- */
export default function CompanyDetails({ id, onClose, convertFirst, inline = false, onPerson, onChanged }) {
  const [d, setD] = useState(null);
  const [info, setInfo] = useState(null);
  const [sheetKeys, setSheetKeys] = useState([]); // boxes filled from the sheet, not saved yet
  const [member, setMember] = useState(null);
  const [task, setTask] = useState({ member: '', task: '' });
  const [conv, setConv] = useState(null); // convert-to-account / client login form
  const [shared, setShared] = useState(null); // login details to give the client (shown once)
  const [busy, setBusy] = useState(false); // converting / saving the login (Bounty can take a few seconds)
  const [check, setCheck] = useState(null); // convert checklist: [{ label, done, file }]
  const [links, setLinks] = useState(null); // { crm, bounty } for the login message
  const [mailing, setMailing] = useState(false);
  useEffect(() => {
    if (!conv || check) return;
    api('/api/companies/convert/checklist')
      .then((r) => {
        setCheck(r.items.map((label) => ({ label, done: false, file: null })));
        setLinks(r.links);
      })
      .catch((e) => notify(e.message, 'error'));
  }, [conv, check]);
  const tick = (i, patch) => setCheck((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const attach = async (i, file) => {
    if (!file) return;
    tick(i, { uploading: true });
    try {
      const f = await uploadFile(file, undefined, undefined, undefined, id);
      tick(i, { file: { id: f.id, name: f.name }, done: true, uploading: false });
    } catch (e) {
      notify(e.message, 'error');
      tick(i, { uploading: false });
    }
  };
  const isEstimate = (x) => /estimate/i.test(x.label);
  const allTicked = Boolean(check?.length) && check.every((x) => x.done && (!isEstimate(x) || Number(x.amount) > 0));
  const loginText = (s) => {
    const crm = links?.crm || `${window.location.origin}/login`;
    return [`Geek Creative Agency - your account`, `Geek CRM: ${crm}`, ...(s.bounty ? [`Bounty brand dashboard: ${links?.bounty || 'https://bounty.geekcreativeagency.com/brands'}`] : []), `Email: ${s.email}`, `Password: ${s.password}`, ...(s.bounty ? ['The same email and password open both.'] : [])].join('\n');
  };
  const mailLogin = async () => {
    setMailing(true);
    try {
      const r = await api(`/api/companies/${id}/client-login/mail`, { method: 'POST', body: { password: shared.password } });
      notify(`Login emailed to ${r.to}`);
      setShared({ ...shared, mailedTo: r.to });
    } catch (e) {
      notify(e.message, 'error');
    }
    setMailing(false);
  };

  const load = useCallback(() => {
    api(`/api/companies/${id}`)
      .then((r) => {
        setD(r);
        if (convertFirst && r.company.stage === 'opportunity') setConv((v) => v || { name: r.contacts[0]?.name || r.company.name, email: r.contacts.find((p) => p.email)?.email || '', password: makePassword() });
        const sheet = fromSheet(r.contacts || []);
        const filled = INFO.map(([k]) => k).filter((k) => !r.company[k] && sheet[k]);
        setSheetKeys(filled);
        setInfo({ name: r.company.name, stage: r.company.stage, notes: r.company.notes || '', ...Object.fromEntries(INFO.map(([k]) => [k, r.company[k] || sheet[k] || ''])) });
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
      onChanged?.(); // e.g. a member added / removed: the lead page shows the new people list
      return true;
    } catch (e) {
      notify(e.message, 'error');
      return false;
    }
  };

  const convert = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (!allTicked) throw new Error('Tick everything on the checklist first');
      const checklist = check.map(({ label: l, done, file, amount }) => ({ label: l, done, file, amount: Number(amount) || undefined }));
      const r = await api(`/api/companies/${id}/convert`, { method: 'POST', body: { ...(conv.email ? conv : {}), checklist } });
      notify(`${r.company.name} is now an account`);
      if (r.links) setLinks(r.links);
      if (r.clientLogin?.password) setShared({ email: r.clientLogin.email, password: r.clientLogin.password, bounty: r.clientLogin.bounty });
      setConv(null);
      setCheck(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };
  const saveLogin = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body = d.bounty && d.clientLogin?.bounty ? { name: conv.name, email: conv.email, reset: Boolean(conv.reset) } : d.bounty && !d.clientLogin ? { name: conv.name, email: conv.email } : conv;
      const u = await api(`/api/companies/${id}/client-login`, { method: 'PUT', body });
      if (u.password) setShared({ email: u.email, password: u.password, bounty: u.bounty });
      notify('Client login saved');
      setConv(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };

  if (!d || !info) return inline ? <div className="pl-panel pl-inline"><style>{plCss}</style><p className="muted">Loading…</p></div> : <div className="pl-overlay"><style>{plCss}</style><div className="pl-panel"><p className="muted">Loading…</p></div></div>;
  const c = d.company;
  const team = [...new Set([...d.team, ...c.tasks.map((t) => t.member)].filter(Boolean))];

  return (
    <div className={inline ? 'pl-inline-wrap' : 'pl-overlay'} onClick={inline ? undefined : onClose}>
      <style>{plCss}</style>
      <div className={`pl-panel ${inline ? 'pl-inline' : ''}`} onClick={(e) => e.stopPropagation()}>
        {!inline && <div className="row pl-head">
          <div className="pl-title"><span className="pl-icon"><LuBuilding2 /></span><div><h2>{c.name}</h2><span className={`stage ${c.stage}`}>{STAGE[c.stage]}</span></div></div>
          <button className="btn ghost sm" onClick={onClose}><LuX /></button>
        </div>}

        {shared && (
          <div className="pl-shared">
            <b>Client login — share this with the client (password is shown only now)</b>
            {shared.bounty && <span className="small">The same email and password also open their Bounty brand account.</span>}
            <div className="pl-cred">
              <span>Geek CRM</span><code><a href={links?.crm || `${window.location.origin}/login`} target="_blank" rel="noopener noreferrer">{links?.crm || `${window.location.origin}/login`}</a></code>
              {shared.bounty && <><span>Bounty</span><code><a href={links?.bounty || 'https://bounty.geekcreativeagency.com/brands'} target="_blank" rel="noopener noreferrer">{links?.bounty || 'https://bounty.geekcreativeagency.com/brands'}</a></code></>}
              <span>Email</span><code>{shared.email}</code>
              <span>Password</span><code>{shared.password}</code>
            </div>
            {shared.mailedTo && <span className="small pl-mailed"><LuCheck /> Emailed to {shared.mailedTo}</span>}
            <div className="row">
              <button className="btn soft sm" onClick={() => copy(loginText(shared))}><LuCopy /> Copy</button>
              <button className="btn soft sm" disabled={mailing} onClick={mailLogin}><LuMail /> {mailing ? 'Sending…' : shared.mailedTo ? 'Mail it again' : `Mail it to ${shared.email}`}</button>
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
              <div className="pl-check">
                <b className="small">Checklist: tick everything before converting</b>
                {!check && <p className="small muted">Loading…</p>}
                {check?.map((x, i) => (
                  <div key={x.label} className={`pl-checkrow ${x.done ? 'done' : ''}`}>
                    <label><input type="checkbox" checked={x.done} onChange={(e) => tick(i, { done: e.target.checked })} /> {x.label}</label>
                    <span className="pl-checkfile">
                      {isEstimate(x) && (
                        <label className="pl-amount">₹<input type="number" min={1} inputMode="numeric" placeholder="Amount" value={x.amount || ''} onChange={(e) => tick(i, { amount: e.target.value, done: x.done || Number(e.target.value) > 0 })} /></label>
                      )}
                      {x.file ? <button type="button" className="pl-filelink" onClick={() => openFile(x.file)}><LuPaperclip /> {x.file.name}</button> : null}
                      <label className="btn ghost sm">
                        <LuPaperclip /> {x.uploading ? 'Uploading…' : x.file ? 'Change file' : 'Attach file'}
                        <input type="file" hidden disabled={x.uploading} onChange={(e) => attach(i, e.target.files?.[0])} />
                      </label>
                    </span>
                  </div>
                ))}
                {check && !allTicked && <p className="small muted">{check.filter((x) => !x.done).length ? `${check.filter((x) => !x.done).length} left. ` : ''}{check.some((x) => isEstimate(x) && !(Number(x.amount) > 0)) ? 'Enter the estimate amount (it becomes the deal value). ' : ''}A file is optional.</p>}
              </div>
              <p className="small muted">Optional: create a login for the client so they can see the work your team is doing for them. Leave email empty to skip.</p>
              <div className="pl-grid">
                <label className="field">Client name<input value={conv.name} onChange={(e) => setConv({ ...conv, name: e.target.value })} /></label>
                <label className="field">Login email<input type="email" value={conv.email} onChange={(e) => setConv({ ...conv, email: e.target.value })} placeholder="client@brand.com" /></label>
                {d.bounty ? (
                  <p className="small muted pl-wide">The login is made on Bounty too, with the same email. Bounty creates the password; you will see it once after converting.</p>
                ) : (
                  <label className="field pl-wide">Password
                    <span className="pl-inputlink"><input minLength={8} value={conv.password} onChange={(e) => setConv({ ...conv, password: e.target.value })} /><button type="button" className="btn ghost sm" onClick={() => setConv({ ...conv, password: makePassword() })}>New</button></span>
                  </label>
                )}
              </div>
              <p className="small muted">The estimate is done here, so the deal starts at the Purchase order step and its owner gets that task (see Deals → Step owners). An estimate file attached above is saved with the deal.</p>
              <div className="row"><button className="btn sm" disabled={busy || !allTicked} title={allTicked ? '' : 'Tick everything on the checklist first'}><LuHandshake /> {busy ? 'Converting…' : 'Convert to account'}</button><button type="button" className="btn ghost sm" onClick={() => { setConv(null); setCheck(null); }}>Cancel</button></div>
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
                {d.bounty && (!d.clientLogin || d.clientLogin.bounty) ? (
                  <p className="small muted pl-wide">{d.clientLogin ? (conv.reset ? 'Bounty will create a new password (shown once).' : 'Name only. Use "Reset password" for a new password.') : 'Made on Bounty too; Bounty creates the password (shown once).'}</p>
                ) : (
                  <label className="field pl-wide">{d.clientLogin ? 'New password (empty = keep the old one)' : 'Password'}
                    <span className="pl-inputlink"><input minLength={8} required={!d.clientLogin} value={conv.password} onChange={(e) => setConv({ ...conv, password: e.target.value })} /><button type="button" className="btn ghost sm" onClick={() => setConv({ ...conv, password: makePassword() })}>New</button></span>
                  </label>
                )}
                <div className="row pl-wide"><button className="btn sm" disabled={busy}>{busy ? 'Saving…' : 'Save login'}</button><button type="button" className="btn ghost sm" onClick={() => setConv(null)}>Cancel</button></div>
              </form>
            ) : d.clientLogin ? (
              <div className="row pl-loginrow">
                <span>{d.clientLogin.email} · {d.clientLogin.lastLoginAt ? `last login ${date(d.clientLogin.lastLoginAt)}` : 'never logged in'}</span>
                <span className="row">
                  <button className="btn ghost sm" onClick={() => setConv({ name: d.clientLogin.name, email: d.clientLogin.email, password: makePassword(), reset: true })}>Reset password</button>
                  <button className="btn ghost sm pl-danger" onClick={() => window.confirm('Remove the client login? They will not be able to log in.') && call('/client-login', 'DELETE', undefined, 'Client login removed')}>Remove login</button>
                </span>
              </div>
            ) : (
              <button className="btn soft sm" onClick={() => setConv({ name: d.contacts[0]?.name || c.name, email: d.contacts.find((p) => p.email)?.email || '', password: makePassword() })}>Create client login</button>
            )}
          </div>
        )}

        {c.onboarding?.items?.length > 0 && (
          <div className="pl-check pl-checkdone">
            <b className="small">Checklist when converted{c.onboarding.at ? ` · ${date(c.onboarding.at)}` : ''}</b>
            {c.onboarding.items.map((x) => (
              <div key={x.label} className="pl-checkrow done">
                <span><LuCheck /> {x.label}{x.amount ? ` · ₹${Number(x.amount).toLocaleString('en-IN')}` : ''}</span>
                {x.file?.id && <button type="button" className="pl-filelink" onClick={() => openFile(x.file)}><LuPaperclip /> {x.file.name}</button>}
              </div>
            ))}
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
            <label className="field" key={k}>
              <span>{l}{sheetKeys.includes(k) && <em className="pl-fromsheet">from the sheet · Save details to keep</em>}</span>
              <span className="pl-inputlink">
                <input value={info[k]} placeholder={HINT[k] || ''} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} />
                {isUrl(info[k]) && <a href={info[k]} target="_blank" rel="noopener noreferrer" title="Open"><LuExternalLink /></a>}
              </span>
            </label>
          ))}
          <label className="field pl-wide">Notes<textarea rows={4} value={info.notes} onChange={(e) => setInfo({ ...info, notes: e.target.value })} /></label>
          <div className="pl-wide row">
            <button className="btn sm">Save details</button>
            {sheetKeys.length > 0 && <span className="muted small">{sheetKeys.length} {sheetKeys.length === 1 ? 'box was' : 'boxes were'} filled from the sheet. Check and save.</span>}
          </div>
        </form>

        {(() => {
          // every company column from the people's uploaded sheets (same value once; different values all shown)
          const seen = new Map();
          d.contacts.forEach((p) => (p.fields || []).forEach((f) => {
            const v = String(f.v ?? '').trim();
            if (!v || /^(none|n\/a|-|not verified)$/i.test(v) || PERSON_COL.test(String(f.k).trim())) return;
            const k = label(f.k).toLowerCase();
            if (!seen.has(k)) seen.set(k, { k: label(f.k), vals: [] });
            if (!seen.get(k).vals.includes(v)) seen.get(k).vals.push(v);
          }));
          const rows = [...seen.values()];
          if (!rows.length) return null;
          return (
            <>
              <h3>From the sheet ({rows.length})</h3>
              <dl className="pl-sheet">
                {rows.map((r) => (
                  <div key={r.k} className="pl-sheetrow"><dt>{r.k}</dt><dd>{r.vals.map((v, i) => <div key={i}><Value v={v} /></div>)}</dd></div>
                ))}
              </dl>
            </>
          );
        })()}

        <h3>People ({d.contacts.length})</h3>
        {inline && d.contacts.length > 0 && <p className="muted small">Click a name to jump to their full details below.</p>}
        {d.contacts.length === 0 && <p className="muted small">No contact points yet.</p>}
        {d.contacts.map((p) => (
          <div key={p._id} className={`pl-person ${inline ? 'pl-person-compact' : ''}`}>
            <div>
              {onPerson ? <button type="button" className="pl-personlink" onClick={() => onPerson(p._id)}>{p.name || p.email}</button> : <b>{p.name || p.email}</b>}{p.title && <span className="muted"> · {p.title}</span>}
              {!inline && (
                <>
                  <small>{[p.email, p.phone].filter(Boolean).join(' · ') || 'no email / phone'}</small>
                  {p.referredBy && <small className="pl-ref">Referred by {p.referredBy}</small>}
                  <small>{p.sent ? `${p.sent} email(s) sent · last ${date(p.lastSentAt)}` : 'Not emailed yet'}{p.linkedin && <> · <a href={p.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a></>}</small>
                </>
              )}
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
            {d.deal && <Link className="btn soft sm pl-addbtn" href={`/deals?open=${d.deal._id}`}>Open deal (PO → payment → posts) →</Link>}
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
          {!inline && <Link className="btn ghost sm" href={`/lead?company=${id}`}>Open full page</Link>}
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

export const plCss = `
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

.pl-inline-wrap { display: block; }
.pl-check { align-self: stretch; width: 100%; box-sizing: border-box; text-align: left; align-items: stretch; display: flex; flex-direction: column; gap: 6px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px 14px; margin: 8px 0; }
.pl-checkrow { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
.pl-checkrow:last-of-type { border-bottom: 0; }
.pl-checkrow label:first-child, .pl-checkrow > span:first-child { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; color: #334155; }
.pl-checkrow.done label:first-child, .pl-checkrow.done > span:first-child { color: #15803d; }
.pl-checkrow input[type=checkbox] { width: 17px; height: 17px; accent-color: #16a34a; }
.pl-checkfile { display: inline-flex; align-items: center; gap: 8px; }
.pl-checkfile .btn { cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.pl-filelink { background: none; border: 0; padding: 0; font: inherit; font-size: 12.5px; color: var(--c-700); font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-checkdone { background: #f0fdf4; border-color: #bbf7d0; }
.pl-amount { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: #334155; }
.pl-amount input { width: 120px; padding: 6px 8px; }
.pl-mailed { color: #15803d; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }
.pl-cred a { color: var(--c-700); }
.pl-fromsheet { font-style: normal; font-size: 11px; font-weight: 600; color: #a16207; background: #fef9c3; border-radius: 99px; padding: 1px 8px; margin-left: 8px; }
.pl-sheet { margin: 0; border: 1px solid #e2e8f0; border-radius: 14px; padding: 6px 14px; }
.pl-sheetrow { display: grid; grid-template-columns: 190px 1fr; gap: 12px; padding: 7px 0; border-bottom: 1px solid #f1f5f9; font-size: 13.5px; }
.pl-sheetrow:last-child { border-bottom: 0; }
.pl-sheetrow dt { color: #64748b; text-transform: capitalize; }
.pl-sheetrow dd { margin: 0; color: #0f172a; white-space: pre-wrap; word-break: break-word; }
.pl-sheetrow dd a { color: var(--c-700); }
@media (max-width: 640px) { .pl-sheetrow { grid-template-columns: 1fr; gap: 2px; } }
.pl-panel.pl-inline { position: static; width: 100%; max-width: none; height: auto; overflow: visible; border-radius: 22px; box-shadow: 0 12px 34px rgba(30,41,59,.06); border: 1px solid rgba(255,255,255,.85); }
.pl-personlink { background: none; border: 0; padding: 0; font: inherit; font-weight: 700; color: var(--c-700); cursor: pointer; text-align: left; }
.pl-personlink:hover { text-decoration: underline; }
.pl-person.pl-person-compact { padding-top: 8px; padding-bottom: 8px; }
`;
