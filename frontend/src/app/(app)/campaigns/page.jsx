'use client';
// Campaigns: list, create/edit (first email + follow-ups), start / pause, see who replied
import { useCallback, useEffect, useState } from 'react';
import { LuChevronLeft, LuPause, LuPencil, LuPlay, LuPlus, LuTrash2 } from 'react-icons/lu';
import { api, date, num, notify, stepName } from '@/lib/api';

// New campaigns start with the fixed follow-ups from backend/templates.js (only name + company change)
const fromFixed = (texts, every) => texts.map((body) => ({ delayDays: every, body }));

export default function CampaignsPage() {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null); // campaign being created/edited
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => api('/api/campaigns').then(setList).catch((e) => notify(e.message, 'error')), []);
  useEffect(() => {
    load();
    const id = new URLSearchParams(window.location.search).get('open');
    if (id) setTimeout(() => setOpenId(id), 0);
  }, [load]);

  const newCampaign = async () => {
    const d = await api('/api/campaigns/defaults').catch(() => ({ intervalDays: 2, followUps: [] }));
    setOpenId(null);
    setEdit({ name: '', subject: '', body: 'Hi {{firstName}},\n\n\n\nBest regards,\n{{senderName}}', useContactContent: true, followUps: fromFixed(d.followUps || [], d.intervalDays || 2) });
  };

  if (edit) return <Editor campaign={edit} onClose={(saved) => { setEdit(null); load(); if (saved) setOpenId(saved); }} />;
  if (openId) return <Detail id={openId} onBack={() => { setOpenId(null); load(); }} onEdit={(c) => setEdit(c)} />;

  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Campaigns</h1>
          <p>First email + automatic follow-ups. Stops the moment someone replies.</p>
        </div>
        <button className="btn" onClick={newCampaign}><LuPlus /> Create Campaign</button>
      </div>
      <div className="card">
        {!list ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="empty">No campaigns yet. Create your first one.</p>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead><tr><th>Campaign</th><th>Status</th><th>Emails</th><th>Contacts</th><th>Sent</th><th>Opened</th><th>Replied</th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c._id} className="cp-row" onClick={() => setOpenId(c._id)}>
                    <td><b>{c.name}</b><small>{date(c.createdAt)}</small></td>
                    <td data-label="Status"><span className={`badge ${c.status}`}>{c.status}</span></td>
                    <td data-label="Emails">{c.fromFile ? 'From file' : 1 + c.followUps.length}</td>
                    <td data-label="Contacts">{num(c.stats.contacts)}</td>
                    <td data-label="Sent">{num(c.stats.sent)}</td>
                    <td data-label="Opened">{c.stats.openRate}%</td>
                    <td data-label="Replied">{num(c.stats.replied)} ({c.stats.replyRate}%)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- create / edit ---------- */
function Editor({ campaign, onClose }) {
  const [c, setC] = useState(campaign);
  const [every, setEvery] = useState(2);
  const [busy, setBusy] = useState(false);
  const setFu = (i, k, v) => setC({ ...c, followUps: c.followUps.map((f, j) => (j === i ? { ...f, [k]: v } : f)) });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await api(c._id ? `/api/campaigns/${c._id}` : '/api/campaigns', { method: c._id ? 'PUT' : 'POST', body: c });
      notify('Campaign saved');
      onClose(saved._id);
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  };

  const timeline = [0];
  c.followUps.forEach((f) => timeline.push(timeline[timeline.length - 1] + Number(f.delayDays || 0)));

  return (
    <form onSubmit={save} className="cp-editor">
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>{c._id ? 'Edit campaign' : 'Create campaign'}</h1>
          <p>Use {'{{firstName}} {{company}} {{senderName}}'} to personalise. An unsubscribe link is added automatically.</p>
        </div>
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => onClose()}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      <div className="card cp-fields">
        <label className="field">Campaign name *<input required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="October brand outreach" /></label>
        <label className="field">Subject *<input required value={c.subject} onChange={(e) => setC({ ...c, subject: e.target.value })} placeholder="Quick idea for {{company}}" /></label>
        <label className="field">First email *<textarea required rows={8} value={c.body} onChange={(e) => setC({ ...c, body: e.target.value })} /></label>
        <label className="cp-check">
          <input type="checkbox" checked={c.useContactContent} onChange={(e) => setC({ ...c, useContactContent: e.target.checked })} />
          If a contact has its own subject/body from the CSV (ClientMagnet), send that instead
        </label>
      </div>

      <div className="card">
        <h2>Follow-ups <span className="muted small">(only sent if there is no reply)</span></h2>
        <div className="row cp-gen">
          Every <input type="number" min={1} max={30} value={every} onChange={(e) => setEvery(Math.max(1, +e.target.value || 1))} /> working days (Sat/Sun not counted)
          <button type="button" className="btn soft sm" onClick={() => setC({ ...c, followUps: c.followUps.map((f) => ({ ...f, delayDays: every })) })}>Apply to all</button>
        </div>
        <div className="cp-timeline">
          {timeline.map((d, i) => <span key={i}>{i === 0 ? 'Start' : `+${d} working days`}<small>{i === 0 ? 'First email' : `Follow-up ${i}`}</small></span>)}
          <span className="end">Stop<small>on reply</small></span>
        </div>
        {c.followUps.map((f, i) => (
          <div key={i} className="cp-fu">
            <div className="row">
              <b>Follow-up {i + 1}</b> — send
              <input type="number" min={1} value={f.delayDays} onChange={(e) => setFu(i, 'delayDays', Math.max(1, +e.target.value || 1))} />
              working days after the previous email
              <button type="button" className="btn ghost sm cp-remove" onClick={() => setC({ ...c, followUps: c.followUps.filter((_, j) => j !== i) })}>Remove</button>
            </div>
            <textarea rows={4} value={f.body} onChange={(e) => setFu(i, 'body', e.target.value)} />
          </div>
        ))}
        <button type="button" className="btn ghost" onClick={() => setC({ ...c, followUps: [...c.followUps, { delayDays: every, body: 'Hi {{firstName}},\n\n' }] })}>+ Add follow-up</button>
      </div>
    </form>
  );
}

