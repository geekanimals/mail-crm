'use client';
// One deal (client project after it became an account): progress, the current step's form, documents, payments,
// deliverables, posts and the timeline. Used by the admin (Deals page) and by employees (their task -> Open deal).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuCheck, LuExternalLink, LuPaperclip, LuPlus, LuTrash2, LuX } from 'react-icons/lu';
import { api, notify } from '@/lib/api';
import { fullDay, openFile, rupees, todayStr, uploadFile } from '@/lib/hr';

const KIND = { contract: 'Contract', estimate: 'Estimate', po: 'Purchase order', invoice_advance: 'Advance invoice', invoice_final: 'Final invoice', report: 'Report', other: 'Document' };
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

/** pick a file and upload it for this deal */
function FilePick({ dealId, file, onFile }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      onFile(await uploadFile(f, undefined, dealId));
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <span className="dv-file">
      <input ref={ref} type="file" hidden onChange={pick} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.zip" />
      {file ? (
        <span className="dv-chip"><LuPaperclip /> {file.name}<button type="button" onClick={() => onFile(null)} aria-label="Remove file"><LuX /></button></span>
      ) : (
        <button type="button" className="dv-btn ghost" disabled={busy} onClick={() => ref.current?.click()}><LuPaperclip /> {busy ? 'Uploading…' : 'Upload file'}</button>
      )}
    </span>
  );
}

