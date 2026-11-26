'use client';
// Contacts: every person with all their details (A to Z from the sheet), their company + pipeline stage,
// email status, and the full email history. Replied / unsubscribed / bounced people are never emailed again.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CORE, FollowUp, STAGE, Value, ctCss, label } from '@/components/PersonDetails';
import { LuCalendarClock, LuChevronLeft, LuChevronRight, LuFileSpreadsheet, LuPause, LuPlay, LuUserPlus, LuX } from 'react-icons/lu';
import { api, date, leadHref, num, notify } from '@/lib/api';

const TABS = ['', 'new', 'contacted', 'replied', 'unsubscribed', 'bounced'];
const SEQS = [['', 'Everyone'], ['running', 'Follow-ups running'], ['paused', 'Paused'], ['none', 'Not in follow-ups']];
const EMPTY = { name: '', email: '', company: '', title: '', phone: '', linkedin: '', stage: 'cold' };
const empty = (v) => !v || /^(none|n\/?a|-|null)$/i.test(String(v).trim());
export default function ContactsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [seq, setSeq] = useState(''); // running / paused / not in follow-ups
  const [picked, setPicked] = useState(() => new Set()); // selected people (ids)
  const [allPicked, setAllPicked] = useState(false); // everyone in the current list, every page
  const [bulkDays, setBulkDays] = useState('');
  const [daysFor, setDaysFor] = useState(null); // { id, value } - the row whose days are being changed
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/api/contacts', { query: { search, status, page, seq } }).then(setData).catch((e) => notify(e.message, 'error'));
  }, [search, status, page, seq]);
  // opened from a dashboard link (e.g. /contacts?status=bounced or ?seq=running): start on that list
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const st = q.get('status');
    const sq = q.get('seq');
    if ((st && TABS.includes(st)) || (sq && SEQS.some(([k]) => k === sq))) {
      setTimeout(() => {
        if (st && TABS.includes(st)) setStatus(st);
        if (sq && SEQS.some(([k]) => k === sq)) setSeq(sq);
      }, 0);
    }
  }, []);

  // pause / play / set days - for one person (ids = [id]) or for the selection
  const followUps = async (action, { ids, gapDays } = {}) => {
    const many = !ids;
    const body = many ? (allPicked ? { all: true, search, status, seq } : { ids: [...picked] }) : { ids };
    const n = many ? (allPicked ? data.total : picked.size) : 1;
    if (many && n > 1 && action !== 'play' && !window.confirm(action === 'pause' ? `Pause follow-ups for ${n} people?` : gapDays ? `Set ${gapDays} working days between follow-ups for ${n} people?` : `Reset ${n} people to the campaign's default days?`)) return;
    setBusy(true);
    try {
      const r = await api('/api/contacts/followups', { method: 'POST', body: { ...body, action, gapDays } });
      const what = action === 'pause' ? 'paused' : action === 'play' ? 'playing again' : 'updated';
      notify(r.changed ? `${r.changed} ${r.changed === 1 ? 'person' : 'people'} ${what}${r.notRunning ? ` · ${r.notRunning} not in running follow-ups (skipped)` : ''}` : 'Nobody changed - no running follow-ups in the selection', r.changed ? 'success' : 'error');
      setDaysFor(null);
      load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id) => {
    const s = new Set(picked);
    s.has(id) ? s.delete(id) : s.add(id);
    setPicked(s);
    setAllPicked(false);
  };
  const pageIds = (data?.items || []).map((c) => c._id);
  const pageAll = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const togglePage = () => {
    const s = new Set(picked);
    pageIds.forEach((id) => (pageAll ? s.delete(id) : s.add(id)));
    setPicked(s);
    setAllPicked(false);
  };
  const clearPick = () => { setPicked(new Set()); setAllPicked(false); };
  const pickedCount = allPicked ? data?.total || 0 : picked.size;

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/contacts', { method: 'POST', body: form });
      notify('Contact added');
      setForm(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const action = async (c, what) => {
    const who = c.email || c.name;
    const ask = { unsubscribe: `Unsubscribe ${who}? They will never be emailed again.`, delete: `Delete ${who}?` }[what];
    if (ask && !window.confirm(ask)) return;
    try {
      if (what === 'delete') await api(`/api/contacts/${c._id}`, { method: 'DELETE' });
      else await api(`/api/contacts/${c._id}/${what}`, { method: 'POST' });
      notify('Done');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  // every other column found in the uploaded sheets on this page (A to Z)
  const extra = [];
  for (const c of data?.items || []) for (const f of c.fields || []) if (!CORE.test(f.k.trim()) && !extra.includes(f.k)) extra.push(f.k);
  const cellOf = (c, k) => (c.fields || []).find((f) => f.k === k)?.v;

  return (
    <>
      <style>{ctCss}</style>
      <div className="page-title">
        <div>
          <h1>Contacts</h1>
          <p>Every person with all their details. Replied, unsubscribed and bounced contacts are never emailed again.</p>
        </div>
        <div className="row">
          <Link href="/import" className="btn ghost"><LuFileSpreadsheet /> Import file</Link>
          <button className="btn" onClick={() => setForm(EMPTY)}><LuUserPlus /> Add Contact</button>
        </div>
      </div>

      {form && (
        <form className="card ct-form" onSubmit={add}>
          {Object.keys(EMPTY).filter((k) => k !== 'stage').map((k) => (
            <label className="field" key={k}>
              {k === 'title' ? 'Designation' : k === 'linkedin' ? 'LinkedIn' : k[0].toUpperCase() + k.slice(1)} {k === 'email' && '*'}
              <input type={k === 'email' ? 'email' : 'text'} required={k === 'email'} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          <label className="field">
            Pipeline stage
            <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
              {Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="row">
            <button className="btn">Save</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="tabs">
          {TABS.map((s) => (
            <button key={s} className={status === s ? 'on' : ''} onClick={() => { setStatus(s); setPage(1); clearPick(); }}>
              {s || 'All'} <span className="ct-count">{num(s ? counts[s] : total)}</span>
            </button>
          ))}
        </div>
        <input className="ct-search" placeholder="Search name, email, company, designation, phone or city…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); clearPick(); }} />
        <div className="row fu-filters">
          {SEQS.map(([k, l]) => (
            <button key={k} className={`fu-chip ${seq === k ? 'on' : ''}`} onClick={() => { setSeq(k); setPage(1); clearPick(); }}>
              {l}{k === 'running' && data?.seqCounts ? ` · ${num(data.seqCounts.running)}` : ''}{k === 'paused' && data?.seqCounts ? ` · ${num(data.seqCounts.paused)}` : ''}
            </button>
          ))}
        </div>

        {pickedCount > 0 && (
          <div className="fu-bulk">
            <div className="fu-bulk-who">
              <b>{num(pickedCount)} selected</b>
              {!allPicked && pageAll && data.total > pageIds.length && (
                <button className="link" onClick={() => setAllPicked(true)}>Select all {num(data.total)} in this list</button>
              )}
              {allPicked && <span className="muted small">Everyone in this list (all pages)</span>}
            </div>
            <div className="row fu-bulk-do">
              <label className="fu-days">
                Days between follow-ups
                <input type="number" min="1" max="60" placeholder="e.g. 5" value={bulkDays} onChange={(e) => setBulkDays(e.target.value)} />
              </label>
              <button className="btn sm" disabled={busy || !(bulkDays > 0)} onClick={() => followUps('gap', { gapDays: Number(bulkDays) })}><LuCalendarClock /> Set days</button>
              <button className="btn ghost sm" disabled={busy} onClick={() => followUps('gap', { gapDays: 0 })} title="Back to the campaign's default days">Default days</button>
              <button className="btn ghost sm" disabled={busy} onClick={() => followUps('pause')}><LuPause /> Pause</button>
              <button className="btn ghost sm" disabled={busy} onClick={() => followUps('play')}><LuPlay /> Play</button>
              <button className="btn ghost sm" onClick={clearPick}><LuX /> Clear</button>
            </div>
          </div>
        )}

        {!data ? (
          <p className="muted">Loading…</p>
        ) : data.items.length === 0 ? (
          <p className="empty">No contacts found.</p>
        ) : (
          <div className="table-wrap ct-wide">
            <table className="cards">
              <thead>
                <tr>
                  <th className="ct-sticky"><span className="ct-namehead"><input type="checkbox" className="ct-check" checked={pageAll} onChange={togglePage} title="Select everyone on this page" /> Name</span></th><th>Company</th><th>Follow-ups</th><th>Phone</th><th>LinkedIn</th><th>Email status</th><th>Last emailed</th>
                  {extra.map((k) => <th key={k}>{label(k)}</th>)}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c._id} className={allPicked || picked.has(c._id) ? 'ct-picked' : ''}>
                    <td className="ct-sticky">
                      <div className="ct-namecell">
                      <input type="checkbox" className="ct-check" checked={allPicked || picked.has(c._id)} disabled={allPicked} onChange={() => toggle(c._id)} />
                      <button className="ct-name" onClick={() => router.push(leadHref(c))}>
                        <b>{c.name || c.email || '—'}</b>
                        {c.title && <small className="ct-title">{c.title}</small>}
                        <small>{c.email || 'no email'}</small>
                      </button>
                      </div>
                    </td>
                    <td data-label="Company">
                      {c.companyId ? (
                        <Link href={leadHref({ companyId: c.companyId })} className="ct-company">
                          <b>{c.companyId.name}</b>
                          <span className={`stage ${c.companyId.stage}`}>{STAGE[c.companyId.stage]}</span>
                        </Link>
                      ) : (c.company || '—')}
                    </td>
                    <td data-label="Follow-ups" className="fu-cell">
                      <FollowUp f={c.followUp} />
                      <div className="row fu-row">
                        {c.followUp?.status === 'active' && (
                          c.followUp.paused
                            ? <button className="btn ghost sm fu-play" disabled={busy} onClick={() => followUps('play', { ids: [c._id] })}><LuPlay /> Play</button>
                            : <button className="btn ghost sm" disabled={busy} onClick={() => followUps('pause', { ids: [c._id] })}><LuPause /> Pause</button>
                        )}
                        {c.followUp?.status === 'active' && c.followUp.sent < c.followUp.total && (
                          daysFor?.id === c._id ? (
                            <span className="fu-inline">
                              <input type="number" min="1" max="60" autoFocus value={daysFor.value} onChange={(e) => setDaysFor({ ...daysFor, value: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter' && daysFor.value > 0) followUps('gap', { ids: [c._id], gapDays: Number(daysFor.value) }); if (e.key === 'Escape') setDaysFor(null); }} />
                              <button className="btn sm" disabled={busy || !(daysFor.value > 0)} onClick={() => followUps('gap', { ids: [c._id], gapDays: Number(daysFor.value) })}>Save</button>
                              <button className="btn ghost sm" onClick={() => setDaysFor(null)}>Cancel</button>
                            </span>
                          ) : (
                            <button className="btn ghost sm" onClick={() => setDaysFor({ id: c._id, value: c.followUp.gap })}><LuCalendarClock /> Days</button>
                          )
                        )}
                      </div>
                    </td>
                    <td data-label="Phone">{/^(none|n\/?a|-)$/i.test(c.phone || '') ? '—' : c.phone || '—'}</td>
                    <td data-label="LinkedIn">{empty(c.linkedin) ? '—' : <Value v={/^https?:/i.test(c.linkedin) ? c.linkedin : `https://${c.linkedin}`} />}</td>
                    <td data-label="Email status">
                      <span className={`badge ${c.status}`}>{c.status}</span>
                      {c.status === 'bounced' && (
                        <span className="ct-bounce" title={c.bounce?.detail || ''}>
                          <b>{c.bounce?.reason || 'Reason not found yet'}</b>
                          {c.bounce?.detail && <i>{c.bounce.detail}</i>}
                        </span>
                      )}
                    </td>
                    <td data-label="Last emailed">{date(c.lastContactedAt || c.followUp?.lastSentAt)}</td>
                    {extra.map((k) => {
                      const v = cellOf(c, k);
                      return <td key={k} data-label={label(k)} className="ct-cell" title={empty(v) ? '' : v}>{empty(v) ? '—' : <Value v={v} />}</td>;
                    })}
                    <td data-label="Actions">
                      <div className="row ct-actions">
                        {!['replied', 'unsubscribed'].includes(c.status) && <button className="btn ghost sm" onClick={() => action(c, 'replied')}>Replied</button>}
                        {c.status !== 'unsubscribed' && c.email && <button className="btn ghost sm" onClick={() => action(c, 'unsubscribe')}>Unsubscribe</button>}
                        <button className="btn ghost sm ct-del" onClick={() => action(c, 'delete')}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.pages > 1 && (
          <div className="row ct-pager">
            <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><LuChevronLeft /> Prev</button>
            <span className="small muted">Page {page} of {data.pages} · {num(data.total)} people</span>
            <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next <LuChevronRight /></button>
          </div>
        )}
      </div>

    </>
  );
}