/* ---------- one campaign ---------- */
function Detail({ id, onBack, onEdit }) {
  const [c, setC] = useState(null);
  const [batches, setBatches] = useState([]);
  const [batch, setBatch] = useState('');
  const [onlyNew, setOnlyNew] = useState(true);
  const [sched, setSched] = useState({ gapDays: 2, cc: '' });

  const load = useCallback(
    () =>
      api(`/api/campaigns/${id}`)
        .then((r) => {
          setC(r);
          setSched({ gapDays: r.gap, cc: r.ccUsed || '' });
        })
        .catch((e) => notify(e.message, 'error')),
    [id]
  );
  const saveSched = async () => {
    try {
      await api(`/api/campaigns/${id}/schedule`, { method: 'PUT', body: sched });
      notify('Saved — applies from the next follow-up');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  useEffect(() => {
    load();
    api('/api/contacts', { query: { page: 1 } }).then((r) => setBatches(r.batches)).catch(() => {});
  }, [load]);

  const act = async (path, body, msg) => {
    try {
      const r = await api(`/api/campaigns/${id}/${path}`, { method: 'POST', body });
      notify(path === 'start' ? `${r.added} contacts added${r.skipped ? `, ${r.skipped} skipped` : ''}` : msg);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const remove = async () => {
    if (!window.confirm('Delete this campaign? Pending follow-ups will be cancelled.')) return;
    await api(`/api/campaigns/${id}`, { method: 'DELETE' }).catch((e) => notify(e.message, 'error'));
    onBack();
  };

  if (!c) return <p className="muted">Loading…</p>;
  const s = c.stats;
  const total = c.fromFile || !c.followUps.length ? 1 + c.fixedFollowUps : 1 + c.followUps.length;

  return (
    <>
      <style>{css}</style>
      <button className="cp-back" onClick={onBack}><LuChevronLeft /> All campaigns</button>
      <div className="page-title">
        <div>
          <h1>{c.name} <span className={`badge ${c.status}`}>{c.status}</span></h1>
          <p>{c.fromFile ? `First email from your file + ${c.fixedFollowUps} fixed follow-ups · every ${c.gap} working days` : `${total} emails · subject: ${c.subject}`}{c.ccUsed ? ` · CC ${c.ccUsed}` : ''}</p>
        </div>
        <div className="row">
          {c.status === 'active' && <button className="btn ghost" onClick={() => act('pause', {}, 'Paused')}><LuPause /> Pause</button>}
          {c.status === 'paused' && <button className="btn ghost" onClick={() => act('resume', {}, 'Resumed')}><LuPlay /> Resume</button>}
          {!c.fromFile && <button className="btn ghost" onClick={() => onEdit(c)}><LuPencil /> Edit</button>}
          <button className="btn ghost cp-danger" onClick={remove}><LuTrash2 /> Delete</button>
        </div>
      </div>

      <div className="cp-stats">
        {[['Contacts', s.contacts], ['In progress', s.active], ['Sent', s.sent], ['Opened', `${s.openRate}%`], ['Replied', `${s.replied} (${s.replyRate}%)`], ['Unsubscribed', s.unsubscribed]].map(([l, v]) => (
          <div key={l} className="card"><span>{l}</span><b>{typeof v === 'number' ? num(v) : v}</b></div>
        ))}
      </div>

      <div className="card">
        <h2>Follow-up gap & CC</h2>
        <div className="row cp-start">
          {c.fromFile && (
            <select value={sched.gapDays} onChange={(e) => setSched({ ...sched, gapDays: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 7, 10].map((g) => <option key={g} value={g}>Every {g} working day{g > 1 ? 's' : ''}</option>)}
            </select>
          )}
          <input className="cp-cc" value={sched.cc} onChange={(e) => setSched({ ...sched, cc: e.target.value })} placeholder="CC: a@x.com, b@y.com (empty = no CC)" />
          <button className="btn soft" onClick={saveSched}>Save</button>
        </div>
        <p className="small muted">Saturday &amp; Sunday are not counted. Changes apply from the next follow-up of each person.</p>
      </div>

      <div className="card">
        <h2>Add contacts & start sending</h2>
        <div className="row cp-start">
          <select value={batch} onChange={(e) => setBatch(e.target.value)}>
            <option value="">All contacts</option>
            {batches.map((b) => <option key={b} value={b}>Import: {b}</option>)}
          </select>
          <label className="cp-check"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Only never-emailed contacts</label>
          <button className="btn" onClick={() => act('start', { batch, onlyNew })}>Start</button>
        </div>
        <p className="small muted">Replied, unsubscribed, bounced and people already in another running sequence are skipped. Sending follows the daily limit and hours from .env.</p>
      </div>

      <div className="card">
        <h2>People ({num(c.people.length)})</h2>
        {c.people.length === 0 ? (
          <p className="empty">Nobody added yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="cards">
              <thead><tr><th>Contact</th><th>Status</th><th>Progress</th><th>Next email</th></tr></thead>
              <tbody>
                {c.people.map((p) => (
                  <tr key={p._id}>
                    <td><b>{p.contact?.name || p.contact?.email || 'Deleted'}</b><small>{p.contact?.email}</small></td>
                    <td data-label="Status">
                      <span className={`badge ${p.status}`}>{p.status}</span>
                      {p.repliedAfterStep ? <small>after {stepName(p.repliedAfterStep)}</small> : null}
                    </td>
                    <td data-label="Progress">{p.step} / {Math.max(p.contact?.messages?.length || 0, total)} sent</td>
                    <td data-label="Next email">{p.status === 'active' ? `${stepName(p.step + 1)} · ${date(p.nextSendAt)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const css = `
.cp-row { cursor: pointer; }
.cp-row:hover td { background: #fafbfe; }
.cp-editor { display: flex; flex-direction: column; gap: 20px; }
.cp-fields { display: flex; flex-direction: column; gap: 14px; }
.cp-check { display: flex; gap: 8px; align-items: center; font-size: 13.5px; cursor: pointer; }
.cp-gen { background: rgba(255,255,255,.55); border-radius: 12px; padding: 10px 14px; margin-bottom: 14px; font-size: 13.5px; }
.cp-editor input[type=number] { width: 70px; text-align: center; padding: 7px; }
.cp-timeline { display: flex; gap: 8px; overflow-x: auto; margin-bottom: 14px; padding-bottom: 4px; }
.cp-timeline span { flex-shrink: 0; background: var(--c-100); color: var(--c-700); font-weight: 700; font-size: 13px; padding: 8px 12px; border-radius: 10px; text-align: center; }
.cp-timeline span.end { background: #eafaf0; color: #15803d; }
.cp-timeline small { display: block; font-weight: 500; font-size: 11px; color: #64748b; }
.cp-fu { border: 1px solid rgba(148,163,184,.25); border-radius: 12px; padding: 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; }
.cp-remove { margin-left: auto; color: #e11d48; }
.cp-back { display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; color: #64748b; font-weight: 600; cursor: pointer; align-self: flex-start; }
.cp-back:hover { color: var(--c-700); }
.cp-danger { color: #e11d48; }
.cp-stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.cp-stats .card { padding: 14px 16px; }
.cp-stats span { display: block; font-size: 12.5px; color: #64748b; }
.cp-stats b { font-size: 21px; }
.cp-start { margin-bottom: 10px; }
.cp-start select { width: auto; min-width: 200px; }
.cp-cc { flex: 1; min-width: 220px; }
@media (max-width: 1000px) { .cp-stats { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 600px) {
  .cp-stats { grid-template-columns: repeat(2, 1fr); }
  .cp-start select, .cp-start .btn { width: 100%; }
}
`;
