'use client';
// Newsletter (admin): leads whose whole email sequence went out with no reply join this list on their own.
// Each issue uses the fixed "This Week at Geek" design: only the photos, videos, text and links change.
// Build it (live preview), send yourself a test, then approve it: it goes out on the scheduled date, slowly, inside its own limits.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_URL, api, date, getToken, notify, num } from '@/lib/api';
import { ConfirmDialog } from '@/lib/hr';

const STATUS = { draft: 'Draft', scheduled: 'Approved · scheduled', sending: 'Sending', sent: 'Sent', stopped: 'Stopped' };
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h) => `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
/** ISO -> value for <input type="datetime-local"> (the browser's own time) */
const toLocal = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const blankDesign = () => ({
  preheader: '',
  intro: "Here's your weekly snapshot of what we've been working on across campaigns, creators, content and new work. We're moving fast and building what's next, together.",
  highlightsTitle: 'Featured Highlights',
  highlights: [{ media: null, link: '' }, { media: null, link: '' }, { media: null, link: '' }, { media: null, link: '' }],
  stories: [{ media: null, link: '', title: '', text: '' }, { media: null, link: '', title: '', text: '' }],
  newsTitle: "What's New",
  news: ['', ''],
});
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '0%');

export default function NewsletterPage() {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null); // the issue being edited
  const [people, setPeople] = useState(null);
  const [ask, setAsk] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [picker, setPicker] = useState(null); // { pick(media) }
  const [report, setReport] = useState(null);
  const [approve, setApprove] = useState(null); // { n, at }
  const load = useCallback(() => api('/api/newsletter').then(setD).catch((e) => notify(e.message, 'error')), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // progress while sending
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
  const open = async (n) => {
    const full = await run(() => api(`/api/newsletter/${n._id}`));
    if (full) setEdit(full.format === 'design' ? { ...full, design: { ...blankDesign(), ...full.design } } : full);
  };
  const toggle = () => setAsk({
    title: d.on ? 'Switch the newsletter off?' : 'Switch the newsletter on?',
    text: d.on
      ? 'Nothing will be sent and finished leads will not join the list. A newsletter that is sending or scheduled waits until you switch it on again.'
      : 'Leads who get all their emails with no reply will join the list from now on, and approved issues will go out on their dates.',
    confirm: d.on ? 'Yes, switch off' : 'Yes, switch on',
    danger: d.on,
    run: async () => {
      await api('/api/newsletter/settings', { method: 'PUT', body: { on: !d.on } });
      notify(d.on ? 'Newsletter switched off' : 'Newsletter switched on');
      load();
    },
  });
  const sendNow = (n) => setAsk({
    title: `Send "${n.subject}" now to ${num(d.audience)} ${d.audience === 1 ? 'person' : 'people'}?`,
    text: `It goes out slowly – at most ${d.sender.hourly} an hour and ${d.sender.daily} a day, between ${hourLabel(d.window.start)} and ${hourLabel(d.window.end)} – from ${d.sender.fromEmail}. You can stop it while it is sending.`,
    confirm: 'Yes, send now',
    run: async () => {
      await api(`/api/newsletter/${n._id}/send`, { method: 'POST' });
      notify('Sending started');
      setEdit(null);
      load();
    },
  });
  const remove = (n) => setAsk({
    title: `Delete "${n.subject}"?`,
    text: 'The issue and its sending record are removed. Photos stay in the library.',
    confirm: 'Yes, delete',
    danger: true,
    run: async () => {
      await api(`/api/newsletter/${n._id}`, { method: 'DELETE' });
      if (edit?._id === n._id) setEdit(null);
      load();
    },
  });
  const copy = async (n) => {
    const c = await run(() => api(`/api/newsletter/${n._id}/copy`, { method: 'POST' }), 'Copied as a new draft');
    if (c) setEdit(c.format === 'design' ? { ...c, design: { ...blankDesign(), ...c.design } } : c);
  };
  const showPeople = () => api('/api/newsletter/people').then(setPeople).catch((e) => notify(e.message, 'error'));
  const startApprove = async (n) => {
    let target = n;
    if (edit && (edit === n || edit._id === n._id) && edit.status === 'draft') {
      const saved = await saveEdit(true); // the editor's latest changes are saved first
      if (!saved) return;
      target = saved;
    }
    setApprove({ n: target, at: toLocal(d.nextSlot) });
  };
  const sendFromEditor = async () => {
    const saved = await saveEdit(true);
    if (saved) sendNow(saved);
  };
  const saveEdit = async (quiet) => {
    const body = edit.format === 'design' ? { subject: edit.subject, format: 'design', design: edit.design } : { subject: edit.subject, format: 'text', body: edit.body };
    const out = await run(() => api(edit._id ? `/api/newsletter/${edit._id}` : '/api/newsletter', { method: edit._id ? 'PUT' : 'POST', body }), quiet ? null : 'Draft saved');
    if (out) setEdit((e) => ({ ...e, _id: out._id, status: out.status }));
    return out;
  };

  if (!d) return <p className="muted">Loading…</p>;
  const c = d.counts;
  const held = [
    [c.held.company, 'their company is talking to us'],
    [c.held.wait, `finished their emails less than ${d.settings.waitDays} days ago`],
    [c.held.sequence, 'are in a new email sequence'],
    [c.held.outcome, 'were marked later / not interested'],
    [c.held.max, `already got ${d.settings.maxIssues} issues`],
  ].filter(([n]) => n > 0);
  const scheduled = d.list.find((n) => n.status === 'scheduled');
  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Newsletter</h1>
          <p>Leads who got all their emails and never replied get “This Week at Geek”. Nobody from a company that is talking to us gets it.</p>
        </div>
        <div className="row">
          <button type="button" className={`nl-switch ${d.on ? 'on' : ''}`} onClick={toggle} aria-pressed={d.on}><span /> {d.on ? 'On' : 'Off'}</button>
          <button type="button" className="btn ghost" onClick={() => setShowSettings((s) => !s)}>{showSettings ? 'Close settings' : 'Settings'}</button>
          {!edit && <button className="btn" onClick={() => setEdit({ subject: 'This Week at Geek', format: 'design', status: 'draft', design: blankDesign() })}>New issue</button>}
        </div>
      </div>
      {!d.on && (
        <div className="card nl-off">
          <b>The newsletter is switched off.</b>
          <span>Nothing is sent and no lead joins the list. You can still build issues and send yourself a test. Switch it on when you are ready.</span>
        </div>
      )}
      {!d.ffmpeg && (
        <div className="card nl-off">
          <b>Photos and videos cannot be uploaded yet.</b>
          <span>The server needs ffmpeg to prepare them for email. In the backend folder run <code>npm install ffmpeg-static</code>, then restart the backend.</span>
        </div>
      )}

      <div className="nl-top">
        <button onClick={showPeople}><b>{num(c.list)}</b><span>On the list (see who)</span></button>
        <div title={held.map(([n, t]) => `${n} ${t}`).join('\n')}>
          <b>{num(c.next)}</b>
          <span>Get the next issue{held.length ? ` · ${num(c.list - c.next)} held back` : ''}</span>
        </div>
        <div><b>{d.settings.gapDays === 7 ? 'Every week' : `Every ${d.settings.gapDays} days`}</b><span>{scheduled ? `Next: ${when(scheduled.sendAt)}` : `Next free date: ${when(d.nextSlot)}`}</span></div>
        <div><b className="nl-small">{d.sender.fromEmail || '—'}</b><span>{d.sender.separate ? 'Newsletter mailbox' : 'Sending mailbox'} · {d.sender.hourly}/h · {d.sender.daily}/day</span></div>
      </div>
      {held.length > 0 && (
        <p className="nl-held">Held back from the next issue: {held.map(([n, t]) => `${num(n)} ${t}`).join(' · ')}.</p>
      )}
      {d.on && !scheduled && !d.list.some((n) => n.status === 'sending') && (
        <div className="card nl-note"><span>No issue is approved for the next date ({when(d.nextSlot)}). Build one and approve it, or nothing goes out.</span></div>
      )}
      {d.on && d.notYetAdded > 0 && (
        <div className="card nl-note">
          <span>{num(d.notYetAdded)} lead(s) finished all their emails with no reply before the newsletter was switched on. They are not on the list yet.</span>
          <button className="btn soft sm" onClick={() => run(() => api('/api/newsletter/add-finished', { method: 'POST' })).then((r) => r && notify(`${r.added} added to the newsletter list`))}>Add them</button>
        </div>
      )}

      {showSettings && <Settings d={d} onSaved={load} />}

      {people && (
        <div className="card">
          <div className="row nl-between"><h2>On the list ({people.length}{people.length === 300 ? '+' : ''})</h2><button className="btn ghost sm" onClick={() => setPeople(null)}>Close</button></div>
          {people.length === 0 && <p className="empty">Nobody yet.</p>}
          {people.map((p) => (
            <div key={p._id} className="nl-person">
              <div><b>{p.name || p.email}</b><small>{[p.email, p.company].filter(Boolean).join(' · ')} · since {date(p.newsletterAt)}{p.newsletterCount ? ` · ${p.newsletterCount} issue${p.newsletterCount > 1 ? 's' : ''} sent` : ''}</small></div>
              <button className="btn ghost sm" onClick={() => run(() => api(`/api/newsletter/people/${p._id}`, { method: 'DELETE' }), 'Removed from the list').then(() => showPeople())}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <Editor
          edit={edit}
          setEdit={setEdit}
          d={d}
          onSave={() => saveEdit(false)}
          onClose={() => setEdit(null)}
          onPick={(pick) => setPicker({ pick })}
          onApprove={() => startApprove(edit)}
          onSendNow={sendFromEditor}
          run={run}
        />
      )}

      <div className="card">
        <h2>Issues</h2>
        {d.list.length === 0 && <p className="empty">None yet. Build the first one with “New issue”.</p>}
        {d.list.map((n) => (
          <div key={n._id} className="nl-item">
            <div>
              <b>{n.subject}</b>
              <small>
                <span className={`nl-chip ${n.status}`}>{STATUS[n.status]}</span>
                {n.status === 'scheduled' && ` ${when(n.sendAt)}`}
                {['sending', 'sent', 'stopped'].includes(n.status) && ` ${num(n.sent)} of ${num(n.total)} sent${n.failed ? ` · ${n.failed} failed` : ''} · ${pct(n.opened, n.sent)} opened · ${pct(n.clicked, n.sent)} clicked · ${date(n.startedAt)}`}
                {n.status === 'draft' && ` · ${date(n.createdAt)}`}
                {n.format !== 'design' && ' · plain text'}
              </small>
              {n.note && <small>{n.note}</small>}
              {n.status === 'sending' && <span className="hr-progress"><i style={{ width: `${n.total ? Math.round(((n.sent + n.failed) / n.total) * 100) : 0}%` }} /></span>}
            </div>
            <div className="row">
              {n.status === 'draft' && <button className="btn ghost sm" onClick={() => open(n)}>Edit</button>}
              {n.status === 'draft' && <button className="btn sm" disabled={!d.on} title={d.on ? '' : 'Switch the newsletter on first'} onClick={() => startApprove(n)}>Approve</button>}
              {n.status === 'scheduled' && <button className="btn ghost sm" onClick={() => open(n)}>View</button>}
              {n.status === 'scheduled' && <button className="btn ghost sm" onClick={() => run(() => api(`/api/newsletter/${n._id}/unschedule`, { method: 'POST' }), 'Moved back to draft')}>Back to draft</button>}
              {['draft', 'scheduled'].includes(n.status) && <button className="btn ghost sm" disabled={!d.on || !d.audience} onClick={() => sendNow(n)}>Send now</button>}
              {n.status === 'sending' && <button className="btn ghost sm" onClick={() => run(() => api(`/api/newsletter/${n._id}/stop`, { method: 'POST' }), 'Stopped')}>Stop</button>}
              {['sending', 'sent', 'stopped'].includes(n.status) && <button className="btn ghost sm" onClick={() => api(`/api/newsletter/${n._id}/report`).then(setReport).catch((e) => notify(e.message, 'error'))}>Report</button>}
              {['sent', 'stopped'].includes(n.status) && <button className="btn ghost sm" onClick={() => open(n)}>View</button>}
              <button className="btn ghost sm" onClick={() => copy(n)}>Copy</button>
              {n.status !== 'sending' && <button className="btn ghost sm tm-del" onClick={() => remove(n)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>

      {picker && <Library onClose={() => setPicker(null)} onPick={(m) => (picker.pick(m), setPicker(null))} ready={d.ffmpeg} />}
      {report && <Report report={report} onClose={() => setReport(null)} />}
      {approve && (
        <Modal onClose={() => setApprove(null)}>
          <h3>Approve “{approve.n.subject}”</h3>
          <p className="nl-help">It goes out on its own at this time to everyone due then (now {num(d.audience)} {d.audience === 1 ? 'person' : 'people'}). The suggested time is {d.settings.gapDays} days after the last issue, at {hourLabel(d.settings.sendHour)}.</p>
          <label className="field">Send on<input type="datetime-local" value={approve.at} onChange={(e) => setApprove({ ...approve, at: e.target.value })} /></label>
          <div className="row nl-end">
            <button className="btn ghost" onClick={() => setApprove(null)}>Cancel</button>
            <button
              className="btn"
              disabled={!approve.at}
              onClick={async () => {
                const ok = await run(() => api(`/api/newsletter/${approve.n._id}/schedule`, { method: 'POST', body: { sendAt: new Date(approve.at).toISOString() } }), 'Approved and scheduled');
                if (ok) {
                  setApprove(null);
                  if (edit?._id === approve.n._id) setEdit(null);
                }
              }}
            >
              Approve &amp; schedule
            </button>
          </div>
        </Modal>
      )}
      <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}

/* ---------------- settings ---------------- */
function Settings({ d, onSaved }) {
  const [s, setS] = useState(() => ({ ...d.settings }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const hours = HOURS.filter((h) => h >= d.window.start && h < d.window.end);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/newsletter/settings', { method: 'PUT', body: { ...s, gapDays: Number(s.gapDays), sendHour: Number(s.sendHour), waitDays: Number(s.waitDays), maxIssues: Number(s.maxIssues), hourly: Number(s.hourly), daily: Number(s.daily) } });
      notify('Settings saved');
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <form className="card nl-settings" onSubmit={save}>
      <h2>Settings</h2>
      <div className="nl-grid">
        <label className="field">How often
          <select value={[7, 14, 30].includes(Number(s.gapDays)) ? String(s.gapDays) : 'x'} onChange={(e) => setS({ ...s, gapDays: e.target.value === 'x' ? 10 : Number(e.target.value) })}>
            <option value="7">Every week</option>
            <option value="14">Every 2 weeks</option>
            <option value="30">Every month</option>
            <option value="x">Every … days</option>
          </select>
        </label>
        {![7, 14, 30].includes(Number(s.gapDays)) && <label className="field">Days between issues<input type="number" min={1} max={90} value={s.gapDays} onChange={set('gapDays')} /></label>}
        <label className="field">Send time (IST)
          <select value={s.sendHour} onChange={set('sendHour')}>{hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
        </label>
        <label className="field">First issue after the last email<span className="nl-unit"><input type="number" min={0} max={60} value={s.waitDays} onChange={set('waitDays')} /> days</span></label>
        <label className="field">How long it goes to a person
          <select value={Number(s.maxIssues) > 0 ? 'n' : '0'} onChange={(e) => setS({ ...s, maxIssues: e.target.value === '0' ? 0 : 6 })}>
            <option value="0">Until they unsubscribe</option>
            <option value="n">A set number of issues</option>
          </select>
        </label>
        {Number(s.maxIssues) > 0 && <label className="field">Number of issues<input type="number" min={1} max={520} value={s.maxIssues} onChange={set('maxIssues')} /></label>}
        <label className="field">Send from
          <select value={s.mailbox} onChange={set('mailbox')}>
            <option value="sequence">The sending mailbox (same as the sequence emails)</option>
            <option value="newsletter" disabled={!d.sender.newsletterMailbox}>The newsletter mailbox{d.sender.newsletterMailbox ? '' : ' (not set in .env)'}</option>
          </select>
        </label>
        <label className="field">Sender name<input value={s.fromName} placeholder={d.sender.fromName} maxLength={80} onChange={set('fromName')} /></label>
        <label className="field">Replies go to<input type="email" value={s.replyTo} placeholder={d.sender.replyTo || 'the sending mailbox'} onChange={set('replyTo')} /></label>
        <label className="field">“Talk to Geek.” opens<input value={s.ctaLink} placeholder={d.defaults.ctaLink} onChange={set('ctaLink')} /></label>
        <label className="field">At most an hour<input type="number" min={0} max={500} value={s.hourly} onChange={set('hourly')} /><small>0 = {d.sender.hourly} (from .env)</small></label>
        <label className="field">At most a day<input type="number" min={0} max={2000} value={s.daily} onChange={set('daily')} /><small>0 = {d.sender.daily} (from .env)</small></label>
      </div>
      <p className="nl-help">Replies to the newsletter come to Needs you like any other reply. Anyone who unsubscribes never gets it again.</p>
      <div className="row"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  );
}

/* ---------------- editor + live preview ---------------- */
function Editor({ edit, setEdit, d, onSave, onClose, onPick, onApprove, onSendNow, run }) {
  const [preview, setPreview] = useState({ html: '', problems: [] });
  const [view, setView] = useState('desktop');
  const [test, setTest] = useState('');
  const readOnly = edit.status && edit.status !== 'draft';
  const des = edit.design || {};
  const setD = (patch) => setEdit((e) => ({ ...e, design: { ...e.design, ...patch } }));
  const setItem = (key, i, patch) => setEdit((e) => ({ ...e, design: { ...e.design, [key]: e.design[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) } }));
  const move = (key, i, by) => {
    const a = [...des[key]];
    const j = i + by;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setD({ [key]: a });
  };

  // live preview (half a second after the last change)
  const payload = JSON.stringify(edit.format === 'design' ? { subject: edit.subject, format: 'design', design: des } : { subject: edit.subject, format: 'text', body: edit.body });
  useEffect(() => {
    const t = setTimeout(() => {
      api('/api/newsletter/preview', { method: 'POST', body: JSON.parse(payload) }).then(setPreview).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [payload]);

  const testSend = async () => {
    let id = edit._id;
    if (!readOnly) {
      const saved = await onSave(); // the test is the latest version
      if (!saved) return;
      id = saved._id;
    }
    await run(() => api(`/api/newsletter/${id}/test`, { method: 'POST', body: { email: test } }), `Test sent to ${test}`);
  };

  return (
    <div className="card nl-editor">
      <div className="row nl-between">
        <h2>{readOnly ? edit.subject : edit._id ? 'Edit issue' : 'New issue'}{readOnly ? <span className={`nl-chip ${edit.status}`}>{STATUS[edit.status]}</span> : null}</h2>
        <button type="button" className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      {readOnly && <p className="nl-help">{edit.status === 'scheduled' ? 'This issue is approved. Move it back to draft (in the list below) to change it.' : 'This issue has gone out. Use “Copy” in the list below to start the next one from it.'}</p>}
      <div className="nl-split">
        <fieldset className="nl-form" disabled={readOnly}>
          <label className="field">Subject<input required maxLength={200} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></label>

          {edit.format !== 'design' ? (
            <label className="field">Newsletter (plain text)<textarea rows={14} value={edit.body || ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></label>
          ) : (
            <>
              <label className="field">Inbox preview line<input maxLength={200} value={des.preheader} placeholder="The grey line people see after the subject in their inbox" onChange={(e) => setD({ preheader: e.target.value })} /></label>
              <div className="nl-fixed">Top of the email (fixed): the Geek logo, “This Week at Geek” and the website link.</div>
              <label className="field">Lines under the heading<textarea rows={3} maxLength={2000} value={des.intro} onChange={(e) => setD({ intro: e.target.value })} /></label>

              <section className="nl-sec">
                <div className="nl-sec-head">
                  <input className="nl-title-in" value={des.highlightsTitle} maxLength={80} onChange={(e) => setD({ highlightsTitle: e.target.value })} aria-label="Section heading" />
                  <small>Up to 4 photos in one line, all in the same 4:5 box (on a phone too, just smaller). Best size <b>1080 × 1350 px</b>. A photo of another shape fills the box and its edges may be cut a little, so keep the main thing in the middle.</small>
                </div>
                {des.highlights.map((x, i) => (
                  <div key={i} className="nl-slot">
                    <MediaBox shape="h" media={x.media} onPick={() => onPick((m) => setItem('highlights', i, { media: m }))} onClear={() => setItem('highlights', i, { media: null })} />
                    <div className="nl-slot-body">
                      <label className="field">Link when clicked (optional)<input value={x.link} placeholder="https://www.instagram.com/p/…" onChange={(e) => setItem('highlights', i, { link: e.target.value })} /></label>
                      <Mover onUp={() => move('highlights', i, -1)} onDown={() => move('highlights', i, 1)} onRemove={() => setD({ highlights: des.highlights.filter((_, j) => j !== i) })} />
                    </div>
                  </div>
                ))}
                {des.highlights.length < 4 && <button type="button" className="btn soft sm" onClick={() => setD({ highlights: [...des.highlights, { media: null, link: '' }] })}>Add a photo</button>}
              </section>

              <section className="nl-sec">
                <div className="nl-sec-head"><b>Stories</b><small>Two stories side by side in one line, each a photo or video with its heading and text beside it (on a phone too, just smaller; a single story uses the whole line). Keep the text short. Every story uses the same 2:3 box. Best size <b>1080 × 1620 px</b>. A photo or video of another shape fills the box and its edges may be cut a little, so keep the main thing in the middle. A video plays as a moving picture.</small></div>
                {des.stories.map((s, i) => (
                  <div key={i} className="nl-slot">
                    <MediaBox shape="s" media={s.media} onPick={() => onPick((m) => setItem('stories', i, { media: m }))} onClear={() => setItem('stories', i, { media: null })} />
                    <div className="nl-slot-body">
                      <label className="field">Heading<input maxLength={150} value={s.title} onChange={(e) => setItem('stories', i, { title: e.target.value })} /></label>
                      <label className="field">Text<textarea rows={5} maxLength={3000} value={s.text} placeholder="Leave an empty line between paragraphs." onChange={(e) => setItem('stories', i, { text: e.target.value })} /></label>
                      <label className="field">Link when clicked (optional)<input value={s.link} placeholder={s.media?.kind === 'video' ? 'Empty = the uploaded video opens' : 'https://…'} onChange={(e) => setItem('stories', i, { link: e.target.value })} /></label>
                      <Mover onUp={() => move('stories', i, -1)} onDown={() => move('stories', i, 1)} onRemove={() => setD({ stories: des.stories.filter((_, j) => j !== i) })} />
                    </div>
                  </div>
                ))}
                {des.stories.length < 4 && <button type="button" className="btn soft sm" onClick={() => setD({ stories: [...des.stories, { media: null, link: '', title: '', text: '' }] })}>Add a story</button>}
              </section>

              <section className="nl-sec">
                <div className="nl-sec-head"><input className="nl-title-in" value={des.newsTitle} maxLength={80} onChange={(e) => setD({ newsTitle: e.target.value })} aria-label="Section heading" /><small>Short points with a tick</small></div>
                {des.news.map((t, i) => (
                  <div key={i} className="row nl-point">
                    <input value={t} maxLength={300} onChange={(e) => setD({ news: des.news.map((x, j) => (j === i ? e.target.value : x)) })} />
                    <button type="button" className="btn ghost sm" onClick={() => setD({ news: des.news.filter((_, j) => j !== i) })} aria-label="Remove">✕</button>
                  </div>
                ))}
                {des.news.length < 12 && <button type="button" className="btn soft sm" onClick={() => setD({ news: [...des.news, ''] })}>Add a point</button>}
              </section>
              <div className="nl-fixed">Bottom of the email (fixed): “Need support on your next campaign? Talk to Geek.” opens {d.settings.ctaLink}. Then the unsubscribe link.</div>
            </>
          )}
        </fieldset>

        <div className="nl-preview">
          <div className="row nl-between">
            <div className="nl-tabs">
              <button type="button" className={view === 'desktop' ? 'on' : ''} onClick={() => setView('desktop')}>Computer</button>
              <button type="button" className={view === 'phone' ? 'on' : ''} onClick={() => setView('phone')}>Phone</button>
            </div>
            <small className="muted">Live preview</small>
          </div>
          {!d.publicLinks && <p className="nl-help">This is localhost: the preview shows the photos, but in a test email they only load once the CRM is live.</p>}
          <PreviewFrame html={preview.html} view={view} />
        </div>
      </div>

      {!readOnly && preview.problems?.length > 0 && <ul className="nl-problems">{preview.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="row nl-actions">
        {!readOnly && <button type="button" className="btn" onClick={onSave}>Save draft</button>}
        {!readOnly && <button type="button" className="btn soft" disabled={!d.on || preview.problems?.length > 0} title={d.on ? '' : 'Switch the newsletter on first'} onClick={onApprove}>Approve &amp; schedule…</button>}
        {!readOnly && <button type="button" className="btn ghost" disabled={!d.on || !d.audience || preview.problems?.length > 0} onClick={onSendNow}>Send now</button>}
        <span className="nl-test">
          <input type="email" placeholder="your@email.com" value={test} onChange={(e) => setTest(e.target.value)} />
          <button type="button" className="btn soft sm" disabled={!test || (!edit._id && readOnly)} onClick={testSend}>Send me a test</button>
        </span>
      </div>
    </div>
  );
}

/** the email at its real width (computer 660 px, phone 375 px), shrunk to fit the box, so it looks exactly as in an inbox */
function PreviewFrame({ html, view }) {
  const box = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const real = view === 'phone' ? 375 : 660;
  const scale = size.w ? Math.min(1, size.w / real) : 1;
  return (
    <div ref={box} className={`nl-frame ${view}`}>
      <iframe
        title="Preview"
        srcDoc={html}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        style={{ width: real, height: size.h ? size.h / scale : '100%', transform: `scale(${scale})`, transformOrigin: '0 0' }}
      />
    </div>
  );
}

function Mover({ onUp, onDown, onRemove }) {
  return (
    <div className="row nl-mover">
      <button type="button" className="btn ghost sm" onClick={onUp} aria-label="Move up">↑</button>
      <button type="button" className="btn ghost sm" onClick={onDown} aria-label="Move down">↓</button>
      <button type="button" className="btn ghost sm tm-del" onClick={onRemove}>Remove</button>
    </div>
  );
}

function MediaBox({ media, onPick, onClear, shape }) {
  return (
    <div className="nl-media">
      {media ? (
        <>
          <button type="button" className={`nl-thumb ${shape}`} onClick={onPick} title="Change">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={(shape === 'h' ? media.boxUrl : media.storyUrl) || media.url} alt={media.name || ''} />
            {media.kind === 'video' && <i>Video</i>}
          </button>
          <div className="row"><button type="button" className="btn ghost sm" onClick={onPick}>Change</button><button type="button" className="btn ghost sm" onClick={onClear}>Clear</button></div>
        </>
      ) : (
        <button type="button" className={`nl-thumb empty ${shape}`} onClick={onPick}>+ Photo or video</button>
      )}
    </div>
  );
}

/* ---------------- photo / video library ---------------- */
function Library({ onClose, onPick, ready }) {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState('');
  const [start, setStart] = useState(0);
  const fileRef = useRef(null);
  const load = useCallback(() => api('/api/newsletter/media').then(setList).catch((e) => notify(e.message, 'error')), []);
  useEffect(() => {
    load();
  }, [load]);
  const upload = async (files) => {
    for (const f of [...files]) {
      setBusy(`Preparing ${f.name}…${/^video/.test(f.type) ? ' (a video takes a little longer)' : ''}`);
      try {
        const res = await fetch(`${API_URL}/api/newsletter/media?${new URLSearchParams({ name: f.name, start: String(start || 0) })}`, {
          method: 'POST',
          headers: { 'Content-Type': f.type || 'application/octet-stream', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
          body: f,
        });
        const out = await res.json().catch(() => null);
        if (!res.ok) throw new Error(out?.error || (res.status === 413 ? 'The file is too big for the server' : `Upload failed (${res.status})`));
        setList((l) => [out, ...(l || [])]);
      } catch (e) {
        notify(`${f.name}: ${e.message}`, 'error');
      }
    }
    setBusy('');
    if (fileRef.current) fileRef.current.value = '';
  };
  const del = async (m) => {
    try {
      const r = await api(`/api/newsletter/media/${m._id}`, { method: 'DELETE' });
      notify(r.hidden ? 'Removed from the library (kept for the emails it went out in)' : 'Deleted');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const rename = async (m, name) => {
    if (name === m.name) return;
    await api(`/api/newsletter/media/${m._id}`, { method: 'PATCH', body: { name } }).catch((e) => notify(e.message, 'error'));
  };
  return (
    <Modal onClose={onClose} wide>
      <div className="row nl-between"><h3>Photos and videos</h3><button type="button" className="btn ghost sm" onClick={onClose}>Close</button></div>
      <div className="nl-up">
        <button type="button" className="btn" disabled={!ready || Boolean(busy)} onClick={() => fileRef.current?.click()}>Upload</button>
        <input ref={fileRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" onChange={(e) => e.target.files?.length && upload(e.target.files)} />
        <label className="nl-start">A video’s moving picture starts at second <input type="number" min={0} max={600} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        {busy && <span className="nl-busy">{busy}</span>}
        {!ready && <span className="nl-busy">Uploads need ffmpeg on the server (npm install ffmpeg-static in the backend folder).</span>}
      </div>
      <p className="nl-help">Any size or shape can be uploaded. Every photo fills the box of its section – 4:5 in Featured Highlights, 2:3 in Stories – so all are the same size (the edges may be cut a little, the middle is kept). The preview shows exactly what goes in the email. Email apps cannot play video, so a video becomes a 4-second moving picture with a play button; a click opens the full video.</p>
      {!list && <p className="muted">Loading…</p>}
      {list?.length === 0 && <p className="empty">Nothing uploaded yet.</p>}
      <div className="nl-lib">
        {list?.map((m) => (
          <div key={m._id} className="nl-lib-item">
            <button type="button" className="nl-thumb" onClick={() => onPick(m)} title="Use this">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt={m.name || ''} loading="lazy" />
              {m.kind === 'video' && <i>Video</i>}
            </button>
            <input defaultValue={m.name} maxLength={120} aria-label="Name" onBlur={(e) => rename(m, e.target.value)} />
            <small>{m.width}×{m.height} · {Math.round((m.bytes || 0) / 1024)} KB{m.usedIn?.length ? ` · in ${m.usedIn.length} issue${m.usedIn.length > 1 ? 's' : ''}` : ''}</small>
            <div className="row">
              <button type="button" className="btn soft sm" onClick={() => onPick(m)}>Use</button>
              {m.videoUrl && <a className="btn ghost sm" href={m.videoUrl} target="_blank" rel="noreferrer">Video</a>}
              <button type="button" className="btn ghost sm tm-del" onClick={() => del(m)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ---------------- report ---------------- */
function Report({ report, onClose }) {
  const n = report.newsletter;
  return (
    <Modal onClose={onClose} wide>
      <div className="row nl-between"><h3>{n.subject}</h3><button type="button" className="btn ghost sm" onClick={onClose}>Close</button></div>
      <div className="nl-top nl-rep">
        <div><b>{num(n.sent)}</b><span>Sent{n.failed ? ` · ${n.failed} failed` : ''}</span></div>
        <div><b>{pct(n.opened, n.sent)}</b><span>{num(n.opened)} opened</span></div>
        <div><b>{pct(n.clicked, n.sent)}</b><span>{num(n.clicked)} clicked</span></div>
        <div><b>{num(n.total - n.sent - n.failed)}</b><span>Skipped or waiting</span></div>
      </div>
      <p className="nl-help">Opens are approximate: some email apps load pictures on their own, others block them.</p>
      <div className="nl-rep-list">
        {report.sends.map((s) => (
          <div key={s._id} className="nl-person">
            <div><b>{s.contact?.name || s.contact?.email || 'Removed contact'}</b><small>{[s.contact?.email, s.contact?.company].filter(Boolean).join(' · ')}</small></div>
            <small>{s.status === 'sent' ? (s.clicks ? `Clicked ${s.clicks}×` : s.openedAt ? 'Opened' : 'Sent') : s.status === 'skipped' ? 'Skipped (replied, unsubscribed or company moved on)' : `Failed: ${s.error || ''}`}</small>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, wide }) {
  return createPortal(
    <div className="nl-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`nl-modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body
  );
}

