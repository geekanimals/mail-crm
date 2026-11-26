'use client';
// One person: every detail (A to Z from the sheet), follow-up status with pause / play, why an email bounced,
// planned + sent emails and replies. The same view everywhere: the lead page, and as a side panel.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LuExternalLink, LuPause, LuPencil, LuPlay } from 'react-icons/lu';
import { api, campaignName, date, notify, stepName } from '@/lib/api';

export const DONE = { completed: 'All emails sent', replied: 'Stopped - replied', unsubscribed: 'Stopped - unsubscribed', bounced: 'Stopped - bounced', failed: 'Stopped - error', stopped: 'Stopped' };
// "Mon, 26 Oct" (+ ", 9:00 am" for the next send)
export const dayDate = (d, time) => {
  if (!d) return '';
  const x = new Date(d);
  const day = x.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return time ? `${day}, ${x.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : day;
};

// follow-up progress for one person: "3 of 7 sent", next date, gap, paused
export function FollowUp({ f }) {
  if (!f) return <span className="muted small">Not in follow-ups</span>;
  const pct = Math.min(100, Math.round((f.sent / Math.max(1, f.total)) * 100));
  const active = f.status === 'active';
  return (
    <div className="fu">
      <div className="fu-top"><b>{f.sent} of {f.total} sent</b>{active && f.paused && <span className="fu-tag paused">Paused</span>}</div>
      <div className="fu-bar"><i style={{ width: `${pct}%` }} className={active && f.paused ? 'paused' : ''} /></div>
      {f.sent > 0 && f.lastSentAt && <small>Last sent: <b>{dayDate(f.lastSentAt)}</b>{f.sent > 1 ? ` (${f.sent === 2 ? 'follow-up 1' : `follow-up ${f.sent - 1}`})` : ' (first email)'}</small>}
      <small>
        {!active ? DONE[f.status] || f.status
          : f.paused ? <>Next: <b>paused</b> - nothing goes until you play it</>
          : <>Next: {f.sent === 0 ? 'first email' : `follow-up ${f.sent}`} on <b>{dayDate(f.nextGoesAt || f.nextSendAt, true)}</b></>}
      </small>
      {active && !f.paused && f.dueAt && f.nextGoesAt && dayDate(f.dueAt) !== dayDate(f.nextGoesAt) && (
        <small className="fu-wait">Due {dayDate(f.dueAt)} - waits in the queue (daily send limit)</small>
      )}
      {active && f.sent < f.total && <small>Every {f.gap} working day{f.gap === 1 ? '' : 's'}{f.gapDays ? ' (own)' : ''}</small>}
    </div>
  );
}
export const STAGE = { cold: 'Cold lead', hot: 'Hot lead', opportunity: 'Opportunity', account: 'Account', old_client: 'Old client' };
export const DETAILS = [
  ['title', 'Designation'], ['phone', 'Phone'], ['linkedin', 'LinkedIn'], ['website', 'Website'], ['industry', 'Industry'],
  ['location', 'Location'], ['signal', 'Buying signal'], ['referredBy', 'Referred by'], ['leadDate', 'Lead date'], ['source', 'Source'], ['batch', 'Upload'],
];
export const EDITABLE = [
  ['name', 'Name'], ['email', 'Email'], ['company', 'Company'], ['title', 'Designation'], ['phone', 'Phone'], ['linkedin', 'LinkedIn'],
  ['website', 'Website'], ['industry', 'Industry'], ['location', 'Location'], ['signal', 'Buying signal'], ['referredBy', 'Referred by'], ['leadDate', 'Lead date'], ['notes', 'Notes'],
];
// columns from the uploaded sheets that already have their own column in the table
export const CORE = /^(dm_)?(name|e-?mail|phone|mobile|title|designation|linkedin)$|^company(_| )?name$|^company$|^email_(subject|body)$|^(subject|body)(_\d+)?$/i;
// nicer column names (the CRM only sends emails, so "Email/Linkedin Sent Date" -> "Email Sent Date")
export const label = (k) => String(k).replace(/\s*\/\s*linked\s*in(?=\s*sent)/i, '').replace(/_/g, ' ').trim();
export const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || '').trim());
export const Value = ({ v }) => (isUrl(v) ? <a href={v.trim()} target="_blank" rel="noopener noreferrer" className="ct-link">{v.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)} <LuExternalLink /></a> : <span>{v}</span>);


const TABS = [['overview', 'Overview'], ['emails', 'Emails'], ['replies', 'Replies'], ['sheet', 'Sheet details']];

/** inline: a card on the page (the lead page). Otherwise a side panel over the page, closed with onClose.
 *  tab (lead page): show one part at a time (overview / emails / replies / sheet) with a tab bar; onTab changes it.
 *  Without tab everything is shown one under the other, as before. */
export default function PersonDetails({ id, inline = false, onClose, onChanged, tab, onTab }) {
  const [open, setOpen] = useState(null); // the person + emails + replies
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/api/contacts/${id}`).then(setOpen).catch((e) => notify(e.message, 'error')), [id]);
  useEffect(() => {
    load();
  }, [load]);

  // pause / play / default days for this person's follow-ups
  const followUps = async (action, { gapDays } = {}) => {
    setBusy(true);
    try {
      const r = await api('/api/contacts/followups', { method: 'POST', body: { ids: [id], action, gapDays } });
      notify(r.changed ? (action === 'pause' ? 'Paused' : action === 'play' ? 'Playing again' : 'Updated') : 'No running follow-ups for this person', r.changed ? 'success' : 'error');
      load();
      onChanged?.();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const startEdit = () => {
    const oc = open.contact;
    setEdit({ ...Object.fromEntries(EDITABLE.map(([k]) => [k, oc[k] || ''])), fields: (oc.fields || []).map((f) => ({ k: f.k, v: f.v })) });
    if (tab && tab !== 'overview') onTab?.('overview');
  };
  const setField = (i, v) => setEdit({ ...edit, fields: edit.fields.map((f, j) => (j === i ? { ...f, v } : f)) });
  const saveEdit = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/contacts/${id}`, { method: 'PUT', body: edit });
      notify('Saved');
      setEdit(null);
      load();
      onChanged?.();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  if (!open) return inline ? <div className="ct-panel ct-inline"><style>{ctCss}</style><p className="muted">Loading…</p></div> : null;
  const oc = open.contact;
  const company = oc.companyId;
  const show = (t) => !tab || tab === t;
  const sentCount = open.emails.filter((e) => e.status === 'sent').length;
  const counts = { emails: `${sentCount} sent${open.planned?.length && oc.email ? ` · ${open.planned.length} planned` : ''}`, replies: open.replies.length, sheet: oc.fields?.length || 0 };
  const lastEmail = open.emails[0];
  const lastReply = open.replies[0];
  // the reply that came after this email (and before the next one), to link "see reply"
  const replyAfter = (m) => open.replies.find((r) => new Date(r.receivedAt) >= new Date(m.sentAt));
  const sentBlock = (
    <>
      <h3>Sent emails</h3>
      {open.emails.length === 0 && !open.manual?.length && <p className="muted small">No emails sent yet.</p>}
      {(open.manual || []).map((m) => (
        <div key={m._id} className="ct-item manual">
          <b>Sent by hand</b> · from the mailbox
          <small>{m.subject}</small>
          <small>{date(m.sentAt)}</small>
          {m.snippet && <p>{m.snippet}</p>}
        </div>
      ))}
      {open.emails.map((m) => (
        <div key={m._id} className="ct-item">
          <b>{stepName(m.step, m.kind)}</b>{m.campaign?.name ? ` · ${campaignName(m.campaign.name)}` : ''}
          <small>{m.subject}</small>
          <small>
            {date(m.sentAt)} {m.status === 'failed' ? `· failed: ${m.error}` : ''}{m.openedAt ? ' · opened' : ''}
            {tab && m.status !== 'failed' && replyAfter(m) && <> · <button type="button" className="ct-tablink" onClick={() => onTab?.('replies')}>see reply</button></>}
          </small>
        </div>
      ))}
    </>
  );
  const plannedBlock = open.planned?.length > 0 && oc.email && (
    <>
      <h3>Planned emails ({open.planned.length})</h3>
      {tab && <p className="muted small">Click an email to read it.</p>}
      {open.planned.map((m, i) => {
        const title = i === 0 ? 'First email' : `Follow-up ${i}`;
        const done = i < sentCount;
        const inner = (
          <>
            <small>{m.subject || (i === 0 ? '(no subject)' : 'Re: same thread')}</small>
            <p>{m.body}</p>
          </>
        );
        return tab ? (
          <details key={i} className={`ct-item plan ${done ? 'sent' : ''}`}>
            <summary><b>{title}</b>{done ? <span className="muted small"> · sent</span> : ''}</summary>
            {inner}
          </details>
        ) : (
          <div key={i} className={`ct-item plan ${done ? 'sent' : ''}`}><b>{title}</b>{inner}</div>
        );
      })}
    </>
  );
  const body = (
    <>
      <style>{ctCss}</style>
      <div className="row ct-panel-head">
        <div>
          <h2>{oc.name || oc.email}</h2>
          <p className="muted small">{[oc.title, company?.name || oc.company].filter(Boolean).join(' · ') || 'No company'}</p>
        </div>
        <div className="row">
          {!edit && <button className="btn ghost sm" onClick={startEdit}><LuPencil /> Edit</button>}
          {!inline && <button className="btn ghost sm" onClick={onClose}>Close</button>}
        </div>
      </div>
      <div className="row ct-badges">
        <span className={`badge ${oc.status}`}>{oc.status}</span>
        {oc.outcome === 'later' && <span className="stage later">Future follow-up{oc.laterAt ? ` · ${date(oc.laterAt)}` : ''}</span>}
        {oc.outcome === 'not_interested' && <span className="stage not_interested">Not interested{oc.outcomeReason && oc.outcomeReason !== 'other' ? ` · ${oc.outcomeReason.replace('_', ' ')}` : ''}</span>}
        {oc.outcome === 'no_reply' && <span className="stage">No reply after the follow-ups</span>}
        {company && <Link href={`/lead?company=${company._id}`} className={`stage ${company.stage}`}>{company.name} · {STAGE[company.stage]}</Link>}
      </div>
      {tab && (
        <div className="ct-tabs" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => onTab?.(k)}>
              {l}{counts[k] !== undefined && <span>{counts[k]}</span>}
            </button>
          ))}
        </div>
      )}
      {show('overview') && oc.status === 'bounced' && (
        <div className="ct-bounce-box">
          <b>Why the email bounced: {oc.bounce?.reason || 'reason not found yet'}</b>
          {oc.bounce?.detail && <span>Their mail server said: “{oc.bounce.detail}”{oc.bounce.code ? ` (${oc.bounce.code})` : ''}</span>}
          <small>
            {oc.bounce?.at ? `${date(oc.bounce.at)} · ` : ''}
            {oc.bounce?.via === 'send' ? 'refused while sending' : oc.bounce?.via === 'inbox' ? 'from the bounce email in the inbox' : 'No bounce email was found for this address. It may have been marked bounced in an uploaded file.'}
            {' · '}This address is never emailed again.
          </small>
        </div>
      )}

      {show('overview') && open.followUp && !edit && (
        <div className="fu-panel">
          <FollowUp f={open.followUp} />
          {open.followUp.status === 'active' && (
            <div className="row">
              {open.followUp.paused
                ? <button className="btn sm" disabled={busy} onClick={() => followUps('play')}><LuPlay /> Play</button>
                : <button className="btn ghost sm" disabled={busy} onClick={() => followUps('pause')}><LuPause /> Pause</button>}
              {open.followUp.gapDays && <button className="btn ghost sm" disabled={busy} onClick={() => followUps('gap', { gapDays: 0 })}>Default days</button>}
            </div>
          )}
        </div>
      )}

      {tab === 'overview' && !edit && (lastEmail || lastReply) && (
        <div className="ct-latest">
          {lastReply && <button type="button" onClick={() => onTab?.('replies')}><b>Latest reply · {date(lastReply.receivedAt)}</b><span>{lastReply.snippet || lastReply.subject}</span></button>}
          {lastEmail && <button type="button" onClick={() => onTab?.('emails')}><b>Latest email · {date(lastEmail.sentAt)}</b><span>{stepName(lastEmail.step)} · {lastEmail.subject}{lastEmail.openedAt ? ' · opened' : ''}</span></button>}
        </div>
      )}

      {!show('overview') ? null : edit ? (
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
              <div key={k} className="ct-pair"><dt>{l}</dt><dd><Value v={k === 'source' || k === 'batch' ? campaignName(oc[k]) : oc[k]} /></dd></div>
            ))}
          </dl>
          {oc.notes && <><h3>Notes</h3><p className="ct-notes">{oc.notes}</p></>}
        </>
      )}

      {tab === 'sheet' && !oc.fields?.length && <p className="muted small">No extra columns from a sheet for this person.</p>}
      {!edit && show('sheet') && oc.fields?.length > 0 && (
        <details className="ct-all" open>
          <summary>All details from the sheet ({oc.fields.length})</summary>
          <dl className="ct-dl">
            {oc.fields.map((f, i) => (
              <div key={i} className="ct-pair"><dt>{label(f.k)}</dt><dd><Value v={f.v} /></dd></div>
            ))}
          </dl>
        </details>
      )}

      {show('emails') && (tab ? <>{sentBlock}{plannedBlock}</> : <>{plannedBlock}{sentBlock}</>)}
      {show('replies') && (
        <>
          {(tab || open.replies.length > 0) && <h3>Replies</h3>}
          {tab && open.replies.length === 0 && <p className="muted small">No replies yet.</p>}
          {open.replies.map((r) => (
            <div key={r._id} className="ct-item reply">
              <small>{date(r.receivedAt)} {r.isAutoReply ? '(auto-reply)' : ''}{r.from ? ` · from ${r.from}` : ''}</small>
              <p>{r.snippet || r.subject}</p>
              {tab && r.text && r.text.trim() !== (r.snippet || '').trim() && (
                <details className="ct-full"><summary>Show the full reply</summary><p>{r.text}</p></details>
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
  if (inline) return <div className="ct-panel ct-inline" id={`p-${id}`}>{body}</div>;
  return (
    <div className="ct-overlay" onClick={onClose}>
      <div className="ct-panel" onClick={(e) => e.stopPropagation()}>{body}</div>
    </div>
  );
}

export const ctCss = `
.ct-bounce { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; width: 240px; max-width: 60vw; }
.ct-bounce b { font-size: 11.5px; color: #b45309; }
.ct-bounce i { font-style: normal; font-size: 11px; color: #78716c; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.ct-bounce-box { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; padding: 10px 12px; border-radius: 12px; background: #fff7ed; border: 1px solid #fed7aa; color: #7c2d12; font-size: 13.5px; }
.ct-bounce-box span { overflow-wrap: anywhere; }
.ct-bounce-box small { color: #9a3412; }
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
.stage.later { background: #e0f2fe; color: #0369a1; }
.stage.not_interested { background: #fee2e2; color: #b91c1c; }
.ct-actions { gap: 6px; flex-wrap: nowrap; }
.ct-actions .btn { background: transparent; border-color: transparent; box-shadow: none; color: #64748b; font-weight: 500; }
.ct-actions .btn:hover { background: var(--c-100); color: var(--c-700); transform: none; }
.ct-actions .ct-del:hover { background: rgba(225,29,72,.08); color: #e11d48; }
.ct-pager { justify-content: center; margin-top: 14px; }
.ct-namecell, .ct-namehead { display: flex; align-items: center; gap: 10px; }
.ct-check { width: 16px; height: 16px; accent-color: var(--c); cursor: pointer; flex: none; margin: 0; }
.ct-wide tbody tr.ct-picked td, .ct-wide tbody tr.ct-picked td.ct-sticky { background: #eefafd; }
.fu-filters { gap: 8px; flex-wrap: wrap; margin: -4px 0 14px; }
.fu-chip { border: 1px solid rgba(148,163,184,.35); background: #fff; color: #475569; border-radius: 99px; padding: 5px 12px; font-size: 13px; cursor: pointer; }
.fu-chip.on { background: var(--c-100); border-color: var(--c-200); color: var(--c-700); font-weight: 600; }
.fu-bulk { position: sticky; top: 8px; z-index: 5; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; background: #f2fbfd; border: 1px solid var(--c-200); border-radius: 14px; padding: 10px 14px; margin-bottom: 14px; box-shadow: 0 8px 24px -14px rgba(15,23,42,.25); }
.fu-bulk-who { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.fu-bulk .link { background: none; border: 0; color: var(--c-700); font-weight: 600; cursor: pointer; padding: 0; font-size: 13px; text-decoration: underline; }
.fu-bulk-do { gap: 8px; flex-wrap: wrap; align-items: center; }
.fu-days { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #475569; }
.fu-days input, .fu-inline input { width: 72px; padding: 6px 8px; }
.fu-inline { display: inline-flex; align-items: center; gap: 6px; }
.fu-cell { min-width: 220px; }
.fu-row { gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.fu-row:empty { display: none; }
.fu-row .btn { padding: 4px 10px; }
.fu { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.fu-top { display: flex; align-items: center; gap: 8px; }
.fu small { color: #64748b; font-size: 12px; }
.fu small.fu-wait { color: #b45309; }
.fu-bar { height: 6px; background: #e2e8f0; border-radius: 99px; overflow: hidden; width: 150px; }
.fu-bar i { display: block; height: 100%; background: var(--c); border-radius: 99px; }
.fu-bar i.paused { background: #f59e0b; }
.fu-tag { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 99px; }
.fu-tag.paused { background: #fef3c7; color: #b45309; }
.ct-actions .fu-play { color: var(--c-700); font-weight: 600; }
.fu-panel { background: rgba(255,255,255,.65); border: 1px solid rgba(148,163,184,.25); border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
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
.ct-item.manual { border-left: 3px solid #a855f7; }
.ct-item.plan { border-left: 3px solid var(--c-200); }
.ct-item.plan.sent { border-left-color: var(--c); opacity: .7; }
.ct-item p { white-space: pre-wrap; margin-top: 4px; }
.ct-tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid #e2e8f0; margin: 14px 0 4px; }
.ct-tabs button { background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px; font: inherit; font-size: 13.5px; font-weight: 600; color: #64748b; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; margin-bottom: -1px; }
.ct-tabs button span { font-size: 11.5px; font-weight: 600; background: #f1f5f9; color: #475569; border-radius: 99px; padding: 1px 7px; }
.ct-tabs button.on { color: var(--c-700); border-bottom-color: var(--c); }
.ct-tabs button.on span { background: var(--c-100); color: var(--c-700); }
.ct-tablink { background: none; border: 0; padding: 0; font: inherit; color: var(--c-700); font-weight: 600; cursor: pointer; }
.ct-tablink:hover { text-decoration: underline; }
.ct-latest { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; margin: 12px 0 4px; }
.ct-latest button { text-align: left; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 10px 12px; font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ct-latest button:hover { border-color: var(--c-200); background: #fff; }
.ct-latest b { font-size: 12.5px; color: var(--c-700); }
.ct-latest span { font-size: 13px; color: #334155; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
details.ct-item summary { cursor: pointer; list-style: revert; }
.ct-full summary { cursor: pointer; font-size: 12.5px; color: var(--c-700); font-weight: 600; margin-top: 6px; }
@media (max-width: 900px) {
  .ct-sticky { position: static; min-width: 0; background: none; box-shadow: none; }
  .ct-cell { max-width: none; }
  .ct-form { grid-template-columns: 1fr; }
  .ct-actions { flex-wrap: wrap; justify-content: flex-end; }
  .ct-dl { grid-template-columns: 1fr; }
  .ct-dl dt { font-size: 12px; margin-top: 4px; }
}

.ct-panel.ct-inline { position: static; width: 100%; max-width: none; height: auto; overflow: visible; border-radius: 22px; box-shadow: 0 12px 34px rgba(30,41,59,.06); border: 1px solid rgba(255,255,255,.85); scroll-margin-top: 110px; }
.ct-panel.ct-inline.flash { box-shadow: 0 0 0 3px var(--c-200, #a5e8f5), 0 12px 34px rgba(30,41,59,.08); }
`;
