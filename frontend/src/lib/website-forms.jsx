'use client';
// Website forms (client / career / creator / partner-vendor) from geekcreativeagency.com.
// Used by the admin pages (Website Leads, Job Applications, Creators, Partners) and by the employee portal
// ("Website forms": only the forms the admin gave that employee). Looks right in both themes:
// admin (blue) and employee portal (warm, via body.emp-theme). Self-contained styles.
import { useCallback, useEffect, useState } from 'react';
import { LuChevronDown, LuChevronUp, LuFileText, LuGlobe, LuMail, LuPhone, LuSearch, LuTrash2 } from 'react-icons/lu';
import { api, date, notify } from '@/lib/api';
import { ConfirmDialog, openFile, sizeOf } from '@/lib/hr';

const LONG = new Set(['goal', 'links', 'why', 'about']);
const SUBJECT = { client: 'Your enquiry with Geek Creative Agency', creator: 'Creating with Geek', career: 'Your application to Geek', vendor: 'Partnering with Geek' };
const OWNER_HINT = {
  career: 'gets a task for every new application and sees them in their portal',
  creator: 'gets a task for every new creator form and sees them in their portal',
  vendor: 'gets a task for every new partner form and sees them in their portal',
};
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
// the short line under a name: the most useful field of each form
const subline = (l) => [l.designation, l.company, l.fields.find((x) => ['position', 'instagram', 'service'].includes(x.k))?.v, l.fields.find((x) => x.k === 'followers')?.v && `${l.fields.find((x) => x.k === 'followers').v} followers`].filter(Boolean).join(' · ') || l.email;

