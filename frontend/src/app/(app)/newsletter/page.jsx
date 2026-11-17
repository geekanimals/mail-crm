'use client';
// Newsletter (admin): leads whose whole email sequence went out with no reply join this list on their own.
// Write a newsletter, send yourself a test, then send it to the list. It goes out slowly, inside its own limits.
import { useCallback, useEffect, useState } from 'react';
import { api, date, notify } from '@/lib/api';
import { ConfirmDialog } from '@/lib/hr';

const STATUS = { draft: 'Draft', sending: 'Sending', sent: 'Sent', stopped: 'Stopped' };

export default function NewsletterPage() {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null); // { _id?, subject, body }
  const [test, setTest] = useState('');
  const [people, setPeople] = useState(null);
  const [ask, setAsk] = useState(null);
  const load = useCallback(() => api('/api/newsletter').then(setD).catch((e) => notify(e.message, 'error')), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 20000); // progress while sending
    return () => clearInterval(t);
  }, [load]);

  const run = async (fn, msg) => {
    try {
      const out = await fn();
      if (msg) notify(msg);
      load();
      return out || true;
    } catch (e) {
      notify(e.message, 'error');
      return false;
    }
  };
  const save = async (e) => {
    e.preventDefault();
    const out = await run(() => api(edit._id ? `/api/newsletter/${edit._id}` : '/api/newsletter', { method: edit._id ? 'PUT' : 'POST', body: { subject: edit.subject, body: edit.body } }), 'Draft saved');
    if (out) setEdit({ ...edit, _id: out._id });
  };
  const send = (n) => setAsk({
    title: `Send "${n.subject}" to ${d.audience} people?`,
    text: `It goes out slowly – at most ${d.sender.hourly} an hour and ${d.sender.daily} a day – from ${d.sender.fromEmail}. You can stop it while it is sending.`,
    confirm: 'Yes, send',
    run: async () => {
      await api(`/api/newsletter/${n._id}/send`, { method: 'POST' });
      notify('Sending started');
      setEdit(null);
      load();
    },
  });
  const remove = (n) => setAsk({
    title: `Delete "${n.subject}"?`,
    text: 'The newsletter and its sending record are removed.',
    confirm: 'Yes, delete',
    danger: true,
    run: async () => {
      await api(`/api/newsletter/${n._id}`, { method: 'DELETE' });
      if (edit?._id === n._id) setEdit(null);
      load();
    },
  });
  const toggle = () => setAsk({
    title: d.on ? 'Switch the newsletter off?' : 'Switch the newsletter on?',
    text: d.on
      ? 'Nothing will be sent and finished leads will not join the list. A newsletter that is sending pauses until you switch it on again.'
      : 'Leads who get all their emails with no reply will join the list from now on, and you can send newsletters.',
    confirm: d.on ? 'Yes, switch off' : 'Yes, switch on',
    danger: d.on,
    run: async () => {
      await api('/api/newsletter/settings', { method: 'PUT', body: { on: !d.on } });
      notify(d.on ? 'Newsletter switched off' : 'Newsletter switched on');
      load();
    },
  });
  const showPeople = () => api('/api/newsletter/people').then(setPeople).catch((e) => notify(e.message, 'error'));

  if (!d) return <p className="muted">Loading…</p>;
  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Newsletter</h1>
          <p>Leads who got all their emails and never replied move here on their own. Keep them warm with a newsletter.</p>
        </div>
        <div className="row">
          <button type="button" className={`nl-switch ${d.on ? 'on' : ''}`} onClick={toggle} aria-pressed={d.on}><span /> {d.on ? 'On' : 'Off'}</button>
          {!edit && d.on && <button className="btn" onClick={() => setEdit({ subject: '', body: '' })}>New newsletter</button>}
        </div>
      </div>
      {!d.on && (
        <div className="card nl-off">
          <b>The newsletter is switched off.</b>
          <span>Nothing is sent and no lead joins the list. Switch it on when you have decided what goes in it, how often and from which email.</span>
        </div>
      )}

      <div className="nl-top">
        <button onClick={showPeople}><b>{d.audience}</b><span>On the list (see who)</span></button>
        <div><b>{d.sender.fromEmail || '—'}</b><span>{d.sender.separate ? 'Newsletter mailbox' : 'Sending mailbox (newsletter mailbox not set in .env yet)'}</span></div>
        <div><b>{d.sender.hourly}/h · {d.sender.daily}/day</b><span>Sending limit</span></div>
      </div>
      {d.on && d.notYetAdded > 0 && (
        <div className="card nl-note">
          <span>{d.notYetAdded} lead(s) finished all their emails with no reply before the newsletter existed. They are not on the list yet.</span>
          <button className="btn soft sm" onClick={() => run(() => api('/api/newsletter/add-finished', { method: 'POST' })).then((r) => r && notify(`${r.added} added to the newsletter list`))}>Add them</button>
        </div>
      )}

      {people && (
        <div className="card">
          <div className="row nl-between"><h2>On the list ({people.length}{people.length === 300 ? '+' : ''})</h2><button className="btn ghost sm" onClick={() => setPeople(null)}>Close</button></div>
          {people.length === 0 && <p className="empty">Nobody yet.</p>}
          {people.map((p) => (
            <div key={p._id} className="nl-person">
              <div><b>{p.name || p.email}</b><small>{[p.email, p.company].filter(Boolean).join(' · ')} · since {date(p.newsletterAt)}</small></div>
              <button className="btn ghost sm" onClick={() => run(() => api(`/api/newsletter/people/${p._id}`, { method: 'DELETE' }), 'Removed from the list').then(() => showPeople())}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <form className="card nl-form" onSubmit={save}>
          <h2>{edit._id ? 'Edit draft' : 'New newsletter'}</h2>
          <label className="field">Subject<input required maxLength={200} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></label>
          <label className="field">Newsletter<textarea required rows={14} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} placeholder={'Write it like an email. Leave an empty line between paragraphs.\nLinks (https://…) become clickable. An unsubscribe link is added at the end.'} /></label>
          <div className="row">
            <button className="btn">Save draft</button>
            <button type="button" className="btn ghost" onClick={() => setEdit(null)}>Close</button>
          </div>
          {edit._id && (
            <div className="row nl-test">
              <input type="email" placeholder="your@email.com" value={test} onChange={(e) => setTest(e.target.value)} />
              <button type="button" className="btn soft sm" disabled={!test || !d.on} onClick={() => run(() => api(`/api/newsletter/${edit._id}/test`, { method: 'POST', body: { email: test } }), `Test sent to ${test}`)}>Send me a test</button>
            </div>
          )}
        </form>
      )}

      <div className="card">
        <h2>Newsletters</h2>
        {d.list.length === 0 && <p className="empty">{d.on ? 'None yet. What goes in it is up to you – write the first one with “New newsletter”.' : 'None yet. Switch the newsletter on to write the first one.'}</p>}
        {d.list.map((n) => (
          <div key={n._id} className="nl-item">
            <div>
              <b>{n.subject}</b>
              <small>{STATUS[n.status]}{n.status !== 'draft' ? ` · ${n.sent} of ${n.total} sent${n.failed ? ` · ${n.failed} failed` : ''}` : ''} · {date(n.startedAt || n.createdAt)}</small>
              {n.status === 'sending' && <span className="hr-progress"><i style={{ width: `${n.total ? Math.round(((n.sent + n.failed) / n.total) * 100) : 0}%` }} /></span>}
            </div>
            <div className="row">
              {n.status === 'draft' && <button className="btn ghost sm" onClick={() => setEdit({ _id: n._id, subject: n.subject, body: n.body })}>Edit</button>}
              {n.status === 'draft' && <button className="btn sm" disabled={!d.on || !d.audience} onClick={() => send(n)}>Send</button>}
              {n.status === 'sending' && <button className="btn ghost sm" onClick={() => run(() => api(`/api/newsletter/${n._id}/stop`, { method: 'POST' }), 'Stopped')}>Stop</button>}
              {n.status !== 'sending' && <button className="btn ghost sm tm-del" onClick={() => remove(n)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
      <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}

const css = `
.nl-top { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px; }
.nl-top > * { background: rgba(255,255,255,.8); border: 1px solid rgba(255,255,255,.9); box-shadow: 0 10px 30px rgba(30,41,99,.06); border-radius: 18px; padding: 14px 16px; display: flex; flex-direction: column; text-align: left; font: inherit; color: inherit; min-width: 0; }
.nl-top button { cursor: pointer; }
.nl-top b { font-size: 18px; color: #0b87a5; overflow-wrap: anywhere; }
.nl-top span { font-size: 12.5px; color: #64748b; }
.nl-note { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.nl-between { justify-content: space-between; }
.nl-off { display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(217,119,6,.3); background: #fffbeb; color: #92400e; }
.nl-switch { display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(148,163,184,.4); background: #fff; border-radius: 99px; padding: 6px 14px 6px 6px; font: inherit; font-weight: 700; color: #64748b; cursor: pointer; }
.nl-switch span { width: 36px; height: 20px; border-radius: 99px; background: #cbd5e1; position: relative; transition: background .2s; }
.nl-switch span::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .2s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.nl-switch.on { color: #0b87a5; border-color: rgba(26,169,200,.4); }
.nl-switch.on span { background: #1aa9c8; }
.nl-switch.on span::after { left: 18px; }
.nl-form textarea { font-family: inherit; line-height: 1.55; }
.nl-test input { font: inherit; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(148,163,184,.4); min-width: 0; flex: 1; max-width: 300px; }
.nl-item, .nl-person { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px dashed rgba(148,163,184,.3); flex-wrap: wrap; }
.nl-item > div:first-child, .nl-person > div:first-child { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.nl-item small, .nl-person small { color: #64748b; font-size: 12.5px; overflow-wrap: anywhere; }
.hr-progress { display: block; height: 6px; border-radius: 99px; background: #e2e8f0; overflow: hidden; max-width: 280px; }
.hr-progress i { display: block; height: 100%; background: linear-gradient(90deg, #4fcde7, #1aa9c8); }
@media (max-width: 700px) { .nl-top { grid-template-columns: 1fr; } }
`;
