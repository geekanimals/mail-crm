'use client';
// Agreement → estimate → payment on an Opportunity's company page (admin). Nothing is sent until "Send" is pressed;
// every PDF can be downloaded at any time (draft, sent, accepted).
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuBold, LuCheck, LuDownload, LuFileText, LuHeading2, LuItalic, LuList, LuListOrdered, LuLock, LuReceiptIndianRupee, LuSend, LuUnderline, LuWallet } from 'react-icons/lu';
import { API_URL, api, getToken, notify } from '@/lib/api';
import { ConfirmDialog } from '@/lib/hr';

const inr = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const STATUS = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', changes: 'Changes asked', replaced: 'Replaced', outside: 'Done outside the CRM' };

/** download or open a PDF of a document */
async function getPdf(id, { inline = false } = {}) {
  const res = await fetch(`${API_URL}/api/documents/${id}/pdf${inline ? '?inline=1' : ''}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'The PDF could not be made');
  const name = decodeURIComponent((res.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || 'document.pdf');
  return { url: URL.createObjectURL(await res.blob()), name };
}
export async function downloadPdf(id) {
  try {
    const { url, name } = await getPdf(id);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) {
    notify(e.message, 'error');
  }
}

export default function ClientDocs({ companyId, onFlow, onChanged, historyOnly = false }) {
  const [f, setF] = useState(null);
  const [open, setOpen] = useState(null); // doc id in the editor
  const [pay, setPay] = useState(null); // { amount, date, reference }
  const [outside, setOutside] = useState(null); // { kind, note, total, number }
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api(`/api/documents/company/${companyId}`)
        .then((r) => {
          setF(r);
          onFlow?.(r);
        })
        .catch((e) => notify(e.message, 'error')),
    [companyId, onFlow]
  );
  useEffect(() => {
    load();
  }, [load]);
  const run = async (fn, msg) => {
    setBusy(true);
    try {
      const out = await fn();
      if (msg) notify(msg);
      await load();
      onChanged?.();
      return out;
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (!f) return historyOnly ? null : <div className="cd-box"><p className="small muted">Loading…</p></div>;
  // an account: only the agreement / estimate made before it (to download), if any
  if (historyOnly) {
    const list = f.history.filter((d) => d.status !== 'draft');
    if (!list.length) return null;
    return (
      <div className="cd-box">
        <style>{css}</style>
        <b className="cd-title"><LuFileText /> Agreement and estimate</b>
        {list.map((d) => (
          <div key={d._id} className="row cd-oldrow">
            <span className="small">{d.kind === 'estimate' ? `Estimate ${d.number}` : `Agreement${d.version > 1 ? ` v${d.version}` : ''}`} · {STATUS[d.status]}{d.accepted?.name ? ` by ${d.accepted.name}` : ''} · {when(d.accepted?.at || d.sentAt || d.createdAt)}</span>
            {d.status !== 'outside' && <button className="btn ghost sm" onClick={() => downloadPdf(d._id)}><LuDownload /> PDF</button>}
          </div>
        ))}
        {(f.company.payments || []).map((p, i) => <p key={i} className="small">Advance ₹{inr(p.amount)} received on {p.date}{p.reference ? ` · ${p.reference}` : ''}</p>)}
      </div>
    );
  }
  const a = f.agreement;
  const e = f.estimate;
  const makeAgreement = async () => {
    const d = await run(() => api(`/api/documents/company/${companyId}/agreement`, { method: 'POST' }));
    if (d?._id) setOpen(d._id);
  };
  const makeEstimate = async () => {
    const d = await run(() => api(`/api/documents/company/${companyId}/estimate`, { method: 'POST' }));
    if (d?._id) setOpen(d._id);
  };
  const old = f.history.filter((d) => d.status === 'replaced' || (d.kind === 'agreement' && a && d._id !== a._id && d.status !== 'draft') || (d.kind === 'estimate' && e && d._id !== e._id && d.status !== 'draft'));

  return (
    <div className="cd-box">
      <style>{css}</style>
      <b className="cd-title"><LuFileText /> Agreement, estimate and payment</b>
      <p className="small muted">Step by step before the account. Nothing is emailed until you press Send. Every PDF can be downloaded at any time.</p>

      {/* 1. agreement */}
      <div className={`cd-step ${f.agreed ? 'ok' : ''}`}>
        <span className="cd-n">{f.agreed ? <LuCheck /> : 1}</span>
        <div className="cd-body">
          <b>Agreement {a ? <span className={`cd-chip ${a.status}`}>{STATUS[a.status]}{a.version > 1 ? ` · v${a.version}` : ''}</span> : null}</b>
          {!a && <p className="small muted">Made from your agreement template, filled for this campaign. You can change any line before sending.</p>}
          {a?.status === 'sent' && <p className="small">Sent to {a.sentTo} · {when(a.sentAt)}{a.viewedAt ? ` · opened ${when(a.viewedAt)}` : ' · not opened yet'}. Waiting for them to accept.</p>}
          {a?.status === 'accepted' && <p className="small">Accepted by <b>{a.accepted?.name}</b>{a.accepted?.designation ? `, ${a.accepted.designation}` : ''} · {when(a.accepted?.at)}</p>}
          {a?.status === 'changes' && (
            <div className="cd-changes">
              <b className="small">They asked for changes:</b>
              {(a.changes || []).map((c, i) => <p key={i} className="small">“{c.text}”{c.name ? ` – ${c.name}` : ''} · {when(c.at)}</p>)}
            </div>
          )}
          {a?.status === 'outside' && <p className="small">Marked as done outside the CRM{a.outside?.note ? `: ${a.outside.note}` : ''}.</p>}
          <div className="row cd-actions">
            {!a && <button className="btn sm" disabled={busy} onClick={makeAgreement}><LuFileText /> Make the agreement</button>}
            {a?.status === 'draft' && <button className="btn sm" onClick={() => setOpen(a._id)}>Continue the draft</button>}
            {a?.status === 'changes' && <button className="btn sm" disabled={busy} onClick={makeAgreement}>Make version {a.version + 1}</button>}
            {a && a.status !== 'outside' && <button className="btn ghost sm" onClick={() => downloadPdf(a._id)}><LuDownload /> {a.status === 'accepted' ? 'Accepted copy (PDF)' : 'PDF'}</button>}
            {a && ['sent', 'accepted', 'changes'].includes(a.status) && <button className="btn ghost sm" onClick={() => setOpen(a._id)}>View</button>}
            {!a && <button className="btn ghost sm" onClick={() => setOutside({ kind: 'agreement', note: '' })}>Already done outside the CRM</button>}
          </div>
        </div>
      </div>

      {/* 2. estimate */}
      <div className={`cd-step ${f.estimateSent ? 'ok' : ''} ${!f.agreed ? 'locked' : ''}`}>
        <span className="cd-n">{f.estimateSent ? <LuCheck /> : f.agreed ? 2 : <LuLock />}</span>
        <div className="cd-body">
          <b>Estimate {e ? <span className={`cd-chip ${e.status}`}>{e.number ? `${e.number} · ` : ''}{STATUS[e.status]}</span> : null}</b>
          {!f.agreed && <p className="small muted">Opens when the agreement is accepted.</p>}
          {f.agreed && !e && <p className="small muted">The next number is {f.nextEstimateNumber}. The client’s billing details and the items are filled in for you.</p>}
          {e && e.status !== 'draft' && <p className="small">Total ₹{inr(e.estimate?.total)}{e.sentAt ? ` · sent to ${e.sentTo} · ${when(e.sentAt)}` : ''}{e.outside?.note ? ` · ${e.outside.note}` : ''}</p>}
          {f.agreed && (
            <div className="row cd-actions">
              {!e && <button className="btn sm" disabled={busy} onClick={makeEstimate}><LuReceiptIndianRupee /> Make the estimate</button>}
              {e?.status === 'draft' && <button className="btn sm" onClick={() => setOpen(e._id)}>Continue the draft</button>}
              {e && e.status !== 'outside' && <button className="btn ghost sm" onClick={() => downloadPdf(e._id)}><LuDownload /> PDF</button>}
              {e?.status === 'sent' && <button className="btn ghost sm" onClick={() => setOpen(e._id)}>View</button>}
              {!e && <button className="btn ghost sm" onClick={() => setOutside({ kind: 'estimate', note: '', total: '', number: '', gst: f.company?.billing?.gst || '', noGst: false })}>Already sent outside the CRM</button>}
            </div>
          )}
        </div>
      </div>

      {/* 3. payment */}
      <div className={`cd-step ${f.paymentReceived ? 'ok' : ''} ${!f.estimateSent ? 'locked' : ''}`}>
        <span className="cd-n">{f.paymentReceived ? <LuCheck /> : f.estimateSent ? 3 : <LuLock />}</span>
        <div className="cd-body">
          <b>Advance payment</b>
          {!f.estimateSent && <p className="small muted">Opens when the estimate is sent.</p>}
          {f.estimateSent && !f.paymentReceived && <p className="small">{f.advancePercent}% advance due: <b>₹{inr(f.advanceDue)}</b> of ₹{inr(f.total)}. Also asked in Needs you.</p>}
          {(f.company.payments || []).map((p, i) => <p key={i} className="small">Received ₹{inr(p.amount)} on {p.date}{p.reference ? ` · ${p.reference}` : ''} · by {p.by}</p>)}
          {f.estimateSent && !pay && <div className="row cd-actions"><button className={`btn ${f.paymentReceived ? 'ghost' : ''} sm`} onClick={() => setPay({ amount: String(f.paymentReceived ? '' : f.advanceDue || ''), date: today(), reference: '' })}><LuWallet /> {f.paymentReceived ? 'Add another payment' : 'Payment received'}</button></div>}
          {pay && (
            <form
              className="cd-form"
              onSubmit={async (ev) => {
                ev.preventDefault();
                const ok = await run(() => api(`/api/documents/company/${companyId}/payment`, { method: 'POST', body: pay }), 'Payment saved');
                if (ok) setPay(null);
              }}
            >
              <label className="field">Amount received (₹)<input required inputMode="numeric" value={pay.amount} onChange={(ev) => setPay({ ...pay, amount: ev.target.value })} /></label>
              <label className="field">Date<input type="date" value={pay.date} onChange={(ev) => setPay({ ...pay, date: ev.target.value })} /></label>
              <label className="field">Reference (UTR / cheque)<input value={pay.reference} onChange={(ev) => setPay({ ...pay, reference: ev.target.value })} /></label>
              <div className="row"><button className="btn sm" disabled={busy}>Save</button><button type="button" className="btn ghost sm" onClick={() => setPay(null)}>Cancel</button></div>
            </form>
          )}
        </div>
      </div>
      <div className={`cd-step ${!f.paymentReceived ? 'locked' : ''}`}>
        <span className="cd-n">{f.paymentReceived ? 4 : <LuLock />}</span>
        <div className="cd-body">
          <b>Checklist and account</b>
          <p className="small muted">{f.paymentReceived ? 'Tick the rest (brief, WhatsApp group…) with “Convert to account” below. The GST number was taken with the estimate.' : 'Opens when the advance is received.'}</p>
        </div>
      </div>

      {old.length > 0 && (
        <details className="cd-old">
          <summary className="small">Earlier versions ({old.length})</summary>
          {old.map((d) => (
            <div key={d._id} className="row cd-oldrow">
              <span className="small">{d.kind === 'estimate' ? d.number : `Agreement v${d.version}`} · {STATUS[d.status]} · {when(d.sentAt || d.createdAt)}</span>
              {d.status !== 'outside' && <button className="btn ghost sm" onClick={() => downloadPdf(d._id)}><LuDownload /> PDF</button>}
            </div>
          ))}
        </details>
      )}

      {outside && (
        <Modal onClose={() => setOutside(null)}>
          <h3>{outside.kind === 'agreement' ? 'Agreement done outside the CRM' : 'Estimate sent outside the CRM'}</h3>
          <p className="small muted">For a deal that was already in progress. The next step opens right away.</p>
          {outside.kind === 'estimate' && (
            <>
              <label className="field">Estimate number<input value={outside.number} onChange={(ev) => setOutside({ ...outside, number: ev.target.value })} placeholder="EST26-27-015" /></label>
              <label className="field">Total with GST (₹)<input required inputMode="numeric" value={outside.total} onChange={(ev) => setOutside({ ...outside, total: ev.target.value })} placeholder="e.g. 1,29,800" /></label>
              <label className="field">Client’s GST number<input value={outside.gst} disabled={outside.noGst} onChange={(ev) => setOutside({ ...outside, gst: ev.target.value.toUpperCase() })} placeholder="29ABCDE1234F1Z5" /></label>
              <label className="cd-checkline small"><input type="checkbox" checked={outside.noGst} onChange={(ev) => setOutside({ ...outside, noGst: ev.target.checked })} /> The client has no GST number</label>
            </>
          )}
          <label className="field">Note (optional)<input value={outside.note} onChange={(ev) => setOutside({ ...outside, note: ev.target.value })} placeholder="Signed copy received on WhatsApp" /></label>
          <div className="row cd-end">
            <button className="btn ghost" onClick={() => setOutside(null)}>Cancel</button>
            <button className="btn" disabled={busy} onClick={async () => (await run(() => api(`/api/documents/company/${companyId}/outside`, { method: 'POST', body: outside }), 'Saved')) && setOutside(null)}>Save</button>
          </div>
        </Modal>
      )}
      {open && <DocEditor id={open} contacts={f.contacts} onClose={() => (setOpen(null), load(), onChanged?.())} />}
    </div>
  );
}

/* ---------------- the editor (agreement or estimate) ---------------- */
const FIELDS = [
  ['effectiveDate', 'Effective date', 'date'],
  ['clientName', 'Client legal entity'],
  ['brand', 'Campaign brand'],
  ['creators', 'Creator slots'],
  ['maxProfiles', 'Most profiles shown'],
  ['guarantee', 'Minimum guarantee'],
  ['fee', 'Agency fee (₹, without GST)'],
  ['paymentTerms', 'Payment terms'],
  ['nonBarterPayout', 'Non-barter payout per creator (₹)'],
  ['logisticsFee', 'Logistics fee'],
  ['carryMonths', 'Carry-forward (months)'],
  ['nonCircMonths', 'Non-circumvention (months)'],
  ['jurisdiction', 'Courts at'],
];
const ANNEX = [
  ['annexCreators', 'Number of creators'],
  ['annexPayment', 'Payment terms'],
  ['annexEligibility', 'Eligibility criteria'],
  ['annexConsideration', 'Creator consideration'],
  ['annexDeliverables', 'Deliverables'],
  ['annexTimelines', 'Timelines'],
  ['annexApproval', 'Approval process'],
];

// a field on the left -> its marked spot(s) in the document (<span data-f="…">), written the way the template writes it
const dmy = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || '');
};
const MARKS = {
  effectiveDate: ['effective_date', dmy],
  clientName: ['client_name'],
  brand: ['brand'],
  creators: ['creators'],
  maxProfiles: ['max_profiles'],
  guarantee: ['guarantee'],
  fee: ['fee', (v) => (v ? `₹\u00A0${inr(v)}` : '')],
  paymentTerms: ['payment_terms'],
  nonBarterPayout: ['nonbarter_payout', (v) => (v ? `₹${inr(v)}` : '')],
  logisticsFee: ['logistics_fee'],
  carryMonths: ['carry_months'],
  nonCircMonths: ['noncirc_months'],
  jurisdiction: ['jurisdiction'],
  annexCreators: ['annex_creators'],
  annexPayment: ['annex_payment'],
  annexEligibility: ['annex_eligibility'],
  annexConsideration: ['annex_consideration'],
  annexDeliverables: ['annex_deliverables'],
  annexTimelines: ['annex_timelines'],
  annexApproval: ['annex_approval'],
};
const escHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BLANK = '__________';
/** write text into a marked spot, keeping bold / italic / underline put on the whole value */
function fillSpot(el, text) {
  let t = el;
  while (t.childNodes.length === 1 && t.firstElementChild && ['B', 'STRONG', 'I', 'EM', 'U'].includes(t.firstElementChild.tagName)) t = t.firstElementChild;
  t.innerHTML = text ? escHtml(text).replace(/\n/g, '<br>') : BLANK;
}
const FIELD_OF = Object.fromEntries(Object.entries(MARKS).map(([f, [key]]) => [key, f]));
/** text typed into a marked spot of the document -> the value of its field on the left (null = leave the field) */
function fieldValue(f, text) {
  let v = String(text || '').replace(/\u00A0/g, ' ').trim();
  if (/^_+$/.test(v)) v = '';
  if (f === 'fee' || f === 'nonBarterPayout') return v.replace(/[^\d.]/g, '');
  if (f === 'effectiveDate') {
    if (!v) return '';
    const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
  }
  return v;
}

export function DocEditor({ id, contacts = [], onClose }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('edit');
  const [pdf, setPdf] = useState(null);
  const [ask, setAsk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const html = useRef(''); // the document as it is now (the editor keeps its own text; React never rewrites it)
  const docBox = useRef(null); // the editor's element, to write a changed field into its marked spots
  const typed = useRef({}); // formatted fields typed in the document, tidied when the document loses focus
  const [docInit, setDocInit] = useState(''); // what the editor starts from (on load and after "Fill again")
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    api(`/api/documents/${id}`)
      .then((x) => {
        html.current = x.html || '';
        setDocInit(x.html || '');
        setD(x);
      })
      .catch((e) => notify(e.message, 'error'));
  }, [id]);
  useEffect(() => () => pdf && URL.revokeObjectURL(pdf), [pdf]);
  if (!d) return <Modal onClose={onClose} wide><p className="muted">Loading…</p></Modal>;
  const draft = d.status === 'draft';
  const isAgreement = d.kind === 'agreement';
  const setField = (k, v) => {
    setD((x) => ({ ...x, fields: { ...x.fields, [k]: v } }));
    const [key, fmt] = MARKS[k] || [];
    const box = docBox.current;
    if (!key || !box) return;
    const spots = box.querySelectorAll(`[data-f="${key}"]`);
    if (!spots.length) return;
    const text = String((fmt ? fmt(v) : v) ?? '').trim();
    spots.forEach((el) => fillSpot(el, text));
    html.current = box.innerHTML;
  };
  const marked = /data-f=/.test(docInit);
  // typed in the document itself: the field on the left and the same field's other spots follow
  const fromDoc = (spot) => {
    const key = spot.dataset.f;
    const f = FIELD_OF[key];
    if (!f) return;
    const text = spot.innerText;
    docBox.current?.querySelectorAll(`[data-f="${key}"]`).forEach((el) => el !== spot && (el.innerHTML = spot.innerHTML));
    const v = fieldValue(f, text);
    if (v === null) return;
    setD((x) => ({ ...x, fields: { ...x.fields, [f]: v } }));
    if (MARKS[f][1]) typed.current[key] = [f, v]; // ₹ amounts and the date get their usual look when the typing stops
  };
  const tidy = () => {
    const box = docBox.current;
    if (!box || !Object.keys(typed.current).length) return;
    for (const [key, [f, v]] of Object.entries(typed.current)) {
      const text = String(MARKS[f][1](v) ?? '').trim();
      box.querySelectorAll(`[data-f="${key}"]`).forEach((el) => fillSpot(el, text));
    }
    typed.current = {};
    html.current = box.innerHTML;
  };
  const setMail = (k, v) => setD((x) => ({ ...x, mail: { ...x.mail, [k]: v } }));
  const setEst = (patch) => setD((x) => ({ ...x, estimate: { ...x.estimate, ...patch } }));
  const body = (extra = {}) => (isAgreement ? { fields: d.fields, html: html.current, mail: d.mail, ...extra } : { estimate: d.estimate, mail: d.mail, ...extra });
  const save = async (extra, quiet) => {
    if (!draft) return d;
    setBusy(true);
    try {
      const x = await api(`/api/documents/${id}`, { method: 'PUT', body: body(extra) });
      if (extra?.refill) {
        html.current = x.html;
        setDocInit(x.html);
        setEditorKey((k) => k + 1);
        setEdited(false);
      }
      setD((cur) => ({ ...cur, ...x, mail: cur.mail }));
      if (!quiet) notify('Draft saved');
      return x;
    } catch (e) {
      notify(e.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };
  const preview = async () => {
    if (draft && !(await save(null, true))) return;
    try {
      const { url } = await getPdf(id, { inline: true });
      setPdf((old) => (old && URL.revokeObjectURL(old), url));
      setDocInit(html.current); // back on "Edit", the editor starts from the text as it is now (not as it was loaded)
      setTab('pdf');
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const download = async () => {
    if (draft && !(await save(null, true))) return;
    downloadPdf(id);
  };
  const refill = () =>
    edited
      ? setAsk({ title: 'Fill the document again from these values?', text: 'Your own changes in the document (text, bold, lists) will be replaced by the template filled with the values on the left.', confirm: 'Yes, fill again', danger: true, run: () => save({ refill: true }) })
      : save({ refill: true });
  const send = () =>
    setAsk({
      title: `Send the ${isAgreement ? 'agreement' : `estimate ${d.number}`} to ${d.mail?.to || '…'}?`,
      text: `The PDF is attached${isAgreement ? ' with a “Review & accept” button' : ''}. It goes right now from the CRM’s email${d.mail?.cc ? `, with a copy to ${d.mail.cc}` : ''}.`,
      confirm: 'Yes, send',
      run: async () => {
        if (!(await save(null, true))) throw new Error('Could not save');
        const x = await api(`/api/documents/${id}/send`, { method: 'POST', body: { mail: d.mail } });
        notify(`${isAgreement ? 'Agreement' : 'Estimate'} sent`);
        setD((cur) => ({ ...cur, ...x }));
        onClose();
      },
    });
  const remove = () =>
    setAsk({
      title: 'Delete this draft?',
      text: isAgreement ? 'You can make a new one any time.' : `Its number ${d.number} is given back if no later estimate was made.`,
      confirm: 'Yes, delete',
      danger: true,
      run: async () => {
        await api(`/api/documents/${id}`, { method: 'DELETE' });
        onClose();
      },
    });
  const totals = estTotals(d.estimate);

  return (
    <Modal onClose={onClose} wide>
      <style>{css}</style>
      <div className="row cd-between">
        <h3>{isAgreement ? `Agreement${d.version > 1 ? ` · version ${d.version}` : ''}` : `Estimate ${d.number}`} <span className={`cd-chip ${d.status}`}>{STATUS[d.status]}</span></h3>
        <div className="row">
          <div className="cd-tabs">
            <button type="button" className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>{draft ? 'Edit' : 'Details'}</button>
            <button type="button" className={tab === 'pdf' ? 'on' : ''} onClick={preview}>PDF preview</button>
          </div>
          <button type="button" className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
      </div>

      {tab === 'pdf' ? (
        <div className="cd-pdf">{pdf ? <iframe title="PDF" src={pdf} /> : <p className="muted">Making the PDF…</p>}</div>
      ) : (
        <>
          {!draft && (
            <div className="cd-info small">
              {d.sentAt && <p>Sent to <b>{d.sentTo}</b> · {when(d.sentAt)} by {d.sentBy}</p>}
              {d.viewedAt && <p>Opened by the client · {when(d.viewedAt)}</p>}
              {d.accepted?.at && <p>Accepted by <b>{d.accepted.name}</b>{d.accepted.designation ? `, ${d.accepted.designation}` : ''} · {when(d.accepted.at)}{d.accepted.email ? ` · ${d.accepted.email}` : ''}</p>}
              {(d.changes || []).map((c, i) => <p key={i}>Changes asked{c.name ? ` by ${c.name}` : ''}: “{c.text}” · {when(c.at)}</p>)}
              {d.reviewUrl && <p>Client’s link: <a href={d.reviewUrl} target="_blank" rel="noreferrer">{d.reviewUrl}</a></p>}
            </div>
          )}
          {isAgreement ? (
            <div className="cd-split">
              <fieldset className="cd-fields" disabled={!draft}>
                <b className="small">Campaign details</b>
                {draft && !marked && (
                  <div className="cd-note small">
                    This draft was made before the document filled itself. Press “Fill the document with these values” once; after that every change here shows in the document right away.
                    <button type="button" className="btn soft sm" disabled={busy} onClick={refill}>Fill the document with these values</button>
                  </div>
                )}
                {FIELDS.map(([k, l, t]) => <label key={k} className="field">{l}<input type={t || 'text'} value={d.fields?.[k] || ''} onChange={(e) => setField(k, e.target.value)} /></label>)}
                <b className="small">Annexure A</b>
                {ANNEX.map(([k, l]) => <label key={k} className="field">{l}<textarea rows={2} value={d.fields?.[k] || ''} onChange={(e) => setField(k, e.target.value)} /></label>)}
                {draft && <button type="button" className="btn soft sm" disabled={busy} onClick={refill}>Fill the whole document again</button>}
                <p className="small muted">Changes here show in the document right away. A blank shown as __________ must be filled before sending.</p>
              </fieldset>
              <div className="cd-docwrap">
                {draft && <Toolbar />}
                <DocBody
                  key={editorKey}
                  boxRef={docBox}
                  initial={docInit}
                  editable={draft}
                  onSpot={fromDoc}
                  onLeave={tidy}
                  onChange={(h) => {
                    html.current = h;
                    setEdited(true);
                  }}
                />
                {draft && <p className="small muted">Click anywhere in the document to change it, like a Google Doc. Keep the line “[Signatures]”: the signature block goes there.</p>}
              </div>
            </div>
          ) : (
            <fieldset className="cd-est" disabled={!draft}>
              <div className="cd-grid">
                <label className="field">Estimate number<input value={d.number} disabled /></label>
                <label className="field">Estimate date<input type="date" value={d.estimate?.date || ''} onChange={(e) => setEst({ date: e.target.value })} /></label>
                <label className="field cd-wide">Bill to (legal name)<input value={d.estimate?.billTo?.name || ''} onChange={(e) => setEst({ billTo: { ...d.estimate.billTo, name: e.target.value } })} /></label>
                <label className="field cd-wide">Address<textarea rows={3} value={d.estimate?.billTo?.address || ''} onChange={(e) => setEst({ billTo: { ...d.estimate.billTo, address: e.target.value } })} /></label>
                <label className="field">Client’s GST number<input value={d.estimate?.billTo?.gst || ''} disabled={Boolean(d.estimate?.noGst)} placeholder="29ABCDE1234F1Z5" onChange={(e) => setEst({ billTo: { ...d.estimate.billTo, gst: e.target.value.toUpperCase() } })} /></label>
                <label className="cd-checkline small"><input type="checkbox" checked={Boolean(d.estimate?.noGst)} onChange={(e) => setEst({ noGst: e.target.checked })} /> The client has no GST number</label>
                <label className="field">GST %<input inputMode="decimal" value={d.estimate?.gstRate ?? 18} onChange={(e) => setEst({ gstRate: e.target.value })} /></label>
              </div>
              <table className="cd-items">
                <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Rate (₹)</th><th>Amount (₹)</th><th /></tr></thead>
                <tbody>
                  {(d.estimate?.items || []).map((it, i) => {
                    const setIt = (patch) => setEst({ items: d.estimate.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                    return (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td><input value={it.desc || ''} onChange={(e) => setIt({ desc: e.target.value })} /></td>
                        <td><input inputMode="numeric" value={it.qty ?? ''} onChange={(e) => setIt({ qty: e.target.value })} /></td>
                        <td><input inputMode="numeric" value={it.rate ?? ''} onChange={(e) => setIt({ rate: e.target.value })} /></td>
                        <td className="cd-num">{inr(totals.items[i]?.amount)}</td>
                        <td>{draft && <button type="button" className="btn ghost sm" onClick={() => setEst({ items: d.estimate.items.filter((_, j) => j !== i) })}>✕</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {draft && <button type="button" className="btn soft sm" onClick={() => setEst({ items: [...(d.estimate.items || []), { desc: '', qty: '', rate: '' }] })}>Add a line</button>}
              <div className="cd-totals small">
                <span>Subtotal ₹{inr(totals.subtotal)}</span>
                <span>GST {totals.gstRate}% ₹{inr(totals.gst)}</span>
                <b>Total ₹{inr(totals.total)}</b>
              </div>
              <label className="field">Terms & Conditions (one per line)<textarea rows={3} value={(d.estimate?.terms || []).join('\n')} onChange={(e) => setEst({ terms: e.target.value.split('\n') })} /></label>
            </fieldset>
          )}

          <fieldset className="cd-mail" disabled={!draft}>
            <b className="small">Email</b>
            <div className="cd-grid">
              <label className="field">To (commas between emails)<input list="cd-people" value={d.mail?.to || ''} onChange={(e) => setMail('to', e.target.value)} /></label>
              <label className="field">CC<input value={d.mail?.cc || ''} onChange={(e) => setMail('cc', e.target.value)} /></label>
              <label className="field cd-wide">Subject<input value={d.mail?.subject || ''} onChange={(e) => setMail('subject', e.target.value)} /></label>
              <label className="field cd-wide">Message<textarea rows={7} value={d.mail?.body || ''} onChange={(e) => setMail('body', e.target.value)} /></label>
            </div>
            <datalist id="cd-people">{contacts.map((p) => <option key={p._id} value={p.email}>{p.name}</option>)}</datalist>
            {isAgreement && draft && <p className="small muted">A “Review & accept” button is added under the message automatically.</p>}
          </fieldset>
        </>
      )}

      <div className="row cd-actions cd-bottom">
        {draft && <button type="button" className="btn ghost" disabled={busy} onClick={() => save()}>Save draft</button>}
        <button type="button" className="btn ghost" onClick={download}><LuDownload /> Download PDF</button>
        {draft && <button type="button" className="btn ghost tm-del" onClick={remove}>Delete draft</button>}
        {draft && <button type="button" className="btn cd-send" disabled={busy} onClick={send}><LuSend /> Send</button>}
      </div>
      <ConfirmDialog ask={ask} onClose={() => setAsk(null)} />
    </Modal>
  );
}

function estTotals(e = {}) {
  const items = (e.items || []).map((it) => {
    const qty = Number(it.qty) || 0;
    const rate = Number(String(it.rate ?? '').replace(/[,₹\s]/g, '')) || 0;
    const typed = Number(String(it.amount ?? '').replace(/[,₹\s]/g, '')) || 0;
    return { amount: Math.round((qty && rate ? qty * rate : typed || rate) * 100) / 100 };
  });
  const subtotal = items.reduce((n, it) => n + it.amount, 0);
  const gstRate = Number.isFinite(Number(e.gstRate)) && String(e.gstRate ?? '') !== '' ? Number(e.gstRate) : 18;
  const gst = Math.round(subtotal * gstRate) / 100;
  return { items, subtotal, gstRate, gst, total: subtotal + gst };
}

/** the marked spot (<span data-f>) the caret is in, if any */
function spotIn(node, box) {
  let n = node?.nodeType === 3 ? node.parentNode : node;
  while (n && n !== box) {
    if (n.dataset?.f) return n;
    n = n.parentNode;
  }
  return null;
}

/** the editable document: rendered once, then the browser keeps the text (re-rendering would move the cursor) */
const DocBody = memo(
  function DocBody({ initial, editable, onChange, onSpot, onLeave, boxRef }) {
    const own = useRef(null);
    useEffect(() => {
      const box = own.current;
      if (!box || !editable) return;
      // a blank (__________) or a whole value that is selected is replaced as one piece, so typed text never lands
      // in the middle of the underscores; emptying a value leaves the blank (the spot stays linked to its field)
      const before = (e) => {
        const sel = window.getSelection();
        if (!sel?.rangeCount) return;
        const spot = spotIn(sel.anchorNode, box);
        if (!spot || spotIn(sel.focusNode, box) !== spot) return;
        const whole = spot.textContent === BLANK || (!sel.isCollapsed && sel.toString() === spot.textContent);
        const t = e.inputType || '';
        if (t === 'insertParagraph') {
          // Enter inside a value: a new line within the same value (a new paragraph would copy the mark and split the value)
          e.preventDefault();
          if (spot.textContent !== BLANK) document.execCommand('insertLineBreak');
          return;
        }
        let text = null;
        if (t === 'insertText' || t === 'insertReplacementText') text = e.data ?? e.dataTransfer?.getData('text/plain') ?? null;
        else if (t === 'insertFromPaste' || t === 'insertFromDrop') text = e.dataTransfer?.getData('text/plain') ?? null;
        if (text !== null && text !== '' && whole) {
          e.preventDefault();
          fillSpot(spot, text);
        } else if (t.startsWith('delete') && (whole || (sel.isCollapsed && spot.textContent.length <= 1))) {
          e.preventDefault();
          fillSpot(spot, '');
        } else return;
        let inner = spot; // the caret goes inside any bold/italic around the value, so the next letters keep it
        while (inner.lastChild?.nodeType === 1 && inner.lastChild.tagName !== 'BR') inner = inner.lastChild;
        const r = document.createRange();
        r.selectNodeContents(inner);
        r.collapse(spot.textContent === BLANK);
        sel.removeAllRanges();
        sel.addRange(r);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      };
      box.addEventListener('beforeinput', before);
      return () => box.removeEventListener('beforeinput', before);
    }, [editable]);
    const setRef = (el) => {
      own.current = el;
      if (boxRef) boxRef.current = el;
    };
    const input = (e) => {
      const spot = spotIn(window.getSelection()?.anchorNode, e.currentTarget);
      if (spot) onSpot?.(spot); // onSpot only uses setters and refs, so the first one stays right
      onChange(e.currentTarget.innerHTML);
    };
    return <div ref={setRef} className={`cd-doc ${editable ? 'editable' : ''}`} contentEditable={editable} suppressContentEditableWarning onInput={input} onBlur={() => onLeave?.()} dangerouslySetInnerHTML={{ __html: initial }} />;
  },
  (a, b) => a.initial === b.initial && a.editable === b.editable
);

/** bold / italic / underline / heading / lists for the document */
export function Toolbar() {
  const cmd = (c, v) => (e) => {
    e.preventDefault();
    document.execCommand(c, false, v);
  };
  return (
    <div className="cd-toolbar">
      <button type="button" title="Bold" onMouseDown={cmd('bold')}><LuBold /></button>
      <button type="button" title="Italic" onMouseDown={cmd('italic')}><LuItalic /></button>
      <button type="button" title="Underline" onMouseDown={cmd('underline')}><LuUnderline /></button>
      <button type="button" title="Heading" onMouseDown={cmd('formatBlock', 'h2')}><LuHeading2 /></button>
      <button type="button" title="Normal text" onMouseDown={cmd('formatBlock', 'p')}>¶</button>
      <button type="button" title="Bullet list" onMouseDown={cmd('insertUnorderedList')}><LuList /></button>
      <button type="button" title="Numbered list" onMouseDown={cmd('insertOrderedList')}><LuListOrdered /></button>
    </div>
  );
}

function Modal({ children, onClose, wide }) {
  return createPortal(
    <div className="cd-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <style>{css}</style>
      <div className={`cd-modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body
  );
}

