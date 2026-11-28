'use client';
// The client's "Review & accept" page (no login): read the agreement, download the PDF, accept it or ask for changes.
import { use, useCallback, useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';

const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
async function call(path, body) {
  const res = await fetch(`${API_URL}/api/public/agreement/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Something went wrong. Please try again.');
  return data;
}

export default function AgreementPage({ params }) {
  const { token } = use(params);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState(''); // '' | 'accept' | 'changes'
  const [form, setForm] = useState({ name: '', designation: '', email: '', agree: false, text: '' });
  const [busy, setBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState('');
  const load = useCallback(() => call(token).then(setD).catch((e) => setErr(e.message)), [token]);
  useEffect(() => {
    load();
  }, [load]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (mode === 'accept') {
        const r = await call(`${token}/accept`, { name: form.name, designation: form.designation, email: form.email, agree: form.agree });
        setDoneMsg(`Thank you. The agreement is accepted.${r.emailed ? ' A copy has been emailed to you.' : ''} You can download the accepted copy with “Download PDF”.`);
      } else {
        await call(`${token}/changes`, { name: form.name, text: form.text });
        setDoneMsg('Thank you. Your changes have been sent to Geek Creative Agency. You will get a revised agreement by email.');
      }
      setMode('');
      await load();
    } catch (x) {
      setErr(x.message);
    }
    setBusy(false);
  };

  return (
    <main className="ag">
      <style>{css}</style>
      <header className="ag-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Geek" className="ag-logo" />
        <span>Geek Creative Agency</span>
      </header>
      {!d && !err && <p className="ag-muted">Loading…</p>}
      {!d && err && <div className="ag-card"><h1>This link does not work</h1><p>{err}</p></div>}
      {d && (
        <>
          <div className="ag-card ag-head">
            <div>
              <h1>Agreement – Geek x {d.brand}</h1>
              <p className="ag-muted">For {d.clientName}{d.version > 1 ? ` · version ${d.version}` : ''}{d.sentAt ? ` · sent ${when(d.sentAt)}` : ''}</p>
            </div>
            <a className="ag-btn ghost" href={`${API_URL}/api/public/agreement/${token}/pdf`}>Download PDF</a>
          </div>
          {doneMsg && <div className="ag-card ag-ok">{doneMsg}</div>}
          {d.status === 'accepted' && d.accepted && <div className="ag-card ag-ok">Accepted by <b>{d.accepted.name}</b>{d.accepted.designation ? `, ${d.accepted.designation}` : ''} on {when(d.accepted.at)}.</div>}
          {d.status === 'replaced' && <div className="ag-card ag-warn">A newer version of this agreement was sent. Please use the link in the latest email.</div>}
          {d.status === 'changes' && !doneMsg && <div className="ag-card ag-warn">You asked for changes. Geek Creative Agency will send a revised agreement.</div>}

          <article className="ag-card ag-doc" dangerouslySetInnerHTML={{ __html: d.html }} />

          {d.status === 'sent' && !mode && (
            <div className="ag-card ag-actions">
              <p>Please read the agreement. If everything is right, accept it. If something should change, tell us.</p>
              <div className="ag-row">
                <button className="ag-btn" onClick={() => setMode('accept')}>Accept the agreement</button>
                <button className="ag-btn ghost" onClick={() => setMode('changes')}>Request changes</button>
              </div>
            </div>
          )}
          {(d.status === 'sent' || (d.status === 'changes' && mode === 'changes')) && mode && (
            <form className="ag-card ag-form" onSubmit={submit}>
              <h2>{mode === 'accept' ? 'Accept the agreement' : 'Request changes'}</h2>
              <label>Your full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              {mode === 'accept' ? (
                <>
                  <label>Designation<input required value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Marketing Head" /></label>
                  <label>Email (for your copy)<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
                  <label className="ag-check"><input type="checkbox" checked={form.agree} onChange={(e) => setForm({ ...form, agree: e.target.checked })} /> I have read the agreement and I accept it on behalf of {d.clientName}.</label>
                  <p className="ag-muted ag-small">Your name, designation and the time are recorded as your acceptance and written on the agreement.</p>
                </>
              ) : (
                <label>What should change?<textarea required rows={5} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></label>
              )}
              {err && <p className="ag-err">{err}</p>}
              <div className="ag-row">
                <button className="ag-btn" disabled={busy || (mode === 'accept' && !form.agree)}>{busy ? 'Please wait…' : mode === 'accept' ? 'Accept' : 'Send the changes'}</button>
                <button type="button" className="ag-btn ghost" onClick={() => setMode('')}>Back</button>
              </div>
            </form>
          )}
        </>
      )}
      <footer className="ag-muted ag-small">Geek Online Ventures Pvt. Ltd. · geekcreativeagency.com</footer>
    </main>
  );
}

const css = `
body { background: #eef3f7; margin: 0; }
.ag { max-width: 860px; margin: 0 auto; padding: 24px 16px 40px; font-family: Arial, Helvetica, sans-serif; color: #1f2328; display: flex; flex-direction: column; gap: 14px; }
.ag-top { display: flex; align-items: center; gap: 10px; font-weight: 700; color: #475569; }
.ag-logo { height: 28px; width: auto; }
.ag-card { background: #fff; border-radius: 16px; padding: 20px 22px; box-shadow: 0 8px 30px rgba(30,41,99,.06); }
.ag-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.ag-head h1 { margin: 0; font-size: 20px; }
.ag-head p { margin: 4px 0 0; }
.ag-muted { color: #64748b; }
.ag-small { font-size: 12.5px; }
.ag-ok { background: #ecfdf3; border: 1px solid #86efac; color: #14532d; }
.ag-warn { background: #fffbeb; border: 1px solid #fcd34d; color: #78350f; }
.ag-doc { font-size: 14.5px; line-height: 1.65; padding: 32px 40px; }
.ag-doc h1 { text-align: center; font-size: 22px; margin: 0 0 16px; }
.ag-doc h2 { font-size: 16px; margin: 20px 0 6px; }
.ag-doc p { margin: 0 0 12px; text-align: justify; }
.ag-actions p { margin: 0 0 12px; }
.ag-row { display: flex; gap: 10px; flex-wrap: wrap; }
.ag-btn { border: 0; background: #13aee6; color: #fff; font: inherit; font-weight: 700; padding: 11px 20px; border-radius: 10px; cursor: pointer; text-decoration: none; display: inline-block; }
.ag-btn:disabled { opacity: .55; cursor: default; }
.ag-btn.ghost { background: #fff; color: #0b87a5; border: 1px solid rgba(19,174,230,.45); }
.ag-form { display: flex; flex-direction: column; gap: 12px; }
.ag-form h2 { margin: 0; font-size: 17px; }
.ag-form label { display: flex; flex-direction: column; gap: 5px; font-size: 13.5px; font-weight: 600; color: #334155; }
.ag-form input, .ag-form textarea { font: inherit; font-weight: 400; padding: 10px 12px; border-radius: 10px; border: 1px solid #cbd5e1; }
.ag-form .ag-check { flex-direction: row; align-items: flex-start; gap: 8px; font-weight: 400; }
.ag-check input { margin-top: 3px; }
.ag-err { color: #b91c1c; margin: 0; }
footer { text-align: center; }
@media (max-width: 600px) { .ag-doc { padding: 20px 18px; } }
`;