const css = `
.nl-top { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 10px; }
.nl-top > * { background: rgba(255,255,255,.8); border: 1px solid rgba(255,255,255,.9); box-shadow: 0 10px 30px rgba(30,41,99,.06); border-radius: 18px; padding: 14px 16px; display: flex; flex-direction: column; text-align: left; font: inherit; color: inherit; min-width: 0; }
.nl-top button { cursor: pointer; }
.nl-top b { font-size: 18px; color: #0b87a5; overflow-wrap: anywhere; }
.nl-top b.nl-small { font-size: 14.5px; }
.nl-top span { font-size: 12.5px; color: #64748b; }
.nl-held { font-size: 12.5px; color: #64748b; margin: 0 0 14px; }
.nl-note { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.nl-between { justify-content: space-between; }
.nl-end { justify-content: flex-end; }
.nl-off { display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(217,119,6,.3); background: #fffbeb; color: #92400e; }
.nl-off code { background: rgba(146,64,14,.08); padding: 1px 6px; border-radius: 6px; }
.nl-switch { display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(148,163,184,.4); background: #fff; border-radius: 99px; padding: 6px 14px 6px 6px; font: inherit; font-weight: 700; color: #64748b; cursor: pointer; }
.nl-switch span { width: 36px; height: 20px; border-radius: 99px; background: #cbd5e1; position: relative; transition: background .2s; }
.nl-switch span::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .2s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.nl-switch.on { color: #0b87a5; border-color: rgba(26,169,200,.4); }
.nl-switch.on span { background: #1aa9c8; }
.nl-switch.on span::after { left: 18px; }
.nl-help { font-size: 12.5px; color: #64748b; margin: 4px 0 10px; line-height: 1.5; }
.nl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.nl-grid small { color: #94a3b8; font-size: 11.5px; font-weight: 400; }
.nl-unit { display: flex; align-items: center; gap: 8px; }
.nl-unit input { width: 90px; }
.nl-editor h2 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.nl-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.nl-form { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.nl-form textarea { font-family: inherit; line-height: 1.55; }
.nl-fixed { font-size: 12.5px; color: #0b6f86; background: #ecfaff; border: 1px dashed rgba(26,169,200,.4); border-radius: 12px; padding: 9px 12px; }
.nl-sec { border: 1px solid rgba(148,163,184,.3); border-radius: 16px; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,.6); }
.nl-sec-head { display: flex; flex-direction: column; gap: 2px; }
.nl-sec-head small { color: #64748b; font-size: 12px; }
.nl-title-in { font: inherit; font-weight: 700; font-size: 15px; border: 1px dashed transparent; border-radius: 8px; padding: 2px 6px; margin-left: -6px; background: transparent; color: #0e2a33; }
.nl-title-in:hover, .nl-title-in:focus { border-color: rgba(148,163,184,.5); background: #fff; outline: none; }
.nl-slot { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; padding-top: 10px; border-top: 1px dashed rgba(148,163,184,.3); }
.nl-slot:first-of-type { border-top: 0; padding-top: 0; }
.nl-slot-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.nl-media { display: flex; flex-direction: column; gap: 6px; }
.nl-thumb { position: relative; width: 100%; aspect-ratio: 4 / 5; border-radius: 12px; overflow: hidden; border: 1px solid rgba(148,163,184,.35); background: #f1f5f9; cursor: pointer; padding: 0; display: grid; place-items: center; font: inherit; color: #0b87a5; font-weight: 600; font-size: 12.5px; }
.nl-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; background: #fff; }
.nl-thumb i { position: absolute; left: 6px; bottom: 6px; font-style: normal; font-size: 11px; background: rgba(15,23,42,.7); color: #fff; padding: 2px 7px; border-radius: 99px; }
.nl-thumb.empty { border-style: dashed; background: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.nl-thumb.empty small { color: #94a3b8; font-weight: 500; font-size: 11px; }
.nl-thumb.s { aspect-ratio: 2 / 3; }
.nl-mover { gap: 6px; }
.nl-point input { flex: 1; min-width: 0; font: inherit; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(148,163,184,.4); }
.nl-preview { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.nl-tabs { display: inline-flex; background: #eef2f6; border-radius: 99px; padding: 3px; }
.nl-tabs button { border: 0; background: transparent; font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 12px; border-radius: 99px; color: #64748b; cursor: pointer; }
.nl-tabs button.on { background: #fff; color: #0b87a5; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.nl-frame { border-radius: 16px; overflow: hidden; border: 1px solid rgba(148,163,184,.35); background: #eef2f6; margin: 0 auto; width: 100%; height: 78vh; position: relative; }
.nl-frame.phone { max-width: 377px; }
.nl-frame iframe { border: 0; display: block; background: #eef2f6; position: absolute; top: 0; left: 0; }
.nl-problems { margin: 12px 0 0; padding: 10px 14px 10px 30px; background: #fff7ed; border: 1px solid rgba(234,88,12,.25); border-radius: 12px; color: #9a3412; font-size: 13px; }
.nl-actions { margin-top: 14px; flex-wrap: wrap; align-items: center; }
.nl-test { display: inline-flex; gap: 8px; align-items: center; margin-left: auto; flex-wrap: wrap; }
.nl-test input, .nl-lib-item input, .nl-start input { font: inherit; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(148,163,184,.4); min-width: 0; }
.nl-test input { width: 220px; max-width: 100%; }
.nl-item, .nl-person { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px dashed rgba(148,163,184,.3); flex-wrap: wrap; }
.nl-item > div:first-child, .nl-person > div:first-child { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.nl-item small, .nl-person small { color: #64748b; font-size: 12.5px; overflow-wrap: anywhere; }
.nl-chip { display: inline-block; font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: #f1f5f9; color: #475569; }
.nl-chip.scheduled { background: #e0f2fe; color: #0369a1; }
.nl-chip.sending { background: #fef9c3; color: #854d0e; }
.nl-chip.sent { background: #dcfce7; color: #166534; }
.nl-chip.stopped { background: #fee2e2; color: #991b1b; }
.hr-progress { display: block; height: 6px; border-radius: 99px; background: #e2e8f0; overflow: hidden; max-width: 280px; }
.hr-progress i { display: block; height: 100%; background: linear-gradient(90deg, #4fcde7, #1aa9c8); }
.nl-overlay { position: fixed; inset: 0; background: rgba(14,42,51,.35); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 70; display: flex; align-items: flex-start; justify-content: center; padding: 24px 12px; overflow-y: auto; }
.nl-modal { background: #fff; border-radius: 20px; padding: 20px; width: 460px; max-width: 100%; box-shadow: 0 20px 60px rgba(30,41,99,.25); display: flex; flex-direction: column; gap: 10px; color: #0e2a33; }
.nl-modal.wide { width: 980px; }
.nl-modal h3 { margin: 0; font-size: 18px; }
.nl-up { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.nl-start { font-size: 12.5px; color: #64748b; display: inline-flex; align-items: center; gap: 6px; }
.nl-start input { width: 70px; }
.nl-busy { font-size: 12.5px; color: #0b87a5; font-weight: 600; }
.nl-lib { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.nl-lib-item { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.nl-lib-item small { color: #64748b; font-size: 11.5px; }
.nl-lib-item .row { gap: 6px; flex-wrap: wrap; }
.nl-rep { grid-template-columns: repeat(4, 1fr); }
.nl-rep-list { max-height: 55vh; overflow-y: auto; }
@media (max-width: 1100px) { .nl-split { grid-template-columns: 1fr; } .nl-preview { position: static; } .nl-frame { height: 70vh; } }
@media (max-width: 760px) { .nl-top, .nl-rep { grid-template-columns: 1fr 1fr; } .nl-slot { grid-template-columns: 90px minmax(0, 1fr); } .nl-test { margin-left: 0; } }
`;
