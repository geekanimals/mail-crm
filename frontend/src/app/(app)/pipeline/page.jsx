'use client';
// Pipeline: every company / brand by stage (cold lead -> hot lead -> opportunity -> account, + old clients),
// many contact points (members) per company, notes, and team tasks on each account.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STAGES, plCss } from '@/components/CompanyDetails';
import { LuChevronLeft, LuChevronRight, LuHandshake } from 'react-icons/lu';
import { api, date, num, notify } from '@/lib/api';

export default function PipelinePage() {
  const [stage, setStage] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const router = useRouter();
  const open = (id, convert) => router.push(`/lead?company=${id}${convert ? '&convert=1' : ''}`); // the one page for this company

  const load = useCallback(() => {
    api('/api/companies', { query: { stage, search, page } }).then(setData).catch((e) => notify(e.message, 'error'));
  }, [stage, search, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  // old links (/pipeline?open=id) open the company's page
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('open');
    if (id) router.replace(`/lead?company=${id}`);
  }, [router]);

  const update = async (c, body) => {
    try {
      await api(`/api/companies/${c._id}`, { method: 'PUT', body });
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const counts = data?.counts || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <style>{plCss}</style>
      <div className="page-title">
        <div>
          <h1>Pipeline</h1>
          <p>Cold lead → Hot lead (they replied) → Opportunity (talks going on) → Account (converted). An account gets its team, their tasks and messages.</p>
        </div>
      </div>

      {(
        <>
          <div className="pl-stages">
            <button className={stage === '' ? 'on' : ''} onClick={() => { setStage(''); setPage(1); }}><span>All</span><b>{num(all)}</b></button>
            {STAGES.map(([k, v]) => (
              <button key={k} className={`${stage === k ? 'on' : ''} s-${k}`} onClick={() => { setStage(k); setPage(1); }}><span>{v}</span><b>{num(counts[k] || 0)}</b></button>
            ))}
          </div>

          <div className="card">
            <div className="row pl-filters">
              <input placeholder="Search company, industry or city…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            {!data ? (
              <p className="muted">Loading…</p>
            ) : data.items.length === 0 ? (
              <p className="empty">No companies here yet. Import your sheet from the Import page, or add one.</p>
            ) : (
              <div className="table-wrap">
                <table className="cards">
                  <thead><tr><th>Company</th><th>Stage</th><th>People</th><th>Open tasks</th><th>Updated</th></tr></thead>
                  <tbody>
                    {data.items.map((c) => (
                      <tr key={c._id}>
                        <td>
                          <button className="pl-name" onClick={() => open(c._id)}>
                            <b>{c.name}</b>
                            <small>{[c.industry, c.location].filter(Boolean).join(' · ') || c.source || ''}</small>
                          </button>
                        </td>
                        <td data-label="Stage">
                          <select className={`pl-stage s-${c.stage}`} value={c.stage} onChange={(e) => (e.target.value === 'account' ? open(c._id, true) : update(c, { stage: e.target.value }))}>
                            {STAGES.map(([k, v]) => <option key={k} value={k} disabled={k === 'account' && !['opportunity', 'account'].includes(c.stage)}>{v}{k === 'account' && !['opportunity', 'account'].includes(c.stage) ? ' (after Opportunity)' : ''}</option>)}
                          </select>
                          {c.stage === 'opportunity' && (
                            <button className="pl-convert" title="Convert to account" onClick={() => open(c._id, true)}><LuHandshake /> Convert</button>
                          )}
                        </td>
                        <td data-label="People"><b>{c.contacts}</b> <small className="muted">{c.contactNames.join(', ')}</small></td>
                        <td data-label="Open tasks">{c.openTasks || '—'}</td>
                        <td data-label="Updated">{date(c.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data && data.pages > 1 && (
              <div className="row pl-pager">
                <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><LuChevronLeft /> Prev</button>
                <span className="small muted">Page {page} of {data.pages} · {num(data.total)} companies</span>
                <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next <LuChevronRight /></button>
              </div>
            )}
          </div>
        </>
      )}

    </>
  );
}
