'use client';
// Contacts: every person with all their details (A to Z from the sheet), their company + pipeline stage,
// email status, and the full email history. Replied / unsubscribed / bounced people are never emailed again.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LuChevronLeft, LuChevronRight, LuExternalLink, LuFileSpreadsheet, LuPencil, LuUserPlus } from 'react-icons/lu';
import { api, date, num, notify, stepName } from '@/lib/api';

const TABS = ['', 'new', 'contacted', 'replied', 'unsubscribed', 'bounced'];
const STAGE = { cold: 'Cold lead', hot: 'Hot lead', opportunity: 'Opportunity', account: 'Account', old_client: 'Old client' };
const EMPTY = { name: '', email: '', company: '', title: '', phone: '', linkedin: '', stage: 'cold' };
const DETAILS = [
  ['title', 'Designation'], ['phone', 'Phone'], ['linkedin', 'LinkedIn'], ['website', 'Website'], ['industry', 'Industry'],
  ['location', 'Location'], ['signal', 'Buying signal'], ['referredBy', 'Referred by'], ['leadDate', 'Lead date'], ['source', 'Source'], ['batch', 'Upload'],
];
const EDITABLE = [
  ['name', 'Name'], ['email', 'Email'], ['company', 'Company'], ['title', 'Designation'], ['phone', 'Phone'], ['linkedin', 'LinkedIn'],
  ['website', 'Website'], ['industry', 'Industry'], ['location', 'Location'], ['signal', 'Buying signal'], ['referredBy', 'Referred by'], ['leadDate', 'Lead date'], ['notes', 'Notes'],
];
// columns from the uploaded sheets that already have their own column in the table
const CORE = /^(dm_)?(name|e-?mail|phone|mobile|title|designation|linkedin)$|^company(_| )?name$|^company$|^email_(subject|body)$|^(subject|body)(_\d+)?$/i;
// nicer column names (the CRM only sends emails, so "Email/Linkedin Sent Date" -> "Email Sent Date")
const label = (k) => String(k).replace(/\s*\/\s*linked\s*in(?=\s*sent)/i, '').replace(/_/g, ' ').trim();
const empty = (v) => !v || /^(none|n\/?a|-|null)$/i.test(String(v).trim());
const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || '').trim());
const Value = ({ v }) => (isUrl(v) ? <a href={v.trim()} target="_blank" rel="noopener noreferrer" className="ct-link">{v.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)} <LuExternalLink /></a> : <span>{v}</span>);

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(null); // contact details + history
  const [edit, setEdit] = useState(null);

  const load = useCallback(() => {
    api('/api/contacts', { query: { search, status, page } }).then(setData).catch((e) => notify(e.message, 'error'));
  }, [search, status, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/contacts', { method: 'POST', body: form });
      notify('Contact added');
      setForm(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const action = async (c, what) => {
    const who = c.email || c.name;
    const ask = { unsubscribe: `Unsubscribe ${who}? They will never be emailed again.`, delete: `Delete ${who}?` }[what];
    if (ask && !window.confirm(ask)) return;
    try {
      if (what === 'delete') await api(`/api/contacts/${c._id}`, { method: 'DELETE' });
      else await api(`/api/contacts/${c._id}/${what}`, { method: 'POST' });
      notify('Done');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const showDetails = (c) => {
    setEdit(null);
    api(`/api/contacts/${c._id}`).then(setOpen).catch((e) => notify(e.message, 'error'));
  };
  const startEdit = () => {
    const oc = open.contact;
    setEdit({ ...Object.fromEntries(EDITABLE.map(([k]) => [k, oc[k] || ''])), fields: (oc.fields || []).map((f) => ({ k: f.k, v: f.v })) });
  };
  const setField = (i, v) => setEdit({ ...edit, fields: edit.fields.map((f, j) => (j === i ? { ...f, v } : f)) });
  const saveEdit = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/contacts/${open.contact._id}`, { method: 'PUT', body: edit });
      notify('Saved');
      setEdit(null);
      showDetails(open.contact);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  // every other column found in the uploaded sheets on this page (A to Z)
  const extra = [];
  for (const c of data?.items || []) for (const f of c.fields || []) if (!CORE.test(f.k.trim()) && !extra.includes(f.k)) extra.push(f.k);
  const cellOf = (c, k) => (c.fields || []).find((f) => f.k === k)?.v;
  const oc = open?.contact;
  const company = oc?.companyId;

  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Contacts</h1>
          <p>Every person with all their details. Replied, unsubscribed and bounced contacts are never emailed again.</p>
        </div>
        <div className="row">
          <Link href="/import" className="btn ghost"><LuFileSpreadsheet /> Import file</Link>
          <button className="btn" onClick={() => setForm(EMPTY)}><LuUserPlus /> Add Contact</button>
        </div>
      </div>

      {form && (
        <form className="card ct-form" onSubmit={add}>
          {Object.keys(EMPTY).filter((k) => k !== 'stage').map((k) => (
            <label className="field" key={k}>
              {k === 'title' ? 'Designation' : k === 'linkedin' ? 'LinkedIn' : k[0].toUpperCase() + k.slice(1)} {k === 'email' && '*'}
              <input type={k === 'email' ? 'email' : 'text'} required={k === 'email'} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          <label className="field">
            Pipeline stage
            <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
              {Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="row">
            <button className="btn">Save</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="tabs">
          {TABS.map((s) => (
            <button key={s} className={status === s ? 'on' : ''} onClick={() => { setStatus(s); setPage(1); }}>
              {s || 'All'} <span className="ct-count">{num(s ? counts[s] : total)}</span>
            </button>
          ))}
        </div>
        <input className="ct-search" placeholder="Search name, email, company, designation, phone or city…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />

        {!data ? (
          <p className="muted">Loading…</p>
        ) : data.items.length === 0 ? (
          <p className="empty">No contacts found.</p>
        ) : (
          <div className="table-wrap ct-wide">
            <table className="cards">
              <thead>
                <tr>
                  <th className="ct-sticky">Name</th><th>Company</th><th>Phone</th><th>LinkedIn</th><th>Email status</th><th>Last emailed</th>
                  {extra.map((k) => <th key={k}>{label(k)}</th>)}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c._id}>
                    <td className="ct-sticky">
                      <button className="ct-name" onClick={() => showDetails(c)}>
                        <b>{c.name || c.email || '—'}</b>
                        {c.title && <small className="ct-title">{c.title}</small>}
                        <small>{c.email || 'no email'}</small>
                      </button>
                    </td>
                    <td data-label="Company">
                      {c.companyId ? (
                        <Link href={`/pipeline?open=${c.companyId._id}`} className="ct-company">
                          <b>{c.companyId.name}</b>
                          <span className={`stage ${c.companyId.stage}`}>{STAGE[c.companyId.stage]}</span>
                        </Link>
                      ) : (c.company || '—')}
                    </td>
                    <td data-label="Phone">{/^(none|n\/?a|-)$/i.test(c.phone || '') ? '—' : c.phone || '—'}</td>
                    <td data-label="LinkedIn">{empty(c.linkedin) ? '—' : <Value v={/^https?:/i.test(c.linkedin) ? c.linkedin : `https://${c.linkedin}`} />}</td>
                    <td data-label="Email status"><span className={`badge ${c.status}`}>{c.status}</span></td>
                    <td data-label="Last emailed">{date(c.lastContactedAt)}</td>
                    {extra.map((k) => {
                      const v = cellOf(c, k);
                      return <td key={k} data-label={label(k)} className="ct-cell" title={empty(v) ? '' : v}>{empty(v) ? '—' : <Value v={v} />}</td>;
                    })}
                    <td data-label="Actions">
                      <div className="row ct-actions">
                        {!['replied', 'unsubscribed'].includes(c.status) && <button className="btn ghost sm" onClick={() => action(c, 'replied')}>Replied</button>}
                        {c.status !== 'unsubscribed' && c.email && <button className="btn ghost sm" onClick={() => action(c, 'unsubscribe')}>Unsubscribe</button>}
                        <button className="btn ghost sm ct-del" onClick={() => action(c, 'delete')}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.pages > 1 && (
          <div className="row ct-pager">
            <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><LuChevronLeft /> Prev</button>
            <span className="small muted">Page {page} of {data.pages} · {num(data.total)} people</span>
            <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next <LuChevronRight /></button>
          </div>
        )}
      </div>

      {open && (
        <div className="ct-overlay" onClick={() => setOpen(null)}>
          <div className="ct-panel" onClick={(e) => e.stopPropagation()}>
            <div className="row ct-panel-head">
              <div>
                <h2>{oc.name || oc.email}</h2>
                <p className="muted small">{[oc.title, company?.name || oc.company].filter(Boolean).join(' · ') || 'No company'}</p>
              </div>
              <div className="row">
                {!edit && <button className="btn ghost sm" onClick={startEdit}><LuPencil /> Edit</button>}
                <button className="btn ghost sm" onClick={() => setOpen(null)}>Close</button>
              </div>
            </div>
            <div className="row ct-badges">
              <span className={`badge ${oc.status}`}>{oc.status}</span>
              {company && <Link href={`/pipeline?open=${company._id}`} className={`stage ${company.stage}`}>{company.name} · {STAGE[company.stage]}</Link>}
            </div>

            {edit ? (
              <form className="ct-edit" onSubmit={saveEdit}>
                <div className="ct-editgrid">
                  {EDITABLE.map(([k, l]) => (
                    <label className={`field ${k === 'notes' ? 'wide' : ''}`} key={k}>
                      {l}
                      {k === 'notes' ? <textarea rows={3} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /> : <input type={k === 'email' ? 'email' : 'text'} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />}
                    </label>
                  ))}
                </div>
                {edit.fields.length > 0 && (
                  <>
                    <h3>All details from the sheet</h3>
                    <p className="muted small">Same columns as your sheet. Name, email, designation etc. stay in step with the details above.</p>
                    <div className="ct-editgrid">
                      {edit.fields.map((f, i) => (
                        <label className="field" key={i}>
                          {label(f.k)}
                          <input value={f.v} onChange={(e) => setField(i, e.target.value)} />
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <div className="row ct-editbar">
                  <button className="btn sm">Save changes</button>
                  <button type="button" className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <>
                <h3>Details</h3>
                <dl className="ct-dl">
                  <dt>Email</dt><dd>{oc.email || '—'}</dd>
                  {DETAILS.filter(([k]) => oc[k]).map(([k, l]) => (
                    <div key={k} className="ct-pair"><dt>{l}</dt><dd><Value v={oc[k]} /></dd></div>
                  ))}
                </dl>
                {oc.notes && <><h3>Notes</h3><p className="ct-notes">{oc.notes}</p></>}
              </>
            )}

            {!edit && oc.fields?.length > 0 && (
              <details className="ct-all" open>
                <summary>All details from the sheet ({oc.fields.length})</summary>
                <dl className="ct-dl">
                  {oc.fields.map((f, i) => (
                    <div key={i} className="ct-pair"><dt>{label(f.k)}</dt><dd><Value v={f.v} /></dd></div>
                  ))}
                </dl>
              </details>
            )}

            {open.planned?.length > 0 && oc.email && (
              <>
                <h3>Planned emails ({open.planned.length})</h3>
                {open.planned.map((m, i) => (
                  <div key={i} className={`ct-item plan ${i < open.emails.filter((e) => e.status === 'sent').length ? 'sent' : ''}`}>
                    <b>{i === 0 ? 'First email' : `Follow-up ${i}`}</b>
                    <small>{m.subject || (i === 0 ? '(no subject)' : 'Re: same thread')}</small>
                    <p>{m.body}</p>
                  </div>
                ))}
              </>
            )}
            <h3>Sent emails</h3>
            {open.emails.length === 0 && <p className="muted small">No emails sent yet.</p>}
            {open.emails.map((m) => (
              <div key={m._id} className="ct-item">
                <b>{stepName(m.step)}</b> · {m.campaign?.name || ''}
                <small>{m.subject}</small>
                <small>{date(m.sentAt)} {m.status === 'failed' ? `· failed: ${m.error}` : ''}{m.openedAt ? ' · opened' : ''}</small>
              </div>
            ))}
            {open.replies.length > 0 && <h3>Replies</h3>}
            {open.replies.map((r) => (
              <div key={r._id} className="ct-item reply">
                <small>{date(r.receivedAt)} {r.isAutoReply ? '(auto-reply)' : ''}</small>
                <p>{r.snippet || r.subject}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const css = `
.ct-form { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-items: end; }
.ct-form .row { grid-column: 1 / -1; }
.ct-count { font-size: 11px; background: rgba(148,163,184,.18); padding: 1px 7px; border-radius: 99px; margin-left: 4px; }
.ct-search { margin-bottom: 14px; }
.ct-wide { overflow-x: auto; }
.ct-wide table { min-width: 100%; }
.ct-wide th { white-space: nowrap; }
.ct-cell { max-width: 280px; min-width: 160px; font-size: 13px; color: #334155; }
.ct-cell > span { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
.ct-sticky { position: sticky; left: 0; z-index: 2; background: #fff; min-width: 240px; box-shadow: 1px 0 0 rgba(148,163,184,.25), 8px 0 14px -10px rgba(15,23,42,.18); }
.ct-wide th.ct-sticky { z-index: 3; background: #effafc; }
.ct-wide tbody tr:hover td.ct-sticky { background: #f2fbfd; }
.ct-wide td, .ct-wide th { padding-left: 16px; padding-right: 16px; }
.ct-wide td { vertical-align: middle; }
.ct-name { background: none; border: 0; text-align: left; cursor: pointer; }
.ct-name:hover b { color: var(--c-700); }
.ct-name small { display: block; color: #64748b; font-size: 12px; }
.ct-name .ct-title { color: #334155; font-weight: 500; }
.ct-company { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.ct-company b { font-weight: 600; }
.ct-company:hover b { color: var(--c-700); }
.stage { display: inline-flex; align-items: center; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 99px; background: #f1f5f9; color: #475569; white-space: nowrap; }
.stage.cold { background: #eef2ff; color: #4f46e5; }
.stage.hot { background: #fff1e6; color: #c2410c; }
.stage.opportunity { background: #fef9c3; color: #a16207; }
.stage.account { background: #dcfce7; color: #15803d; }
.stage.old_client { background: #f1f5f9; color: #475569; }
.ct-actions { gap: 6px; flex-wrap: nowrap; }
.ct-actions .btn { background: transparent; border-color: transparent; box-shadow: none; color: #64748b; font-weight: 500; }
.ct-actions .btn:hover { background: var(--c-100); color: var(--c-700); transform: none; }
.ct-actions .ct-del:hover { background: rgba(225,29,72,.08); color: #e11d48; }
.ct-pager { justify-content: center; margin-top: 14px; }
.ct-overlay { position: fixed; inset: 0; background: rgba(14,42,51,.2); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); z-index: 40; display: flex; justify-content: flex-end; }
.ct-panel { background: rgba(255,255,255,.9); backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%); border-left: 1px solid rgba(255,255,255,.8); box-shadow: -20px 0 60px rgba(30,41,99,.15); width: 520px; max-width: 100%; height: 100%; overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 10px; }
.ct-panel-head { justify-content: space-between; align-items: flex-start; flex-wrap: nowrap; }
.ct-panel h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; margin-top: 10px; }
.ct-badges { gap: 8px; flex-wrap: wrap; align-items: center; }
.ct-dl { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; font-size: 13.5px; background: rgba(255,255,255,.6); border: 1px solid rgba(148,163,184,.22); border-radius: 14px; padding: 12px 14px; }
.ct-pair { display: contents; }
.ct-dl dt { color: #64748b; word-break: break-word; }
.ct-dl dd { color: #0f172a; word-break: break-word; white-space: pre-wrap; }
.ct-link { color: var(--c-700); display: inline-flex; align-items: center; gap: 4px; }
.ct-link svg { font-size: 12px; }
.ct-notes { white-space: pre-wrap; font-size: 13.5px; background: rgba(255,255,255,.6); border-radius: 12px; padding: 10px 12px; border: 1px solid rgba(148,163,184,.22); }
.ct-all summary { cursor: pointer; font-size: 13px; font-weight: 700; color: var(--c-700); margin: 10px 0 8px; }
.ct-edit { display: flex; flex-direction: column; gap: 10px; }
.ct-editgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.ct-editgrid .wide { grid-column: 1 / -1; }
.ct-editbar { position: sticky; bottom: -22px; z-index: 2; background: rgba(255,255,255,.97); margin: 0 -22px; padding: 12px 22px; border-top: 1px solid rgba(148,163,184,.25); }
@media (max-width: 640px) { .ct-editgrid { grid-template-columns: 1fr; } }
.ct-item { background: rgba(255,255,255,.6); border: 1px solid rgba(148,163,184,.25); border-radius: 14px; padding: 10px 12px; font-size: 13.5px; }
.ct-item small { display: block; color: #64748b; font-size: 12px; }
.ct-item.reply { border-left: 3px solid #16a34a; }
.ct-item.plan { border-left: 3px solid var(--c-200); }
.ct-item.plan.sent { border-left-color: var(--c); opacity: .7; }
.ct-item p { white-space: pre-wrap; margin-top: 4px; }
@media (max-width: 900px) {
  .ct-sticky { position: static; min-width: 0; background: none; box-shadow: none; }
  .ct-cell { max-width: none; }
  .ct-form { grid-template-columns: 1fr; }
  .ct-actions { flex-wrap: wrap; justify-content: flex-end; }
  .ct-dl { grid-template-columns: 1fr; }
  .ct-dl dt { font-size: 12px; margin-top: 4px; }
}
`;