const css = `
.cd-box { border: 1px solid rgba(26,169,200,.25); background: #f5fcff; border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; font-size: 13.5px; }
.cd-title { display: flex; align-items: center; gap: 6px; }
.cd-step { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; border-top: 1px dashed rgba(148,163,184,.35); }
.cd-step.locked { opacity: .6; }
.cd-n { flex: none; width: 26px; height: 26px; border-radius: 50%; background: #e0f2fe; color: #0369a1; display: grid; place-items: center; font-weight: 700; font-size: 13px; }
.cd-step.ok .cd-n { background: #dcfce7; color: #15803d; }
.cd-body { display: flex; flex-direction: column; gap: 5px; min-width: 0; flex: 1; }
.cd-body > b { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cd-body p { margin: 0; }
.cd-actions { gap: 8px; flex-wrap: wrap; }
.cd-chip { font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: #f1f5f9; color: #475569; }
.cd-chip.sent { background: #e0f2fe; color: #0369a1; }
.cd-chip.accepted, .cd-chip.outside { background: #dcfce7; color: #166534; }
.cd-chip.changes { background: #fef3c7; color: #92400e; }
.cd-chip.replaced { background: #f1f5f9; color: #94a3b8; }
.cd-changes { background: #fffbeb; border: 1px solid rgba(217,119,6,.25); border-radius: 10px; padding: 8px 10px; }
.cd-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; align-items: end; }
.cd-old summary { cursor: pointer; color: #475569; }
.cd-oldrow { justify-content: space-between; gap: 8px; padding: 4px 0; }
.cd-overlay { position: fixed; inset: 0; background: rgba(14,42,51,.35); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 70; display: flex; align-items: flex-start; justify-content: center; padding: 20px 12px; overflow-y: auto; }
.cd-modal { background: #fff; border-radius: 20px; padding: 20px; width: 460px; max-width: 100%; box-shadow: 0 20px 60px rgba(30,41,99,.25); display: flex; flex-direction: column; gap: 12px; color: #0e2a33; }
.cd-modal.wide { width: 1180px; }
.cd-modal h3 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cd-between { justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.cd-end { justify-content: flex-end; }
.cd-tabs { display: inline-flex; background: #eef2f6; border-radius: 99px; padding: 3px; }
.cd-tabs button { border: 0; background: transparent; font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 12px; border-radius: 99px; color: #64748b; cursor: pointer; }
.cd-tabs button.on { background: #fff; color: #0b87a5; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.cd-pdf iframe { width: 100%; height: 78vh; border: 1px solid rgba(148,163,184,.35); border-radius: 12px; }
.cd-info { background: #f8fafc; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.cd-info p { margin: 0; overflow-wrap: anywhere; }
.cd-split { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
.cd-fields, .cd-mail, .cd-est { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.cd-note { background: #fffbeb; border: 1px solid #fcd34d; color: #78350f; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.cd-checkline { display: flex; align-items: center; gap: 8px; color: #334155; }
.cd-fields { max-height: 72vh; overflow-y: auto; padding-right: 6px; }
.cd-fields textarea, .cd-mail textarea, .cd-est textarea { font-family: inherit; line-height: 1.5; }
.cd-docwrap { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cd-toolbar { display: flex; gap: 4px; padding: 8px 0 6px; position: sticky; top: -20px; z-index: 2; background: #fff; border-bottom: 1px solid rgba(148,163,184,.25); } /* -20px: the overlay's padding, so no text shows above it */
.cd-toolbar button { border: 1px solid rgba(148,163,184,.4); background: #fff; border-radius: 8px; width: 32px; height: 30px; display: grid; place-items: center; cursor: pointer; font-weight: 700; color: #334155; }
.cd-toolbar button:hover { background: #f1f5f9; }
.cd-doc { border: 1px solid rgba(148,163,184,.35); border-radius: 12px; padding: 28px 36px; max-height: 68vh; overflow-y: auto; font-family: Arial, Helvetica, sans-serif; font-size: 13.5px; line-height: 1.6; color: #1f2328; background: #fff; }
.cd-doc.editable { outline: none; box-shadow: inset 0 0 0 2px rgba(26,169,200,.0); }
.cd-doc.editable:focus { box-shadow: 0 0 0 3px rgba(26,169,200,.25); }
.cd-doc h1 { text-align: center; font-size: 21px; margin: 0 0 14px; }
.cd-doc h2 { font-size: 15px; margin: 16px 0 6px; }
.cd-doc h3 { font-size: 14px; margin: 14px 0 6px; }
.cd-doc p { margin: 0 0 10px; text-align: justify; }
.cd-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.cd-wide { grid-column: 1 / -1; }
.cd-items { width: 100%; border-collapse: collapse; font-size: 13px; }
.cd-items th { background: #5f5f5f; color: #fff; padding: 7px; text-align: left; font-weight: 700; }
.cd-items td { border-bottom: 1px solid #e2e8f0; padding: 5px; }
.cd-items td input { width: 100%; font: inherit; padding: 6px 8px; border-radius: 8px; border: 1px solid rgba(148,163,184,.4); min-width: 0; }
.cd-items td:nth-child(3) input, .cd-items td:nth-child(4) input { max-width: 110px; }
.cd-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cd-totals { display: flex; gap: 18px; justify-content: flex-end; align-items: baseline; flex-wrap: wrap; }
.cd-totals b { font-size: 15px; }
.cd-mail { border-top: 1px dashed rgba(148,163,184,.4); padding-top: 12px; }
.cd-bottom { justify-content: flex-end; border-top: 1px solid #eef2f6; padding-top: 12px; }
.cd-send { background: linear-gradient(150deg, #34d399, #16a34a); border-color: transparent; }
@media (max-width: 900px) { .cd-split { grid-template-columns: 1fr; } .cd-fields { max-height: none; } .cd-grid { grid-template-columns: 1fr; } }
`;