/** the admin picks the employee who handles this form */
function OwnerPicker({ form, owner, onSaved }) {
  const [team, setTeam] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/website-leads/owners').then((r) => setTeam(r.team)).catch(() => setTeam([]));
  }, []);
  const save = async (v) => {
    setBusy(true);
    try {
      await api('/api/website-leads/owners', { method: 'PUT', body: { [form]: v } });
      notify(v ? 'Saved. Open entries were handed over too.' : 'Nobody handles this form now');
      onSaved();
    } catch (e) {
      notify(e.message, 'error');
    }
    setBusy(false);
  };
  return (
    <div className="wf-owner">
      <label>
        <span>Handled by</span>
        <select value={owner?.id || ''} disabled={busy || !team} onChange={(e) => save(e.target.value)}>
          <option value="">Only the admin</option>
          {(team || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
        </select>
      </label>
      <small>{owner?.id ? `${owner.name || 'This employee'} ${OWNER_HINT[form]}.` : 'Choose an employee: they get a task for each new form and see the list in their portal.'}</small>
    </div>
  );
}

/**
 * form: 'client' | 'career' | 'creator' | 'vendor'
 * title / intro: page heading (admin pages). bare: no heading (inside the employee portal).
 */
export default function WebsiteForms({ form, title, intro, bare = false }) {
  const [d, setD] = useState(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null);

  const load = useCallback(
    () => api('/api/website-leads', { query: { form, status, q } }).then(setD).catch((e) => notify(e.message, 'error')),
    [form, status, q]
  );
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => {
    const t = setInterval(load, 30000); // new forms show up without a refresh
    return () => clearInterval(t);
  }, [load]);

  const update = (lead) => setD((x) => (x ? { ...x, list: x.list.map((l) => (l._id === lead._id ? lead : l)) } : x));
  const setLeadStatus = async (l, s) => {
    try {
      update(await api(`/api/website-leads/${l._id}`, { method: 'PUT', body: { status: s } }));
      notify('Status saved');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const addNote = async (e, l) => {
    e.preventDefault();
    if (!note.trim() || busy) return;
    setBusy(true);
    try {
      update(await api(`/api/website-leads/${l._id}/notes`, { method: 'POST', body: { text: note } }));
      setNote('');
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };
  const delNote = (l, n) => api(`/api/website-leads/${l._id}/notes/${n._id}`, { method: 'DELETE' }).then(update).catch((e) => notify(e.message, 'error'));
  const remove = (l) => setAsk({
    title: `Delete the ${l.formLabel.toLowerCase()} form from ${l.name || l.email}?`,
    text: l.form === 'client' ? 'It is removed from this list only. The company and the contact stay in Pipeline and Contacts.' : 'It is removed from this list, with its resume and open task if it has them.',
    confirm: 'Yes, delete',
    danger: true,
    run: async () => {
      await api(`/api/website-leads/${l._id}`, { method: 'DELETE' });
      setOpen(null);
      load();
    },
  });

  return (
    <div className="wf">
      <style>{css}</style>
      {!bare && (
        <div className="wf-title">
          <h1>{title}</h1>
          {intro && <p>{intro}</p>}
        </div>
      )}
      {!d ? (
        <p className="wf-muted">Loading…</p>
      ) : (
        <>
          {d.isAdmin && !d.ready && (
            <div className="wf-card wf-warn">
              <b>Not connected yet.</b>
              <span>Add the same WEBSITE_LEAD_SECRET to the CRM backend .env and to the website .env (with CRM_LEAD_URL), then restart both.</span>
            </div>
          )}
          {d.isAdmin && d.owner && <OwnerPicker form={form} owner={d.owner} onSaved={load} />}

          <div className="wf-card">
            <div className="wf-bar">
              <div className="wf-tabs">
                <button className={status === '' ? 'on' : ''} onClick={() => setStatus('')}>All ({d.counts.all})</button>
                {d.statuses.map((s) => (
                  <button key={s.key} className={status === s.key ? 'on' : ''} onClick={() => setStatus(s.key)}>{s.label} ({d.counts[s.key]})</button>
                ))}
              </div>
              <label className="wf-search"><LuSearch /><input placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            </div>

            {d.list.length === 0 && <p className="wf-empty">{q || status ? 'Nothing matches.' : 'Nothing yet. New forms from the website appear here on their own.'}</p>}
            {d.list.map((l) => {
              const isOpen = open === l._id;
              return (
                <div key={l._id} className={`wf-item s-${l.status}`}>
                  <button type="button" className="wf-head" onClick={() => { setOpen(isOpen ? null : l._id); setNote(''); }} aria-expanded={isOpen}>
                    <div className="wf-who">
                      <b>{l.name || l.email}</b>
                      <small>{subline(l)}</small>
                    </div>
                    <div className="wf-tags">
                      {l.budget && <span className="wf-chip">{l.budget}</span>}
                      {l.resume && <span className="wf-chip">Resume</span>}
                      {l.times > 1 && <span className="wf-chip">Sent {l.times} times</span>}
                      <span className={`wf-status ${l.status}`}>{l.statusLabel}</span>
                      <small className="wf-muted">{when(l.lastAt)}</small>
                      {isOpen ? <LuChevronUp /> : <LuChevronDown />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="wf-body">
                      <div className="wf-contact">
                        <a href={`mailto:${l.email}?subject=${encodeURIComponent(SUBJECT[l.form] || SUBJECT.client)}`}><LuMail /> {l.email}</a>
                        {l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}><LuPhone /> {l.phone}</a>}
                        {l.page && <a href={l.page} target="_blank" rel="noreferrer"><LuGlobe /> Form page</a>}
                        {l.resume && <button type="button" className="wf-link" onClick={() => openFile(l.resume)}><LuFileText /> {l.resume.name} ({sizeOf(l.resume.size)})</button>}
                      </div>
                      <dl className="wf-grid">
                        {(l.company || l.form === 'client' || l.form === 'vendor') && <div><dt>Company</dt><dd>{l.company || '—'}</dd></div>}
                        {l.fields.filter((x) => !LONG.has(x.k)).map((x) => <div key={x.k}><dt>{x.label}</dt><dd>{x.v}</dd></div>)}
                        <div><dt>First sent</dt><dd>{date(l.createdAt)}</dd></div>
                        {l.form === 'client' && !l.companyId && <div><dt>Pipeline</dt><dd>Not added</dd></div>}
                      </dl>
                      {l.fields.filter((x) => LONG.has(x.k)).map((x) => <div key={x.k} className="wf-long"><dt>{x.label}</dt><p>{x.v}</p></div>)}

                      {l.submissions.length > 1 && (
                        <details className="wf-subs">
                          <summary>Every time the form was sent ({l.submissions.length})</summary>
                          {[...l.submissions].reverse().map((s, i) => {
                            const short = s.fields?.length ? s.fields.filter((x) => !LONG.has(x.k)).map((x) => x.v) : [s.company, s.budget, s.timeline];
                            const long = s.fields?.length ? s.fields.filter((x) => LONG.has(x.k)).map((x) => x.v).join('\n\n') : s.goal;
                            return (
                              <div key={i} className="wf-sub">
                                <small className="wf-muted">{when(s.at)}</small>
                                <span>{short.filter(Boolean).join(' · ')}</span>
                                {long && <p>{long}</p>}
                              </div>
                            );
                          })}
                        </details>
                      )}

                      <div className="wf-row">
                        <label className="wf-field">Status
                          <select value={l.status} onChange={(e) => setLeadStatus(l, e.target.value)}>
                            {d.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </label>
                        {l.form === 'client' && d.isAdmin && l.companyId && <a className="wf-btn ghost" href={`/lead?company=${l.companyId}${l.status === 'opportunity' ? '&convert=1' : ''}`}>{l.status === 'opportunity' ? 'Convert to account' : 'Open the lead page'}</a>}
                        {d.isAdmin && <button type="button" className="wf-btn red" onClick={() => remove(l)}><LuTrash2 /> Delete</button>}
                      </div>

                      <div className="wf-notes">
                        <h3>Notes</h3>
                        {l.notes.length === 0 && <p className="wf-muted">No notes yet.</p>}
                        {[...l.notes].reverse().map((n) => (
                          <div key={n._id} className="wf-note">
                            <div><b>{n.by}</b> <small className="wf-muted">{when(n.at)}</small><p>{n.text}</p></div>
                            {!['Website', 'CRM'].includes(n.by) && (d.isAdmin || n.by !== 'Admin') && <button type="button" className="wf-x" onClick={() => delNote(l, n)} aria-label="Delete note">×</button>}
                          </div>
                        ))}
                        <form className="wf-add" onSubmit={(e) => addNote(e, l)}>
                          <input maxLength={2000} placeholder="Add a note (called, interview booked, sent rates…)" value={note} onChange={(e) => setNote(e.target.value)} />
                          <button className="wf-btn" disabled={!note.trim() || busy}>{busy ? 'Saving…' : 'Add'}</button>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />
    </div>
  );
}

const css = `
.wf { --a: #1aa9c8; --a2: #4fcde7; --ad: #0b87a5; --soft: #e0f7fc; --ink: #0f2a33; --muted: #64748b; --card: rgba(255,255,255,.8); --line: rgba(148,163,184,.25); --btn: linear-gradient(150deg, var(--a2), var(--a)); display: flex; flex-direction: column; gap: 14px; color: var(--ink); min-width: 0; }
body.emp-theme .wf { --a: #c27c4f; --a2: #dfa47a; --ad: #9a5a33; --soft: #f3dfcf; --ink: #26221f; --muted: #8c847d; --card: rgba(255,255,255,.6); --line: rgba(120,90,60,.16); --btn: #26221f; }
.wf-title h1 { margin: 0; font-size: 26px; letter-spacing: -.02em; }
.wf-title p { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
.wf-muted { color: var(--muted); font-size: 13px; margin: 0; }
.wf-card { background: var(--card); border: 1px solid rgba(255,255,255,.85); border-radius: 22px; padding: 18px 20px; box-shadow: 0 12px 34px rgba(30,41,59,.06); min-width: 0; }
.wf-warn { display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(217,119,6,.3); background: #fffbeb; color: #92400e; }
.wf-owner { display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; background: var(--card); border: 1px solid rgba(255,255,255,.85); border-radius: 18px; padding: 12px 16px; }
.wf-owner label { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 13.5px; }
.wf-owner select { width: auto; min-width: 200px; }
.wf-owner small { color: var(--muted); font-size: 12.5px; flex: 1 1 260px; }
.wf select, .wf input { font: inherit; font-size: 14px; padding: 9px 11px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255,255,255,.9); color: var(--ink); min-width: 0; outline: none; }
.wf select:focus, .wf input:focus { border-color: var(--a); box-shadow: 0 0 0 3px var(--soft); }
.wf-bar { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
.wf-tabs { display: inline-flex; gap: 4px; padding: 4px; border-radius: 14px; background: rgba(255,255,255,.6); border: 1px solid var(--line); overflow-x: auto; max-width: 100%; scrollbar-width: none; }
.wf-tabs::-webkit-scrollbar { display: none; }
.wf-tabs button { background: none; border: 0; border-radius: 11px; padding: 7px 12px; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--muted); cursor: pointer; white-space: nowrap; }
.wf-tabs button.on { background: #fff; color: var(--ad); box-shadow: 0 2px 10px rgba(0,0,0,.08); }
.wf-search { position: relative; flex: 0 1 280px; min-width: 200px; }
.wf-search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); }
.wf-search input { width: 100%; padding-left: 36px; }
.wf-empty { text-align: center; padding: 34px 10px; color: var(--muted); margin: 0; }
.wf-item { border-bottom: 1px solid var(--line); }
.wf-item:last-child { border-bottom: 0; }
.wf-item.s-spam, .wf-item.s-closed, .wf-item.s-rejected, .wf-item.s-notfit, .wf-item.s-cold { opacity: .7; }
.wf-head { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 4px; background: none; border: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; flex-wrap: wrap; }
.wf-head:hover b { color: var(--ad); }
.wf-who { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 220px; }
.wf-who b, .wf-who small { overflow-wrap: anywhere; }
.wf-who small { color: var(--muted); font-size: 12.5px; }
.wf-tags { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.wf-chip { font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 99px; background: var(--soft); color: var(--ad); }
.wf-stage { font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 99px; background: #f1f5f9; color: #475569; }
.wf-stage.hot { background: #fff1e6; color: #c2410c; }
.wf-stage.opportunity { background: #fef9c3; color: #a16207; }
.wf-stage.account, .wf-stage.old_client { background: #dcfce7; color: #15803d; }
.wf-status { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 99px; background: #f1f5f9; color: #475569; }
.wf-status.new { background: #e0f2fe; color: #0369a1; }
.wf-status.contacted, .wf-status.shortlisted { background: #fef3c7; color: #a16207; }
.wf-status.interview { background: #ede9fe; color: #6d28d9; }
.wf-status.converted, .wf-status.hired, .wf-status.onboarded, .wf-status.partnered { background: #dcfce7; color: #15803d; }
.wf-status.spam, .wf-status.rejected { background: #ffe4e6; color: #be123c; }
.wf-status.hot { background: #fff1e6; color: #c2410c; }
.wf-status.opportunity { background: #fef9c3; color: #a16207; }
.wf-status.account, .wf-status.old_client { background: #dcfce7; color: #15803d; }
.wf-status.cold { background: #f1f5f9; color: #475569; }
.wf-body { padding: 4px 4px 18px; display: flex; flex-direction: column; gap: 14px; }
.wf-contact { display: flex; gap: 8px 18px; flex-wrap: wrap; }
.wf-contact a, .wf-link { display: inline-flex; align-items: center; gap: 6px; color: var(--ad); font-weight: 600; font-size: 13.5px; overflow-wrap: anywhere; text-decoration: none; }
.wf-link { background: none; border: 0; padding: 0; font: inherit; font-size: 13.5px; cursor: pointer; text-align: left; }
.wf-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0; }
.wf-grid > div, .wf-long { background: rgba(255,255,255,.65); border: 1px solid var(--line); border-radius: 12px; padding: 9px 12px; min-width: 0; margin: 0; }
.wf-grid dt, .wf-long dt { font-size: 11.5px; color: var(--muted); font-weight: 600; }
.wf-grid dd { margin: 2px 0 0; font-size: 13.5px; overflow-wrap: anywhere; }
.wf-long p { margin: 4px 0 0; white-space: pre-wrap; font-size: 13.5px; overflow-wrap: anywhere; }
.wf-subs summary { cursor: pointer; font-weight: 600; font-size: 13px; color: var(--ad); }
.wf-sub { padding: 8px 0; border-bottom: 1px dashed var(--line); display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.wf-sub p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.wf-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.wf-field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--muted); width: 200px; }
.wf-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid transparent; border-radius: 11px; padding: 8px 14px; font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; background: var(--btn); color: #fff; white-space: nowrap; text-decoration: none; }
.wf-btn.ghost { background: rgba(255,255,255,.85); color: var(--ink); border-color: var(--line); }
.wf-btn.red { background: #fff; color: #e11d48; border-color: rgba(225,29,72,.25); }
.wf-btn:disabled { opacity: .5; cursor: not-allowed; }
.wf-notes h3 { font-size: 14px; margin: 0 0 6px; }
.wf-note { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px dashed var(--line); font-size: 13.5px; }
.wf-note p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.wf-x { background: none; border: 0; color: var(--muted); font-size: 18px; cursor: pointer; line-height: 1; }
.wf-x:hover { color: #e11d48; }
.wf-add { display: flex; gap: 8px; margin-top: 10px; }
.wf-add input { flex: 1; }
@media (max-width: 700px) {
  .wf-card { padding: 14px; }
  .wf-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wf-tags { justify-content: flex-start; }
  .wf-search { flex: 1 1 100%; }
  .wf-field { width: 100%; }
}
`;

/** employee portal: the website forms the admin gave this employee (a tab for each form when there are several) */
export function TeamWebsiteForms({ forms }) {
  const [form, setForm] = useState(forms[0]?.key);
  if (!forms.length) return <p className="wf-muted">No website forms are given to you.</p>;
  return (
    <div className="wf wf-team">
      {forms.length > 1 && (
        <div className="wf-tabs wf-teamtabs">
          {forms.map((f) => <button key={f.key} className={form === f.key ? 'on' : ''} onClick={() => setForm(f.key)}>{f.label}{f.fresh ? ` (${f.fresh} new)` : ''}</button>)}
        </div>
      )}
      <WebsiteForms key={form} form={form} bare />
      <style>{css + '.wf-teamtabs { align-self: flex-start; }'}</style>
    </div>
  );
}