function StepForm({ deal, step, act }) {
  const [f, setF] = useState({ date: todayStr() });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const invoiceKind = step === 'advance' ? 'invoice_advance' : 'invoice_final';
  const invoiceSent = deal.documents.some((d) => d.kind === invoiceKind);
  const submit = (action, body) => async (e) => {
    e?.preventDefault();
    if (await act(step, { action, ...body })) setF({ date: todayStr() });
  };

  if (step === 'estimate')
    return (
      <form className="dv-form" onSubmit={submit('send', { file: f.file, amount: f.amount, number: f.number, note: f.note, clientEmail: f.clientEmail })}>
        <label>Amount (₹) *<input inputMode="decimal" required value={f.amount || ''} onChange={set('amount')} placeholder="50000" /></label>
        <label>Estimate number<input value={f.number || ''} onChange={set('number')} placeholder="EST-001" /></label>
        {!deal.clientEmail && !deal.clientLogin && <label>Client email<input type="email" value={f.clientEmail || ''} onChange={set('clientEmail')} placeholder="client@brand.com" /></label>}
        <label className="dv-wide">Message (optional)<textarea rows={2} value={f.note || ''} onChange={set('note')} /></label>
        <div className="dv-row dv-wide"><FilePick dealId={deal._id} file={f.file} onFile={(file) => setF({ ...f, file })} /><button className="dv-btn">Email estimate to client</button></div>
      </form>
    );
  if (step === 'po')
    return (
      <form className="dv-form" onSubmit={submit('save', { file: f.file, number: f.number, amount: f.amount })}>
        <label>PO number *<input required value={f.number || ''} onChange={set('number')} /></label>
        <label>PO amount (₹)<input inputMode="decimal" value={f.amount || ''} onChange={set('amount')} /></label>
        <div className="dv-row dv-wide"><FilePick dealId={deal._id} file={f.file} onFile={(file) => setF({ ...f, file })} /><button className="dv-btn">Save PO</button></div>
      </form>
    );
  if (step === 'advance' || step === 'final')
    return (
      <div className="dv-col">
        <form className="dv-form" onSubmit={submit('invoice', { file: f.file, amount: f.amount, number: f.number })}>
          <b className="dv-wide">1. {invoiceSent ? 'Invoice sent ✓ (send again if needed)' : 'Send the invoice'}</b>
          <label>Invoice amount (₹) *<input inputMode="decimal" value={f.amount || ''} onChange={set('amount')} /></label>
          <label>Invoice number<input value={f.number || ''} onChange={set('number')} /></label>
          <div className="dv-row dv-wide"><FilePick dealId={deal._id} file={f.file} onFile={(file) => setF({ ...f, file })} /><button className="dv-btn">Email invoice to client</button></div>
        </form>
        <form className="dv-form" onSubmit={submit('paid', { amount: f.paid, date: f.date, reference: f.reference })}>
          <b className="dv-wide">2. Payment received</b>
          <label>Amount received (₹) *<input inputMode="decimal" required value={f.paid || ''} onChange={set('paid')} disabled={!invoiceSent} /></label>
          <label>Date *<input type="date" required max={todayStr()} value={f.date || ''} onChange={set('date')} disabled={!invoiceSent} /></label>
          <label>Reference (UTR / cheque)<input value={f.reference || ''} onChange={set('reference')} disabled={!invoiceSent} /></label>
          <div className="dv-row dv-wide"><button className="dv-btn" disabled={!invoiceSent}>Mark payment received</button>{!invoiceSent && <small className="dv-muted">Send the invoice first.</small>}</div>
        </form>
      </div>
    );
  if (step === 'execution')
    return (
      <div className="dv-col">
        <form className="dv-row" onSubmit={async (e) => { e.preventDefault(); if (await act(step, { action: 'add', text: f.text })) setF({ ...f, text: '' }); }}>
          <input className="dv-grow" required value={f.text || ''} onChange={set('text')} placeholder="Add a deliverable, e.g. 20 creator reels" />
          <button className="dv-btn ghost"><LuPlus /> Add</button>
        </form>
        <button className="dv-btn" disabled={!deal.deliverables.length || deal.deliverables.some((d) => !d.done)} onClick={() => act(step, { action: 'complete' })}>All done – send to Report</button>
        {deal.deliverables.some((d) => !d.done) && <small className="dv-muted">Tick every deliverable below to finish this step.</small>}
      </div>
    );
  if (step === 'report')
    return (
      <form className="dv-form" onSubmit={submit('send', { file: f.file, link: f.link, text: f.text })}>
        <label className="dv-wide">Results * (creators, reach, views …)<textarea rows={4} required value={f.text || ''} onChange={set('text')} /></label>
        <label className="dv-wide">Report link<input value={f.link || ''} onChange={set('link')} placeholder="https://…" /></label>
        <div className="dv-row dv-wide"><FilePick dealId={deal._id} file={f.file} onFile={(file) => setF({ ...f, file })} /><button className="dv-btn">Email report to client</button></div>
      </form>
    );
  if (step === 'case_study')
    return (
      <form className="dv-row" onSubmit={submit('done', { link: f.link })}>
        <input className="dv-grow" required value={f.link || ''} onChange={set('link')} placeholder="https://geekcreativeagency.com/case-studies/…" />
        <button className="dv-btn">Case study published</button>
      </form>
    );
  if (step === 'content')
    return (
      <div className="dv-col">
        {deal.channels.map((ch) => {
          const have = deal.content.find((c) => c.channel === ch.key)?.link || '';
          return (
            <form key={ch.key} className="dv-row" onSubmit={async (e) => { e.preventDefault(); await act(step, { channel: ch.key, link: f[ch.key] ?? have }); }}>
              <span className={`dv-tick ${have ? 'on' : ''}`}>{have ? <LuCheck /> : ''}</span>
              <b className="dv-chan">{ch.label}</b>
              <input className="dv-grow" value={f[ch.key] ?? have} onChange={set(ch.key)} placeholder="https://…" />
              <button className="dv-btn ghost">Save</button>
            </form>
          );
        })}
        <small className="dv-muted">When every channel has a link, the project is complete.</small>
      </div>
    );
  return null;
}

