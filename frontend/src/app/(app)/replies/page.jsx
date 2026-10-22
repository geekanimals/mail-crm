'use client';
// Replies: everyone who answered (follow-ups stopped automatically). Out-of-office auto-replies have their own tab -
// they do NOT stop follow-ups and do NOT move the company in the pipeline.
import { useCallback, useEffect, useState } from 'react';
import { LuCheck, LuRefreshCw, LuReply } from 'react-icons/lu';
import { api, date, notify, stepName } from '@/lib/api';

const STAGE = { cold: 'Cold lead', hot: 'Hot lead', opportunity: 'Opportunity', account: 'Account', old_client: 'Old client' };

export default function RepliesPage() {
  const [handled, setHandled] = useState('false');
  const [list, setList] = useState(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(
    () => api('/api/replies', { query: handled === 'auto' ? { type: 'auto' } : { handled } }).then(setList).catch((e) => notify(e.message, 'error')),
    [handled]
  );
  useEffect(() => {
    load();
  }, [load]);

  const checkNow = async () => {
    setChecking(true);
    try {
      const r = await api('/api/replies/check', { method: 'POST' });
      notify(r.skipped || `Inbox checked · ${r.found} new replies`, r.skipped ? 'error' : 'ok');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
    setChecking(false);
  };

  const mark = (r, value) => api(`/api/replies/${r._id}/handled`, { method: 'POST', body: { handled: value } }).then(load);

  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Replies</h1>
          <p>Follow-ups stopped automatically for these people — continue the conversation from your inbox.</p>
        </div>
        <button className="btn ghost" onClick={checkNow} disabled={checking}><LuRefreshCw className={checking ? 'rp-spin' : ''} /> {checking ? 'Checking…' : 'Check inbox now'}</button>
      </div>
      <div className="card">
        <div className="tabs">
          {[['false', 'Needs attention'], ['true', 'Done'], ['', 'All replies'], ['auto', 'Auto-replies (out of office)']].map(([v, l]) => (
            <button key={l} className={handled === v ? 'on' : ''} onClick={() => setHandled(v)}>{l}</button>
          ))}
        </div>
        {!list ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="empty">{handled === 'auto' ? 'No out-of-office replies.' : 'No replies here.'}</p>
        ) : (
          list.map((r) => (
            <div key={r._id} className={`rp-item ${r.handled ? 'done' : ''}`}>
              <div className="rp-main">
                <div className="row rp-top">
                  <b>{r.contact?.name || r.from}</b>
                  <span className="small muted">{r.from} · {date(r.receivedAt)}</span>
                </div>
                {(r.contact?.title || r.contact?.companyId || r.contact?.company) && (
                  <p className="small muted rp-who">{[r.contact.title, r.contact.companyId?.name || r.contact.company].filter(Boolean).join(' · ')}</p>
                )}
                <div className="row rp-tags">
                  {r.isAutoReply && <span className="badge bounced">Auto-reply · follow-ups continue</span>}
                  {r.contact?.companyId && <span className={`rp-stage ${r.contact.companyId.stage}`}>{STAGE[r.contact.companyId.stage]}</span>}
                  {r.campaign && <span className="badge active">{r.campaign.name}</span>}
                  {r.afterStep ? <span className="badge replied">after {stepName(r.afterStep)}</span> : null}
                </div>
                {r.subject && <p className="rp-subject">{r.subject}</p>}
                {r.snippet && <p className="rp-text">{r.snippet}</p>}
              </div>
              {!r.isAutoReply && <div className="rp-actions">
                <a className="btn soft sm" href={`mailto:${r.from}?subject=${encodeURIComponent(/^re:/i.test(r.subject || '') ? r.subject : `Re: ${r.subject || ''}`)}`}><LuReply /> Reply</a>
                <button className="btn ghost sm" onClick={() => mark(r, !r.handled)}>{r.handled ? <><LuRefreshCw /> Reopen</> : <><LuCheck /> Done</>}</button>
              </div>}
            </div>
          ))
        )}
      </div>
    </>
  );
}

const css = `
.rp-item { display: flex; gap: 14px; padding: 16px 0; border-bottom: 1px solid rgba(148,163,184,.18); }
.rp-item:last-child { border-bottom: 0; }
.rp-item.done { opacity: .65; }
.rp-main { flex: 1; min-width: 0; }
.rp-top { justify-content: space-between; }
.rp-tags { margin: 6px 0; gap: 6px; }
.rp-who { margin-top: 2px; }
.rp-stage { font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 99px; background: #f1f5f9; color: #475569; }
.rp-stage.hot { background: #fff1e6; color: #c2410c; }
.rp-stage.opportunity { background: #fef9c3; color: #a16207; }
.rp-stage.account { background: #dcfce7; color: #15803d; }
.rp-subject { font-weight: 600; font-size: 13.5px; }
.rp-text { white-space: pre-wrap; background: rgba(255,255,255,.6); border-left: 3px solid var(--c-200); border-radius: 8px; padding: 10px 12px; margin-top: 6px; font-size: 13.5px; color: #334155; }
.rp-spin { animation: spin .8s linear infinite; }
.rp-actions { display: flex; flex-direction: column; gap: 8px; }
@media (max-width: 600px) {
  .rp-item { flex-direction: column; }
  .rp-actions { flex-direction: row; }
  .rp-actions .btn { flex: 1; }
}
`;
