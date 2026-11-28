'use client';
// Needs you: the CRM's suggestions that wait for a person (reply sorting, meetings, "How was the meeting?").
// The message for any follow-up is chosen here, once; the CRM then sends it on the chosen date by itself.
// Used on the admin page (/needs-you) and in the employee portal (their meeting questions).
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LuCalendarClock, LuCheck, LuMail, LuReply, LuRotateCcw, LuTrash2, LuUndo2 } from 'react-icons/lu';
import { api, date, leadHref, notify } from '@/lib/api';

const TZ = '+05:30'; // the CRM works in India time
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const dayTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
/** "2026-12-01" -> "Tue, 1 December 2026" (shown beside every date box, so 01/12 is never read as 12 January) */
const inWords = (v) => (v ? new Date(`${v}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const ymd = (d) => (d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d)) : '');
const ymdhm = (d) => {
  if (!d) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const plusMonths = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() + Number(n || 3));
  return d;
};
const ahead = (days) => new Date(new Date().getTime() + days * 86400000);
const isLate = (a) => new Date().getTime() - new Date(a.createdAt).getTime() > 2 * 86400000;
const fromDate = (v) => (v ? `${v}T11:00:00${TZ}` : undefined);
const fromDateTime = (v) => (v ? `${v}:00${TZ}` : undefined);
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';
const referrerOf = (a) => firstName(a.decision?.referrerName || '') === 'there' ? 'A colleague' : String(a.decision?.referrerName || '').trim();
const fill = (body, a) => String(body || '').replace(/\{\{\s*firstName\s*\}\}/g, firstName(a.contact?.name)).replace(/\{\{\s*company\s*\}\}/g, a.company?.name || 'your brand').replace(/\{\{\s*referrer\s*\}\}/g, referrerOf(a));
const REFERRAL_FOLLOW_UPS = [
  'Hi {{firstName}},\n\nFollowing up on my note. {{referrer}} thought this could be useful for {{company}}, so I wanted to make sure it reached you.\n\nWould a quick 15-minute call work this week?',
  'Hi {{firstName}},\n\nOne last note from my side. If creator campaigns are not a priority for {{company}} right now, no problem at all. If they are, I am happy to share a short plan.',
];
const REFERRAL_INTRO = { key: 'referral_intro', name: 'Referral intro', body: 'Hi {{firstName}},\n\n{{referrer}} suggested I get in touch with you about creator campaigns for {{company}}.\n\nWe run influencer campaigns with micro and nano creators who are paid in product, so each extra creator costs a unit of stock plus our fee. We have done this for brands like PepsiCo.\n\nWould you be open to a quick 15-minute call this week?' };

const KIND = { reply: 'Reply', meeting: 'Meeting found', meeting_outcome: 'How was the meeting?', manual: 'Emailed by hand', referral: 'Referral', estimate: 'Estimate sent', agreement: 'Agreement', payment: 'Payment' };
const SUGGEST = { later: 'Future follow-up', not_interested: 'Not interested', ooo: 'Out of office', hot: 'Hot lead', meeting: 'Set the meeting', outcome: '', manual: 'Move the next system email to', referral: 'Email them', estimate: 'Move to Opportunity', meeting_move: 'Move the meeting to', meeting_cancel: 'Mark the meeting cancelled', agreement_accepted: 'Make and send the estimate', agreement_changes: 'Revise the agreement and send it again', payment: 'Has the advance come?' };
const REASONS = [['budget', 'No budget'], ['agency', 'Has an agency / in-house team'], ['not_relevant', 'Not relevant'], ['other', 'Other']];
const CHOICES = {
  reply: [['later', 'Future follow-up'], ['not_interested', 'Not interested'], ['ooo', 'Out of office'], ['hot', 'Hot lead (interested)'], ['nothing', 'Do nothing']],
  meeting: [['set', 'Set the meeting'], ['nothing', 'Not a meeting']],
  manual: [['continue', 'Continue after that'], ['as_planned', 'Send as planned'], ['stop', 'Stop system emails']],
  referral: [['email', 'Email them now'], ['email_later', 'Email on a date'], ['by_hand', "I'll handle it by hand"]],
  estimate: [['opportunity', 'Move to Opportunity'], ['nothing', 'No change']],
  meeting_move: [['set', 'Move it'], ['nothing', 'Keep the old time']],
  meeting_cancel: [['cancel', 'Mark it cancelled'], ['nothing', 'Keep it']],
  agreement_accepted: [['estimate', 'Make the estimate'], ['later', 'Later']],
  agreement_changes: [['revise', 'Revise the agreement'], ['later', 'Later']],
  payment: [['received', 'Payment received'], ['not_yet', 'Not yet']],
  meeting_outcome: [['deal', 'Deal done'], ['details', 'Wants more details'], ['get_back', 'Will get back on a date'], ['later', 'Follow up later'], ['not_interested', 'Not interested'], ['didnt_happen', "Didn't happen"]],
};

const choicesFor = (a) => (a.kind === 'agreement' ? CHOICES[a.suggestion?.type === 'agreement_changes' ? 'agreement_changes' : 'agreement_accepted'] : a.kind === 'meeting' && ['meeting_move', 'meeting_cancel'].includes(a.suggestion?.type) ? CHOICES[a.suggestion.type] : CHOICES[a.kind] || []);

const startMsg = (templates, a, key) => {
  const t = templates.find((x) => x.key === key) || templates[0];
  return t ? { template: t.key, body: fill(t.body, a) } : { template: 'new', body: '' };
};

/** choose a saved message or write a new one; the text shown is exactly what will be sent */
function MessagePicker({ a, templates, value, onChange, label = 'Message' }) {
  const [tpl, setTpl] = useState(value.template || templates[0]?.key || 'new');
  const pick = (k) => {
    setTpl(k);
    const t = templates.find((x) => x.key === k);
    onChange({ template: k, body: t ? fill(t.body, a) : '', saveAs: k === 'new' ? value.saveAs || '' : '' });
  };
  return (
    <div className="ny-msg">
      <div className="ny-tpls">
        <span className="ny-lbl">{label}</span>
        {templates.map((t) => (
          <button type="button" key={t.key} className={tpl === t.key ? 'on' : ''} onClick={() => pick(t.key)}>{t.name}</button>
        ))}
        <button type="button" className={tpl === 'new' ? 'on' : ''} onClick={() => pick('new')}>Write new</button>
      </div>
      <textarea rows={7} value={value.body || ''} placeholder="Write the message…" onChange={(e) => onChange({ ...value, template: tpl, body: e.target.value })} />
      {tpl === 'new' && (
        <label className="ny-inline">
          <input type="checkbox" checked={Boolean(value.save)} onChange={(e) => onChange({ ...value, save: e.target.checked })} /> Save as a message for next time
          {value.save && <input className="ny-name" placeholder="Name, e.g. Budget follow-up" value={value.saveAs || ''} onChange={(e) => onChange({ ...value, saveAs: e.target.value })} />}
        </label>
      )}
      <small className="muted">The name and company are already filled in. It goes in the same email thread.</small>
    </div>
  );
}

function ActionCard({ a, settings, onDone, admin = true }) {
  const s = a.suggestion || {};
  // emailed by hand: is the next system email already on (or after) the day the CRM would move it to?
  const nextDue = a.kind === 'manual' ? a.decision?.held?.next : null;
  const asPlanned = Boolean(a.kind === 'manual' && nextDue && s.date && ymd(s.date) <= ymd(nextDue));
  const sug = a.kind === 'agreement' ? (s.type === 'agreement_changes' ? 'revise' : 'estimate') : a.kind === 'payment' ? 'received' : a.kind === 'manual' && asPlanned ? 'as_planned' : a.kind === 'reply' ? (['later', 'not_interested', 'ooo', 'hot'].includes(s.type) ? s.type : 'hot') : a.kind === 'meeting' ? (s.type === 'meeting_cancel' ? 'cancel' : 'set') : a.kind === 'manual' ? 'continue' : a.kind === 'referral' ? 'email' : a.kind === 'estimate' ? 'opportunity' : '';
  const [choice, setChoice] = useState(sug);
  const [f, setF] = useState(() => ({
    date: ymd(s.date || (s.type === 'later' ? plusMonths(settings.laterMonths) : null)),
    at: ymdhm(s.date),
    reason: s.reason || 'other',
    more: true,
    msg: a.kind === 'referral' ? startMsg(settings.templates.some((t) => t.key === 'referral_intro') ? settings.templates : [REFERRAL_INTRO, ...settings.templates], a, 'referral_intro') : startMsg(settings.templates, a, a.kind === 'meeting_outcome' ? 'as_discussed' : 'checking_in'),
    subject: a.kind === 'referral' ? `${firstName(referrerOf(a))} suggested I get in touch` : '',
    cc: true,
    follow: true,
    nextBodies: a.kind === 'referral'
      ? REFERRAL_FOLLOW_UPS.map((b) => fill(b, a))
      : ['checking_in', 'more_details'].map((k) => startMsg(settings.templates, a, k).body),
    winback: false,
    winbackDate: ymd(plusMonths(settings.winbackMonths)),
    winMsg: startMsg(settings.templates, a, 'checking_in'),
    planFollowUp: true,
    notes: '',
    amount: a.decision?.due ? String(a.decision.due) : '', // payment received
    payDate: ymd(new Date()),
    reference: '',
    askAgain: ymd(ahead(3)),
  }));
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const pickChoice = (c) => {
    setChoice(c);
    if (['later', 'get_back'].includes(c) && !f.date) set({ date: ymd(c === 'later' ? plusMonths(settings.laterMonths) : ahead(7)) });
    if (c === 'details' && !f.date) set({ date: ymd(ahead(3)) });
  };

  const needsMsg = ['later', 'get_back'].includes(choice) || (choice === 'details' && f.planFollowUp);
  const save = async () => {
    if (!choice) return notify('Choose what to do', 'error');
    const body = { choice, notes: f.notes || undefined };
    if (needsMsg) {
      if (!f.date) return notify('Choose the follow-up date', 'error');
      if (!f.msg.body?.trim()) return notify('Choose or write the message', 'error');
      Object.assign(body, { date: fromDate(f.date), body: f.msg.body, template: f.msg.template, more: choice !== 'details' && f.more });
    }
    if (choice === 'not_interested') {
      body.reason = f.reason;
      if (f.winback) {
        if (!f.winMsg.body?.trim()) return notify('Choose or write the win-back message', 'error');
        Object.assign(body, { winback: true, winbackDate: fromDate(f.winbackDate), winbackBody: f.winMsg.body });
      }
    }
    if (choice === 'email' || choice === 'email_later') {
      if (!f.subject.trim()) return notify('Write the subject', 'error');
      if (!f.msg.body?.trim()) return notify('Choose or write the first email', 'error');
      Object.assign(body, { subject: f.subject.trim(), body: f.msg.body, template: f.msg.template, cc: f.cc, nextBodies: f.follow ? f.nextBodies.filter((x) => x.trim()) : [] });
      if (choice === 'email_later') {
        if (!f.date) return notify('Choose the date', 'error');
        body.date = fromDate(f.date);
      }
    }
    if (choice === 'ooo' || choice === 'continue') body.date = fromDate(f.date);
    if (choice === 'continue' && !body.date) return notify('Choose the date', 'error');
    if (choice === 'set' || choice === 'didnt_happen') body.at = fromDateTime(f.at);
    if (choice === 'set' && !body.at) return notify('Choose the meeting time', 'error');
    if (choice === 'received') {
      if (!(Number(String(f.amount).replace(/[,₹\s]/g, '')) > 0)) return notify('Enter the amount received', 'error');
      Object.assign(body, { amount: f.amount, date: f.payDate, reference: f.reference });
    }
    if (choice === 'not_yet') body.date = fromDate(f.askAgain);
    setBusy(true);
    try {
      const out = await api(`/api/actions/${a._id}/decide`, { method: 'POST', body });
      // a new message saved for next time
      for (const m of [f.msg, f.winMsg]) {
        if (m?.template === 'new' && m.save && m.saveAs?.trim() && m.body?.trim()) {
          await api('/api/actions/settings', { method: 'PUT', body: { templates: [...settings.templates, { name: m.saveAs.trim(), body: m.body.replace(firstName(a.contact?.name), '{{firstName}}').split(a.company?.name || '\u0000').join('{{company}}') }] } }).catch(() => {});
        }
      }
      notify('Done ✓');
      onDone(out);
      if (out.decision?.convert && admin) window.location.href = out.decision.convert;
      if (out.decision?.goto && admin && choice !== 'later') window.location.href = out.decision.goto; // agreement / estimate: on the company page
    } catch (e) {
      notify(e.message, 'error');
    }
    setBusy(false);
  };

  const late = isLate(a);
  const who = !admin ? <span>{a.contact?.name || a.contact?.email || a.company?.name || 'Someone'}</span> : a.contact ? <Link href={leadHref(a.contact, a.kind === 'reply' ? 'replies' : undefined)}>{a.contact.name || a.contact.email}</Link> : <span>{a.company?.name || 'Someone'}</span>;
  return (
    <div className={`ny-card ${late ? 'late' : ''}`} id={`a-${a._id}`}>
      <div className="ny-top">
        <span className={`ny-kind k-${a.kind}`}>{a.kind === 'reply' ? <LuReply /> : <LuCalendarClock />} {KIND[a.kind]}</span>
        <b className="ny-who">{who}{a.company && a.contact ? <> · {admin ? <Link href={`/lead?company=${a.company._id}`}>{a.company.name}</Link> : a.company.name}</> : null}</b>
        <small className="muted">{late ? 'Waiting for 2+ days · ' : ''}{a.emailAt ? `${a.kind === 'payment' ? 'Estimate sent' : a.kind === 'agreement' ? (s.type === 'agreement_changes' ? 'Changes asked' : 'Accepted') : ['manual', 'estimate'].includes(a.kind) || /^Sent by hand/.test(a.quote || '') ? 'Sent' : 'Received'} ${dayTime(a.emailAt)}` : dayTime(a.createdAt)}</small>
      </div>
      {a.kind === 'meeting_outcome' && <p className="ny-line">Meeting on <b>{dayTime(a.meeting?.at || s.date)}</b>{a.meeting?.sources?.length ? ` · from ${a.meeting.sources.join(' + ')}` : ''}</p>}
      {a.quote && <blockquote className="ny-quote">{a.quote}</blockquote>}
      {a.kind !== 'meeting_outcome' && (
        <p className="ny-suggest">
          {a.kind === 'manual' ? (
            <b>
              Suggested:{' '}
              {asPlanned
                ? `Send the next system email as planned, on ${dayTime(nextDue)}`
                : nextDue
                  ? `Move the next system email from ${dayTime(nextDue)} to ${dayTime(s.date)}`
                  : `Next system email on ${dayTime(s.date)}`}
            </b>
          ) : (
            <b>Suggested: {SUGGEST[s.type]}</b>
          )}
          {a.kind !== 'manual' && s.date && s.type !== 'not_interested' ? ` · ${s.type === 'meeting' ? dayTime(s.date) : day(s.date)}` : ''}
          {s.type === 'not_interested' && s.reason ? ` · ${REASONS.find((r) => r[0] === s.reason)?.[1] || ''}` : ''}
          {s.sources?.length ? ` · from ${s.sources.join(' + ')}` : ''}
          {s.note && <span className={`ny-note ${s.check ? 'warn' : ''}`}>{a.kind === 'manual' ? `${s.note.split(' · ')[0]} · the CRM waits at least 3 working days after an email by hand` : s.note}</span>}
          {s.check && !s.note && <span className="ny-note warn">Not sure: check this.</span>}
        </p>
      )}

      <div className="ny-choices">
        {choicesFor(a).map(([k, l]) => (
          <button type="button" key={k} className={`${choice === k ? 'on' : ''} ${k === sug ? 'sug' : ''}`} onClick={() => pickChoice(k)}>{l}</button>
        ))}
      </div>

      {a.kind === 'meeting_outcome' && (
        <label className="ny-field ny-wide">What did they say? <textarea rows={2} value={f.notes} placeholder="Saved on the company timeline" onChange={(e) => set({ notes: e.target.value })} /></label>
      )}

      {choice === 'details' && (
        <>
          <p className="ny-hint">The company becomes an <b>Opportunity</b>.</p>
          <label className="ny-inline"><input type="checkbox" checked={f.planFollowUp} onChange={(e) => set({ planFollowUp: e.target.checked })} /> Plan a follow-up email</label>
        </>
      )}
      {needsMsg && (
        <div className="ny-form">
          <label className="ny-field">{choice === 'get_back' ? 'They will get back on' : 'Follow up on'} <input type="date" value={f.date} min={ymd(new Date())} onChange={(e) => set({ date: e.target.value })} />{f.date && <small className="ny-inwords">{inWords(f.date)}</small>}</label>
          <MessagePicker a={a} templates={settings.templates} value={f.msg} onChange={(msg) => set({ msg })} />
          {choice !== 'details' && <label className="ny-inline"><input type="checkbox" checked={f.more} onChange={(e) => set({ more: e.target.checked })} /> If there is no reply, send 2 more follow-ups ({settings.moreGapDays} working days apart), then stop</label>}
          <p className="ny-hint">Nothing is sent before {f.date ? day(fromDate(f.date)) : 'that date'}. You can change or cancel it under Planned follow-ups.</p>
        </div>
      )}
      {choice === 'not_interested' && (
        <div className="ny-form">
          <label className="ny-field">Reason
            <select value={f.reason} onChange={(e) => set({ reason: e.target.value })}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <p className="ny-hint">Only {a.contact?.name || 'this person'} stops getting emails. Others at {a.company?.name || 'the company'} carry on.</p>
          <label className="ny-inline"><input type="checkbox" checked={f.winback} onChange={(e) => set({ winback: e.target.checked })} /> Try again later with one email</label>
          {f.winback && (
            <>
              <label className="ny-field">Send on <input type="date" value={f.winbackDate} min={ymd(new Date())} onChange={(e) => set({ winbackDate: e.target.value })} />{f.winbackDate && <small className="ny-inwords">{inWords(f.winbackDate)}</small>}</label>
              <MessagePicker a={a} templates={settings.templates} value={f.winMsg} onChange={(winMsg) => set({ winMsg })} label="Win-back message" />
            </>
          )}
        </div>
      )}
      {choice === 'ooo' && (
        <div className="ny-form">
          <label className="ny-field">Back on <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />{f.date && <small className="ny-inwords">{inWords(f.date)}</small>}</label>
          <p className="ny-hint">The follow-ups stop until then and start again from where they were.</p>
        </div>
      )}
      {choice === 'continue' && (
        <div className="ny-form">
          <label className="ny-field">Next system email on <input type="date" value={f.date} min={ymd(new Date())} onChange={(e) => set({ date: e.target.value })} />{f.date && <small className="ny-inwords">{inWords(f.date)}</small>}</label>
          <p className="ny-hint">The email written by hand counts. The system emails carry on from this date{nextDue ? ` (it was ${dayTime(nextDue)})` : ''}.</p>
        </div>
      )}
      {(choice === 'email' || choice === 'email_later') && (
        <div className="ny-form">
          {choice === 'email_later' && <label className="ny-field">Send on <input type="date" value={f.date} min={ymd(new Date())} onChange={(e) => set({ date: e.target.value })} />{f.date && <small className="ny-inwords">{inWords(f.date)}</small>}</label>}
          <label className="ny-field ny-wide">Subject <input value={f.subject} maxLength={300} onChange={(e) => set({ subject: e.target.value })} /></label>
          <MessagePicker a={a} templates={settings.templates.some((t) => t.key === 'referral_intro') ? settings.templates : [REFERRAL_INTRO, ...settings.templates]} value={f.msg} onChange={(msg) => set({ msg })} label="First email" />
          {a.decision?.referrerName && <label className="ny-inline"><input type="checkbox" checked={f.cc} onChange={(e) => set({ cc: e.target.checked })} /> CC {a.decision.referrerName} (who referred them)</label>}
          <label className="ny-inline"><input type="checkbox" checked={f.follow} onChange={(e) => set({ follow: e.target.checked })} /> If there is no reply, send these follow-ups ({settings.moreGapDays} working days apart), then stop</label>
          {f.follow && f.nextBodies.map((b, i) => (
            <label key={i} className="ny-field ny-wide">Follow-up {i + 1}
              <textarea rows={5} value={b} onChange={(e) => set({ nextBodies: f.nextBodies.map((x, j) => (j === i ? e.target.value : x)) })} />
            </label>
          ))}
          <p className="ny-hint">{choice === 'email' ? 'The first email goes right away (inside sending hours and the daily limit).' : 'Nothing is sent before that date.'} Every email shown here is exactly what goes out.</p>
        </div>
      )}
      {choice === 'by_hand' && <p className="ny-hint">No system email to {a.contact?.name || 'this person'}. You write to them yourself.</p>}
      {choice === 'as_planned' && <p className="ny-hint">{nextDue ? `The next system email goes on ${dayTime(nextDue)}` : 'The system emails go on their old dates'}{asPlanned ? ', already 3 working days or more after the email by hand.' : ', as if nothing was sent by hand.'}</p>}
      {choice === 'stop' && <p className="ny-hint">No more system emails to {a.contact?.name || 'this person'}. You carry on by hand.</p>}
      {choice === 'hot' && <p className="ny-hint">Moves to <b>Hot lead</b> and the meeting task goes to its owner, like any reply.</p>}
      {(choice === 'set' || choice === 'didnt_happen') && (
        <div className="ny-form">
          <label className="ny-field">{choice === 'set' ? 'Meeting time' : 'New time (leave empty if it is cancelled)'} <input type="datetime-local" value={f.at} onChange={(e) => set({ at: e.target.value })} /></label>
          {choice === 'set' && <p className="ny-hint">The meeting task gets this date. After the meeting you will be asked how it went.</p>}
        </div>
      )}
      {choice === 'opportunity' && <p className="ny-hint">The company moves to <b>Opportunity</b> and the proposal / contract task goes to its owner.</p>}
      {choice === 'cancel' && <p className="ny-hint">The meeting is marked cancelled. Set a new one from the lead page when it is booked again.</p>}
      {choice === 'deal' && <p className="ny-hint">Opens the company page: make the <b>agreement</b>, then the estimate and the advance payment, then convert it to an account.</p>}
      {choice === 'estimate' && <p className="ny-hint">Opens the company page. The estimate gets the next number and the client’s details; nothing is sent until you press Send.</p>}
      {choice === 'revise' && <p className="ny-hint">Opens the company page to make the next version of the agreement from this one. Nothing is sent until you press Send.</p>}
      {choice === 'received' && (
        <div className="ny-form">
          <label className="ny-field">Amount received (₹) <input inputMode="numeric" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></label>
          <label className="ny-field">Received on <input type="date" value={f.payDate} onChange={(e) => set({ payDate: e.target.value })} />{f.payDate && <small className="ny-inwords">{inWords(f.payDate)}</small>}</label>
          <label className="ny-field">Reference (UTR / cheque, optional) <input value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></label>
          <p className="ny-hint">Saved on the company. Then tick the rest of the checklist and convert it to an account.</p>
        </div>
      )}
      {choice === 'not_yet' && (
        <div className="ny-form">
          <label className="ny-field">Ask me again on <input type="date" value={f.askAgain} min={ymd(new Date())} onChange={(e) => set({ askAgain: e.target.value })} />{f.askAgain && <small className="ny-inwords">{inWords(f.askAgain)}</small>}</label>
          <p className="ny-hint">The card hides until then and comes back.</p>
        </div>
      )}

      <div className="ny-bar">
        <button className="btn sm" disabled={busy || !choice} onClick={save}><LuCheck /> {busy ? 'Saving…' : 'Yes, do it'}</button>
      </div>
    </div>
  );
}

function Scheduled() {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api('/api/actions/scheduled').then(setD).catch((e) => notify(e.message, 'error')), []);
  useEffect(() => {
    load();
  }, [load]);
  const save = async () => {
    try {
      await api(`/api/actions/scheduled/${edit._id}`, { method: 'PUT', body: { sendAt: fromDate(edit.date), body: edit.body } });
      notify('Saved');
      setEdit(null);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const cancel = async (s) => {
    if (!window.confirm(`Cancel the ${s.label.toLowerCase()} to ${s.contact?.name || s.contact?.email}?`)) return;
    await api(`/api/actions/scheduled/${s._id}`, { method: 'DELETE' }).catch((e) => notify(e.message, 'error'));
    load();
  };
  if (!d) return <p className="muted">Loading…</p>;
  if (!d.items.length) return <p className="empty">No follow-ups planned.</p>;
  return (
    <div className="ny-list">
      <p className="muted small">{d.thisWeek} going out in the next 7 days. They go from the time set in Settings, inside the daily limit.</p>
      {d.items.map((s) => (
        <div key={s._id} className={`ny-sched ${s.status}`}>
          <div className="ny-top">
            <span className="ny-kind"><LuMail /> {s.label}</span>
            <b className="ny-who">{s.contact ? <Link href={leadHref(s.contact, 'emails')}>{s.contact.name || s.contact.email}</Link> : 'Deleted contact'}{s.contact?.company ? ` · ${s.contact.company}` : ''}</b>
            <small className={s.status === 'failed' ? 'ny-fail' : 'muted'}>{s.status === 'held' ? 'On hold: emailed by hand, decide in Needs you · ' : ''}{s.status === 'failed' ? `Failed: ${s.error}` : day(s.sendAt)}{s.remaining ? ` · then ${s.remaining} more if no reply` : ''}</small>
          </div>
          {edit?._id === s._id ? (
            <div className="ny-form">
              <label className="ny-field">Send on <input type="date" value={edit.date} min={ymd(new Date())} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />{edit.date && <small className="ny-inwords">{inWords(edit.date)}</small>}</label>
              <textarea rows={6} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
              <div className="ny-bar"><button className="btn sm" onClick={save}>Save</button><button className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button></div>
            </div>
          ) : (
            <>
              <p className="ny-body">{s.body}</p>
              <div className="ny-bar">
                <button className="btn ghost sm" onClick={() => setEdit({ _id: s._id, date: ymd(s.sendAt), body: s.body })}>Change</button>
                <button className="btn ghost sm" onClick={() => cancel(s)}><LuTrash2 /> Cancel it</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function Decided({ onUndo }) {
  const [list, setList] = useState(null);
  const load = useCallback(() => api('/api/actions?status=done').then((r) => setList(r.items)).catch(() => setList([])), []);
  useEffect(() => {
    load();
  }, [load]);
  const undo = async (a) => {
    try {
      await api(`/api/actions/${a._id}/undo`, { method: 'POST' });
      notify('Undone. It is back in Needs you.');
      load();
      onUndo?.();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  if (!list) return <p className="muted">Loading…</p>;
  if (!list.length) return <p className="empty">Nothing decided yet.</p>;
  const label = (a) => (choicesFor(a).find(([k]) => k === a.decision?.choice) || [null, a.decision?.note || a.status])[1];
  return (
    <div className="ny-list">
      {list.map((a) => (
        <div key={a._id} className="ny-done">
          <span className="ny-kind">{KIND[a.kind]}</span>
          <b>{a.contact?.name || a.company?.name || '—'}</b>
          <span>{label(a)}{a.decision?.date ? ` · ${day(a.decision.date)}` : ''}{a.decision?.at ? ` · ${dayTime(a.decision.at)}` : ''}</span>
          <small className="muted">{a.decidedBy ? `${a.decidedBy} · ` : ''}{date(a.decidedAt)}</small>
          {a.canUndo && <button className="btn ghost sm" onClick={() => undo(a)}><LuUndo2 /> Undo</button>}
        </div>
      ))}
    </div>
  );
}

/** the whole Needs-you area. admin: all tabs. Employees: only their open questions. */
export default function NeedsYou({ admin = true, onCount }) {
  const [tab, setTab] = useState('open');
  const [d, setD] = useState(null);
  const load = useCallback(() => {
    api('/api/actions')
      .then((r) => {
        setD(r);
        onCount?.(r.items.length);
      })
      .catch((e) => notify(e.message, 'error'));
  }, [onCount]);
  useEffect(() => {
    load();
  }, [load]);
  const items = useMemo(() => d?.items || [], [d]);
  const done = (out) => setD((x) => ({ ...x, items: x.items.filter((i) => i._id !== out._id) }));
  return (
    <div className="ny">
      <style>{css}</style>
      {admin && (
        <div className="ny-tabs">
          <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Needs you{items.length ? ` (${items.length})` : ''}</button>
          <button className={tab === 'scheduled' ? 'on' : ''} onClick={() => setTab('scheduled')}>Planned follow-ups</button>
          <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}><LuRotateCcw /> Decided</button>
        </div>
      )}
      {tab === 'open' && (!d ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="empty">Nothing needs you right now. ✓</p> : <div className="ny-list">{items.map((a) => <ActionCard key={a._id} a={a} settings={d.settings} onDone={done} admin={admin} />)}</div>)}
      {tab === 'scheduled' && <Scheduled />}
      {tab === 'done' && <Decided onUndo={load} />}
    </div>
  );
}

const css = `
.ny { display: flex; flex-direction: column; gap: 14px; }
.ny-tabs { display: inline-flex; gap: 4px; background: rgba(255,255,255,.6); border: 1px solid rgba(255,255,255,.8); border-radius: 14px; padding: 4px; align-self: flex-start; flex-wrap: wrap; }
.ny-tabs button { background: none; border: 0; padding: 8px 14px; border-radius: 10px; font: inherit; font-weight: 600; color: #64748b; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.ny-tabs button.on { background: #fff; color: var(--c-700, #0b87a5); box-shadow: 0 2px 8px rgba(30,41,59,.08); }
.ny-list { display: flex; flex-direction: column; gap: 12px; }
.ny-card, .ny-sched { background: #fff; border-radius: 18px; padding: 16px 18px; box-shadow: 0 10px 28px rgba(30,41,59,.06); border: 1px solid rgba(226,232,240,.9); display: flex; flex-direction: column; gap: 10px; }
.ny-card.late { border-color: #fecaca; box-shadow: 0 0 0 2px #fee2e2; }
.ny-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ny-kind { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: #0b87a5; background: #e0f7fc; border-radius: 99px; padding: 3px 9px; }
.ny-kind.k-meeting, .ny-kind.k-meeting_outcome { color: #7c3aed; background: #ede9fe; }
.ny-who { font-size: 15px; } .ny-who a { color: inherit; } .ny-who a:hover { color: #0b87a5; }
.ny-top small { margin-left: auto; }
.ny-quote { margin: 0; padding: 10px 12px; background: #f8fafc; border-left: 3px solid #cbd5e1; border-radius: 8px; white-space: pre-wrap; font-size: 13.5px; color: #334155; max-height: 180px; overflow: auto; }
.ny-suggest { margin: 0; font-size: 13.5px; color: #334155; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
.ny-note { font-size: 12.5px; color: #475569; background: #f1f5f9; border-radius: 99px; padding: 2px 9px; }
.ny-note.warn { color: #92400e; background: #fef3c7; }
.ny-line { margin: 0; font-size: 13.5px; }
.ny-choices { display: flex; flex-wrap: wrap; gap: 6px; }
.ny-choices button { border: 1px solid #e2e8f0; background: #fff; border-radius: 99px; padding: 7px 13px; font: inherit; font-size: 13px; font-weight: 600; color: #475569; cursor: pointer; }
.ny-choices button.sug { border-style: dashed; border-color: #7dd3e8; }
.ny-choices button.on { background: #0b87a5; border-color: #0b87a5; color: #fff; }
.ny-form { display: flex; flex-direction: column; gap: 10px; background: #f8fafc; border-radius: 14px; padding: 12px; }
.ny-inwords { display: block; margin-top: 4px; font-size: 12.5px; font-weight: 600; color: #0b87a5; }
.ny-field { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; font-weight: 600; color: #475569; max-width: 320px; }
.ny-field.ny-wide { max-width: none; }
.ny-field input, .ny-field select, .ny-field textarea { font: inherit; font-weight: 400; }
.ny-inline { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 13px; color: #334155; cursor: pointer; }
.ny-inline input[type=checkbox] { width: 16px; height: 16px; accent-color: #0b87a5; }
.ny-name { flex: 1; min-width: 180px; }
.ny-hint { margin: 0; font-size: 12.5px; color: #64748b; }
.ny-msg { display: flex; flex-direction: column; gap: 6px; }
.ny-msg textarea { width: 100%; font: inherit; font-size: 13.5px; line-height: 1.5; }
.ny-tpls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ny-lbl { font-size: 12.5px; font-weight: 600; color: #475569; margin-right: 4px; }
.ny-tpls button { border: 1px solid #e2e8f0; background: #fff; border-radius: 99px; padding: 5px 11px; font: inherit; font-size: 12.5px; color: #475569; cursor: pointer; }
.ny-tpls button.on { border-color: #0b87a5; color: #0b87a5; background: #e0f7fc; font-weight: 600; }
.ny-bar { display: flex; gap: 8px; flex-wrap: wrap; }
.ny-body { margin: 0; white-space: pre-wrap; font-size: 13px; color: #334155; max-height: 130px; overflow: auto; }
.ny-fail { color: #b91c1c; }
.ny-done { display: grid; grid-template-columns: auto 1fr auto auto auto; align-items: center; gap: 10px; background: #fff; border-radius: 14px; padding: 10px 14px; border: 1px solid #eef2f6; font-size: 13.5px; }
@media (max-width: 700px) { .ny-done { grid-template-columns: 1fr; } .ny-top small { margin-left: 0; } }
`;