export default function DealView({ id, me, isAdmin, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [email, setEmail] = useState(null);
  const [busy, setBusy] = useState(false); // a step is being saved / emailed: no double clicks
  const load = useCallback(() => api(`/api/deals/${id}`).then(setD).catch((e) => notify(e.message, 'error')), [id]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const act = async (step, body) => {
    if (busy) return false;
    setBusy(true);
    try {
      const out = await api(`/api/deals/${id}/step/${step}`, { method: 'POST', body });
      setD(out);
      notify(out.step !== d.step ? `${d.steps.find((s) => s.key === d.step)?.label} done ✓` : 'Saved ✓');
      onChanged?.();
      return true;
    } catch (e) {
      notify(e.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveEmail = async (e) => {
    e.preventDefault();
    try {
      setD(await api(`/api/deals/${id}`, { method: 'PUT', body: { clientEmail: email } }));
      setEmail(null);
      notify('Saved');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const body = !d ? (
    <p className="dv-muted">Loading…</p>
  ) : (
    (() => {
      const cur = d.steps.findIndex((s) => s.key === d.step);
      const openTask = d.tasks.find((t) => t.step === d.step && t.status !== 'done');
      const mine = isAdmin || (openTask && me && String(openTask.user) === String(me));
      const paid = d.payments.reduce((n, p) => n + p.amount, 0);
      const ownerOf = (k) => [...d.tasks].reverse().find((t) => t.step === k)?.name;
      return (
        <>
          <div className="dv-head">
            <div>
              <h2>{d.companyName}</h2>
              <span className={`dv-badge ${d.step === 'complete' ? 'done' : ''}`}>{d.step === 'complete' ? 'Complete' : d.steps[cur]?.label}</span>
            </div>
            <button className="dv-btn ghost" onClick={onClose} aria-label="Close"><LuX /></button>
          </div>

          <div className="dv-money">
            <div><span>Deal value</span><b>{rupees(d.value)}</b></div>
            <div><span>Received</span><b>{rupees(paid)}</b></div>
            <div><span>Balance</span><b>{rupees(Math.max(0, d.value - paid))}</b></div>
          </div>

          <ol className="dv-steps">
            {d.steps.map((s, i) => (
              <li key={s.key} className={d.step === 'complete' || i < cur ? 'done' : i === cur ? 'now' : ''}>
                <span className="dv-dot">{d.step === 'complete' || i < cur ? <LuCheck /> : i + 1}</span>
                <b>{s.label}</b>
                <small>{ownerOf(s.key) || ''}</small>
              </li>
            ))}
          </ol>

          {d.step !== 'complete' && (
            <section className="dv-card dv-now">
              <div className="dv-row dv-between">
                <h3>Now: {d.steps[cur]?.label}</h3>
                <small className="dv-muted">{openTask ? `${openTask.name} · due ${fullDay(openTask.due)}` : 'No owner – set one under Step owners'}</small>
              </div>
              <p className="dv-muted">{d.steps[cur]?.ask}</p>
              {mine ? (
                <fieldset className="dv-fs" disabled={busy}>
                  <StepForm key={d.step} deal={d} step={d.step} act={act} />
                  {busy && <p className="dv-busy">Saving{['estimate', 'advance', 'final', 'report'].includes(d.step) ? ' and emailing the client' : ''}… please wait.</p>}
                </fieldset>
              ) : <p className="dv-muted">This step is with {openTask?.name || 'someone else'}.</p>}
            </section>
          )}

          <section className="dv-card">
            <div className="dv-row dv-between">
              <h3>Client</h3>
              {isAdmin && email === null && <button className="dv-btn ghost" onClick={() => setEmail(d.clientEmail || '')}>Change email</button>}
            </div>
            {email !== null ? (
              <form className="dv-row" onSubmit={saveEmail}>
                <input className="dv-grow" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Where estimates, invoices and reports go" />
                <button className="dv-btn">Save</button>
                <button type="button" className="dv-btn ghost" onClick={() => setEmail(null)}>Cancel</button>
              </form>
            ) : (
              <p className="dv-muted">Documents go to <b>{d.clientEmail || d.clientLogin?.email || 'the first contact of the company'}</b>.{d.clientLogin ? ` Client login: ${d.clientLogin.email}${d.clientLogin.bounty ? ' (same login on Bounty)' : ''}.` : ' No client login yet.'}</p>
            )}
          </section>

          {d.deliverables.length > 0 && (
            <section className="dv-card">
              <h3>Deliverables ({d.deliverables.filter((x) => x.done).length}/{d.deliverables.length})</h3>
              {d.deliverables.map((x) => (
                <label key={x._id} className={`dv-item ${x.done ? 'done' : ''}`}>
                  <input type="checkbox" checked={x.done} disabled={busy || !(mine && d.step === 'execution')} onChange={(e) => act('execution', { action: 'tick', itemId: x._id, done: e.target.checked })} />
                  <span>{x.text}</span>
                  {mine && d.step === 'execution' && <button type="button" className="dv-icon" onClick={(e) => { e.preventDefault(); act('execution', { action: 'remove', itemId: x._id }); }} aria-label="Remove"><LuTrash2 /></button>}
                </label>
              ))}
            </section>
          )}

          <section className="dv-card">
            <h3>Documents</h3>
            {d.documents.length === 0 && <p className="dv-muted">Nothing yet.</p>}
            {[...d.documents].reverse().map((x) => (
              <div key={x._id} className="dv-doc">
                <div>
                  <b>{KIND[x.kind]}{x.number ? ` · ${x.number}` : ''}{x.amount ? ` · ${rupees(x.amount)}` : ''}</b>
                  <small>{x.emailedTo ? `Emailed to ${x.emailedTo} · ${when(x.emailedAt)}` : `Saved · ${when(x.at)}`}{x.by ? ` · by ${x.by}` : ''}</small>
                </div>
                <div className="dv-row">
                  {x.file?.id && <button className="dv-btn ghost" onClick={() => openFile(x.file)}><LuPaperclip /> {x.file.name}</button>}
                  {x.link && <a className="dv-btn ghost" href={x.link} target="_blank" rel="noopener noreferrer"><LuExternalLink /> Link</a>}
                </div>
              </div>
            ))}
          </section>

          {(d.payments.length > 0 || d.caseStudyLink || d.content.some((c) => c.link)) && (
            <section className="dv-card">
              <h3>Payments and links</h3>
              {d.payments.map((p) => <div key={p._id} className="dv-line"><b>{p.kind === 'advance' ? 'Advance' : 'Full payment'} {rupees(p.amount)}</b><span>{fullDay(p.date)}{p.reference ? ` · ref ${p.reference}` : ''} · {p.by}</span></div>)}
              {d.caseStudyLink && <div className="dv-line"><b>Case study</b><a href={d.caseStudyLink} target="_blank" rel="noopener noreferrer">{d.caseStudyLink}</a></div>}
              {d.content.filter((c) => c.link).map((c) => <div key={c.channel} className="dv-line"><b>{d.channels.find((x) => x.key === c.channel)?.label}</b><a href={c.link} target="_blank" rel="noopener noreferrer">{c.link}</a></div>)}
            </section>
          )}

          <section className="dv-card">
            <h3>Timeline</h3>
            {d.timeline.map((t) => <div key={t._id} className="dv-line"><span className="dv-when">{when(t.at)}</span><span><b>{t.by}</b> · {t.text}</span></div>)}
          </section>
        </>
      );
    })()
  );

  return createPortal(
    <div className="dv-overlay" onClick={onClose}>
      <div className="dv-panel" onClick={(e) => e.stopPropagation()}>
        {body}
        <style>{css}</style>
      </div>
    </div>,
    document.body
  );
}

const css = `
.dv-overlay { position: fixed; inset: 0; z-index: 80; background: rgba(15, 42, 51, .35); backdrop-filter: blur(3px); display: flex; justify-content: flex-end; }
.dv-panel { width: min(760px, 100%); height: 100%; overflow-y: auto; background: #f6fbfd; padding: 22px; display: flex; flex-direction: column; gap: 14px; box-shadow: -20px 0 50px rgba(15,42,51,.18); color: #0f2a33; font-size: 14px; }
.dv-panel h2 { margin: 0 0 4px; font-size: 21px; }
.dv-panel h3 { margin: 0; font-size: 15px; }
.dv-head, .dv-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dv-head { justify-content: space-between; align-items: flex-start; }
.dv-between { justify-content: space-between; }
.dv-col { display: flex; flex-direction: column; gap: 10px; }
.dv-grow { flex: 1; min-width: 160px; }
.dv-muted { color: #64748b; font-size: 13px; margin: 0; }
.dv-badge { display: inline-block; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 99px; background: #e0f7fc; color: #0b87a5; }
.dv-badge.done { background: #dcfce7; color: #15803d; }
.dv-money { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.dv-money div { background: #fff; border: 1px solid rgba(148,163,184,.22); border-radius: 14px; padding: 10px 12px; display: flex; flex-direction: column; }
.dv-money span { font-size: 12px; color: #64748b; }
.dv-money b { font-size: 18px; color: #0b87a5; }
.dv-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
.dv-steps li { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 3px; font-size: 11.5px; color: #94a3b8; }
.dv-steps b { font-weight: 600; line-height: 1.2; }
.dv-steps small { font-size: 10.5px; color: #64748b; min-height: 13px; }
.dv-dot { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: #e2e8f0; color: #64748b; font-weight: 700; font-size: 12px; }
.dv-steps li.done { color: #15803d; } .dv-steps li.done .dv-dot { background: #22c55e; color: #fff; }
.dv-steps li.now { color: #0b87a5; } .dv-steps li.now .dv-dot { background: linear-gradient(150deg, #4fcde7, #1aa9c8); color: #fff; box-shadow: 0 0 0 4px rgba(79,205,231,.25); }
.dv-card { background: #fff; border: 1px solid rgba(148,163,184,.22); border-radius: 16px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dv-now { border-color: rgba(26,169,200,.45); box-shadow: 0 8px 26px rgba(26,169,200,.12); }
.dv-form { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; background: #f8fafc; border-radius: 12px; padding: 12px; }
.dv-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; font-weight: 600; color: #3a5560; }
.dv-wide { grid-column: 1 / -1; }
.dv-fs { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.dv-busy { margin: 0; font-size: 13px; font-weight: 600; color: #0b87a5; }
.dv-panel input, .dv-panel textarea, .dv-panel select { font: inherit; font-size: 14px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(148,163,184,.4); background: #fff; color: inherit; min-width: 0; }
.dv-btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 11px; border: 1px solid transparent; padding: 8px 14px; font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; background: linear-gradient(150deg, #4fcde7, #1aa9c8); color: #fff; text-decoration: none; white-space: nowrap; }
.dv-btn.ghost { background: #fff; color: #0b87a5; border-color: rgba(26,169,200,.35); }
.dv-btn:disabled { opacity: .5; cursor: not-allowed; }
.dv-chip { display: inline-flex; align-items: center; gap: 6px; background: #e0f7fc; color: #0b6b82; border-radius: 99px; padding: 5px 10px; font-size: 13px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.dv-chip button, .dv-icon { border: 0; background: none; color: inherit; cursor: pointer; display: inline-flex; padding: 2px; }
.dv-item { display: flex; align-items: center; gap: 10px; padding: 6px 2px; border-bottom: 1px dashed rgba(148,163,184,.25); }
.dv-item span { flex: 1; }
.dv-item.done span { text-decoration: line-through; color: #64748b; }
.dv-doc { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px dashed rgba(148,163,184,.25); }
.dv-doc small { display: block; color: #64748b; font-size: 12px; }
.dv-line { display: flex; gap: 10px; font-size: 13px; padding: 4px 0; flex-wrap: wrap; overflow-wrap: anywhere; }
.dv-when { color: #64748b; min-width: 120px; }
.dv-tick { width: 20px; height: 20px; border-radius: 6px; border: 1px solid rgba(148,163,184,.5); display: grid; place-items: center; color: #fff; flex: none; }
.dv-tick.on { background: #22c55e; border-color: #22c55e; }
.dv-chan { min-width: 130px; font-size: 13px; }
@media (max-width: 640px) {
  .dv-panel { padding: 16px; }
  .dv-form { grid-template-columns: 1fr; }
  .dv-steps { grid-template-columns: repeat(4, 1fr); row-gap: 12px; }
  .dv-money b { font-size: 15px; }
  .dv-chan { min-width: 0; width: 100%; }
  .dv-when { min-width: 0; width: 100%; }
}
`;
