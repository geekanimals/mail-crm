'use client';
// The one page for a lead, opened from everywhere (Pipeline, Contacts, Replies, Emails, Website Leads, Deals).
// A short company header, then tabs: Timeline (everything that happened, newest first), Company (stage, convert,
// details, people, team, tasks, messages) and one tab per person (Overview / Emails / Replies / Sheet details).
// /lead?company=<id>&person=<id>&tab=emails opens that person on that tab; /lead?person=<id> is a person with no company.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LuBuilding2, LuChevronLeft, LuExternalLink, LuHandshake, LuHistory } from 'react-icons/lu';
import CompanyDetails, { STAGE } from '@/components/CompanyDetails';
import PersonDetails from '@/components/PersonDetails';
import { api, campaignName, date, notify, stepName } from '@/lib/api';

const SUBS = ['overview', 'emails', 'replies', 'sheet'];
const href = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`);

export default function LeadPage() {
  const router = useRouter();
  const [q, setQ] = useState(null); // { company, person, convert, tab } from the address
  const [data, setData] = useState(null); // { company, contacts }
  const [view, setView] = useState(''); // 'timeline' | 'company' | <person id>
  const [sub, setSub] = useState('overview');
  const [convertKey, setConvertKey] = useState(0);
  const [activity, setActivity] = useState(null); // meetings, planned follow-ups, decisions (Needs you)
  const [meetAt, setMeetAt] = useState(null); // "Set a meeting" form (datetime-local value)

  useEffect(() => {
    const read = () => {
      const s = new URLSearchParams(window.location.search);
      const next = { company: s.get('company') || '', person: s.get('person') || '', convert: s.get('convert') === '1', tab: s.get('tab') || '' };
      setQ(next);
      setView(next.convert ? 'company' : next.person || (next.tab === 'company' ? 'company' : 'timeline'));
      setSub(SUBS.includes(next.tab) ? next.tab : 'overview');
    };
    setTimeout(read, 0);
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  // only a person given: if they belong to a company, show that company's page (at this person)
  useEffect(() => {
    if (!q || q.company || !q.person) return;
    api(`/api/contacts/${q.person}`)
      .then((r) => {
        const cid = r.contact?.companyId?._id || r.contact?.companyId;
        if (cid) router.replace(`/lead?company=${cid}&person=${q.person}${q.tab ? `&tab=${q.tab}` : ''}`), setTimeout(() => setQ({ ...q, company: String(cid) }), 0);
      })
      .catch((e) => notify(e.message, 'error'));
  }, [q, router]);

  const companyId = q?.company || '';
  const load = useCallback(() => {
    if (!companyId) return;
    api(`/api/companies/${companyId}`).then(setData).catch((e) => notify(e.message, 'error'));
    api(`/api/actions/company/${companyId}`).then(setActivity).catch(() => setActivity({ meetings: [], scheduled: [], actions: [] }));
  }, [companyId]);
  useEffect(() => {
    load();
  }, [load]);

  // keep the address in step with the open tab (so a link or refresh opens the same place)
  const go = (v, s = 'overview') => {
    setView(v);
    setSub(s);
    const p = new URLSearchParams();
    if (companyId) p.set('company', companyId);
    if (v !== 'timeline' && v !== 'company') p.set('person', v);
    else if (!companyId && q?.person) p.set('person', q.person);
    if (v === 'company') p.set('tab', 'company');
    else if (v !== 'timeline' && s !== 'overview') p.set('tab', s);
    window.history.replaceState(null, '', `/lead?${p}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!q) return <p className="muted">Loading…</p>;
  const back = <button type="button" className="ld-back" onClick={() => (window.history.length > 1 ? router.back() : router.push('/pipeline'))}><LuChevronLeft /> Back</button>;

  if (!q.company) {
    return (
      <div className="ld">
        <style>{css}</style>
        {back}
        {q.person ? (
          <>
            <p className="muted small">Not linked to a company yet. Add their company in “Edit” and it gets its own page.</p>
            <PersonDetails id={q.person} inline tab={sub} onTab={(s) => go(q.person, s)} />
          </>
        ) : (
          <p className="empty">Nothing to show. Open a company from <Link href="/pipeline">Pipeline</Link> or a person from <Link href="/contacts">Contacts</Link>.</p>
        )}
      </div>
    );
  }

  const c = data?.company;
  const people = data?.contacts || [];
  return (
    <div className="ld">
      <style>{css}</style>
      {back}
      <div className="ld-head">
        <div className="ld-title">
          <h1>{c?.name || 'Loading…'}</h1>
          {c && <span className={`stage ${c.stage}`}>{STAGE[c.stage]}</span>}
        </div>
        {c && (
          <p className="muted small">
            {[c.industry, c.location].filter(Boolean).join(' · ')}
            {c.website && <> {c.industry || c.location ? '· ' : ''}<a href={href(c.website)} target="_blank" rel="noopener noreferrer">{c.website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')} <LuExternalLink /></a></>}
            {' · '}{people.length} {people.length === 1 ? 'person' : 'people'}
          </p>
        )}
        {(() => {
          const next = (activity?.meetings || []).filter((m) => m.status === 'set').sort((a, b) => new Date(a.at) - new Date(b.at))[0];
          const planned = (activity?.scheduled || []).filter((x) => x.status === 'scheduled').sort((a, b) => new Date(a.sendAt) - new Date(b.sendAt))[0];
          const open = (activity?.actions || []).filter((a) => a.status === 'open').length;
          return (
            <div className="ld-meta">
              {next && <span className="ld-chip meet">Meeting: {when(next.at)}{next.sources?.length ? ` · ${next.sources.join(' + ')}` : ''}</span>}
              {planned && <Link href="/needs-you" className="ld-chip plan">{planned.label}: {new Date(planned.sendAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Link>}
              {open > 0 && <Link href="/needs-you" className="ld-chip needs">Needs your decision ({open})</Link>}
              {meetAt === null ? (
                <button type="button" className="ld-chip add" onClick={() => setMeetAt('')}>+ Set a meeting</button>
              ) : (
                <span className="ld-meetform">
                  <input type="datetime-local" value={meetAt} onChange={(e) => setMeetAt(e.target.value)} />
                  <button type="button" className="btn sm" disabled={!meetAt} onClick={async () => {
                    try {
                      await api('/api/actions/meeting', { method: 'POST', body: { company: companyId, at: `${meetAt}:00+05:30` } });
                      notify('Meeting set. You will be asked how it went.');
                      setMeetAt(null);
                      load();
                    } catch (e) {
                      notify(e.message, 'error');
                    }
                  }}>Save</button>
                  <button type="button" className="btn ghost sm" onClick={() => setMeetAt(null)}>Cancel</button>
                </span>
              )}
            </div>
          );
        })()}
        {c?.stage === 'opportunity' && view !== 'company' && (
          <button type="button" className="btn sm ld-convert" onClick={() => { setConvertKey((k) => k + 1); go('company'); }}><LuHandshake /> Convert to account</button>
        )}
        <div className="ld-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'timeline'} className={view === 'timeline' ? 'on' : ''} onClick={() => go('timeline')}><LuHistory /> Timeline</button>
          <button type="button" role="tab" aria-selected={view === 'company'} className={view === 'company' ? 'on' : ''} onClick={() => go('company')}><LuBuilding2 /> Company</button>
          {people.map((p) => (
            <button key={p._id} type="button" role="tab" aria-selected={view === p._id} className={view === p._id ? 'on' : ''} onClick={() => go(p._id)}>
              <i className={`dot ${p.status}`} />{p.name || p.email}
              {p.referredBy && <em>referral</em>}
            </button>
          ))}
        </div>
      </div>

      {view === 'timeline' && <Timeline people={people} activity={activity} onOpen={go} />}
      {view === 'company' && (
        <CompanyDetails key={convertKey} id={q.company} inline convertFirst={q.convert || convertKey > 0} onPerson={(pid) => go(pid)} onChanged={load} onClose={() => router.push('/pipeline')} />
      )}
      {view !== 'timeline' && view !== 'company' && (
        people.some((p) => p._id === view) || !data
          ? <PersonDetails key={view} id={view} inline tab={sub} onTab={(s) => go(view, s)} onChanged={load} />
          : <p className="empty">This person is not at this company any more. <button type="button" className="ct-tablink" onClick={() => go('timeline')}>Open the timeline</button></p>
      )}
    </div>
  );
}

/** Everything that happened at this company, newest first: uploads, referrals, emails, opens, replies, bounces. Click a row to open it. */
const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const CHOICE_LABEL = { later: 'Future follow-up', not_interested: 'Not interested', ooo: 'Out of office', hot: 'Hot lead', nothing: 'No action', set: 'Meeting set', deal: 'Deal done', details: 'Wants more details', get_back: 'Will get back on a date', didnt_happen: "Meeting didn't happen" };

function Timeline({ people, activity, onOpen }) {
  const [rows, setRows] = useState(null);
  const ids = people.map((p) => p._id).join(',');
  useEffect(() => {
    if (!ids) {
      setTimeout(() => setRows([]), 0);
      return undefined;
    }
    let live = true;
    Promise.all(ids.split(',').map((id) => api(`/api/contacts/${id}`).catch(() => null))).then((all) => {
      if (!live) return;
      const ev = [];
      const nameOf = new Map(all.filter(Boolean).map(({ contact: x }) => [String(x.email || '').toLowerCase(), x.name || x.email]));
      const from = (r, who) => (r.from && nameOf.get(String(r.from).toLowerCase())) || (r.from && r.from.toLowerCase() !== String(r.contact?.email || '').toLowerCase() ? r.from : who);
      all.filter(Boolean).forEach(({ contact: p, emails, replies }) => {
        const who = p.name || p.email;
        ev.push({ at: p.createdAt, pid: p._id, sub: 'overview', kind: 'add', title: p.referredBy ? `${who} added (referral)` : `${who} added`, text: p.referredBy ? `Referred by ${p.referredBy}` : campaignName(p.batch || p.source) || '' });
        (emails || []).forEach((m) => ev.push({ at: m.sentAt, pid: p._id, sub: 'emails', kind: m.status === 'failed' ? 'fail' : 'sent', title: `${stepName(m.step, m.kind)} to ${who}${m.openedAt ? ' · opened' : ''}`, text: m.status === 'failed' ? `Failed: ${m.error}` : m.subject }));
        (replies || []).forEach((r) => ev.push({ at: r.receivedAt, pid: p._id, sub: 'replies', kind: 'reply', title: `Reply from ${from(r, who)}${from(r, who) !== who ? ` (to the email sent to ${who})` : ''}${r.isAutoReply ? ' (auto-reply)' : ''}`, text: r.snippet || r.subject }));
        if (p.status === 'bounced') ev.push({ at: p.bounce?.at || p.updatedAt, pid: p._id, sub: 'overview', kind: 'fail', title: `Email to ${who} bounced`, text: p.bounce?.reason || '' });
      });
      // meetings, planned follow-ups and decisions from Needs you
      const nameById = new Map(all.filter(Boolean).map(({ contact: x }) => [String(x._id), x.name || x.email]));
      for (const m of activity?.meetings || []) {
        ev.push({ at: m.at, pid: m.contact || null, sub: 'overview', kind: 'meet', title: `Meeting${m.status === 'cancelled' ? ' (cancelled)' : m.status === 'done' ? ` · ${CHOICE_LABEL[m.outcome] || 'done'}` : ''}`, text: [m.notes, m.sources?.length ? `from ${m.sources.join(' + ')}` : ''].filter(Boolean).join(' · ') });
      }
      for (const x of activity?.scheduled || []) {
        if (x.status === 'cancelled') continue;
        ev.push({ at: x.status === 'sent' ? x.sentAt : x.sendAt, pid: x.contact, sub: 'emails', kind: x.status === 'scheduled' ? 'plan' : x.status === 'failed' ? 'fail' : 'sent', title: `${x.label} to ${nameById.get(String(x.contact)) || 'them'}${x.status === 'scheduled' ? ' (planned)' : x.status === 'failed' ? ' (failed)' : ''}`, text: String(x.body || '').split('\n').find((l) => l.trim() && !/^hi\b/i.test(l.trim())) || '' });
      }
      for (const a of activity?.actions || []) {
        if (a.status !== 'done' || !a.decision?.choice) continue;
        ev.push({ at: a.decidedAt, pid: a.contact?._id || null, sub: 'overview', kind: 'decide', title: `Decided: ${CHOICE_LABEL[a.decision.choice] || a.decision.choice}${a.decision.date ? ` · ${new Date(a.decision.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`, text: `${a.decidedBy || ''}${a.decision.notes ? ` · ${a.decision.notes}` : ''}` });
      }
      setRows(ev.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at)));
    });
    return () => {
      live = false;
    };
  }, [ids, activity]);

  if (!rows) return <div className="ld-card"><p className="muted">Loading…</p></div>;
  if (!rows.length) return <div className="ld-card"><p className="muted">Nothing has happened yet. Add a person in the Company tab.</p></div>;
  const icon = { add: '+', sent: '✉', reply: '↩', fail: '!', meet: '◷', plan: '⏲', decide: '✓' };
  return (
    <div className="ld-card">
      <p className="muted small">Everything at this company, newest first. Click a row to open it.</p>
      <ul className="ld-tl">
        {rows.map((e, i) => (
          <li key={i}>
            <button type="button" className={`k-${e.kind}`} onClick={() => (e.pid ? onOpen(String(e.pid), e.sub) : onOpen('company'))}>
              <span className="ld-ic">{icon[e.kind]}</span>
              <span className="ld-when">{date(e.at)}</span>
              <span className="ld-what"><b>{e.title}</b>{e.text && <small>{e.text}</small>}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const css = `
.ld-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.ld-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; border-radius: 99px; padding: 3px 10px; background: #f1f5f9; color: #475569; border: 0; font-family: inherit; cursor: default; text-decoration: none; }
.ld-chip.meet { background: #ede9fe; color: #6d28d9; } .ld-chip.plan { background: #e0f2fe; color: #0369a1; } .ld-chip.needs { background: #ffedd5; color: #c2410c; }
.ld-chip.add { cursor: pointer; background: #fff; border: 1px dashed #cbd5e1; } .ld-chip.add:hover { border-color: var(--c); color: var(--c-700); }
.ld-meetform { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.k-meet .ld-ic { background: #ede9fe; color: #6d28d9; } .k-plan .ld-ic { background: #e0f2fe; color: #0369a1; } .k-decide .ld-ic { background: #f1f5f9; color: #0f172a; }
.ld { display: flex; flex-direction: column; gap: 14px; }
.ld-back { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; padding: 0; font: inherit; color: var(--c-700); font-weight: 600; cursor: pointer; }
.ld-head { position: relative; background: #fff; border-radius: 22px; padding: 18px 20px 0; box-shadow: 0 12px 34px rgba(30,41,59,.06); border: 1px solid rgba(255,255,255,.85); }
.ld-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-right: 190px; }
.ld-title h1 { margin: 0; font-size: 22px; }
.ld-head > p { margin: 4px 0 0; }
.ld-head a { color: var(--c-700); display: inline-flex; align-items: center; gap: 3px; }
.ld-convert { position: absolute; top: 16px; right: 18px; display: inline-flex; align-items: center; gap: 6px; }
.ld-tabs { display: flex; gap: 2px; overflow-x: auto; margin-top: 14px; border-top: 1px solid #eef2f6; }
.ld-tabs button { flex: none; background: none; border: 0; border-bottom: 2px solid transparent; padding: 12px 14px; font: inherit; font-size: 14px; font-weight: 600; color: #64748b; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.ld-tabs button:hover { color: #0f172a; }
.ld-tabs button.on { color: var(--c-700); border-bottom-color: var(--c); }
.ld-tabs em { font-style: normal; font-size: 11px; font-weight: 600; background: #fef3c7; color: #92400e; border-radius: 99px; padding: 1px 7px; }
.ld-tabs .dot { width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; }
.ld-tabs .dot.replied { background: #16a34a; } .ld-tabs .dot.contacted { background: var(--c); } .ld-tabs .dot.bounced, .ld-tabs .dot.unsubscribed { background: #dc2626; }
.ld-card { background: #fff; border-radius: 22px; padding: 18px 20px; box-shadow: 0 12px 34px rgba(30,41,59,.06); border: 1px solid rgba(255,255,255,.85); }
.ld-tl { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; }
.ld-tl button { width: 100%; display: grid; grid-template-columns: 30px 110px 1fr; gap: 12px; align-items: start; text-align: left; background: none; border: 0; border-bottom: 1px solid #f1f5f9; padding: 11px 6px; font: inherit; cursor: pointer; border-radius: 10px; }
.ld-tl button:hover { background: #f8fafc; }
.ld-ic { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; background: #f1f5f9; color: #475569; }
.k-sent .ld-ic { background: var(--c-100); color: var(--c-700); } .k-reply .ld-ic { background: #dcfce7; color: #15803d; } .k-fail .ld-ic { background: #fee2e2; color: #b91c1c; } .k-add .ld-ic { background: #fef3c7; color: #92400e; }
.ld-when { font-size: 12.5px; color: #64748b; padding-top: 4px; }
.ld-what { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ld-what b { font-size: 14px; color: #0f172a; }
.ld-what small { font-size: 12.5px; color: #64748b; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ld .stage { display: inline-flex; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 99px; background: #f1f5f9; color: #475569; }
.ld .stage.hot { background: #ffedd5; color: #c2410c; } .ld .stage.opportunity { background: #fef9c3; color: #a16207; } .ld .stage.account { background: #dcfce7; color: #15803d; } .ld .stage.cold { background: #ede9fe; color: #6d28d9; } .ld .stage.later { background: #e0f2fe; color: #0369a1; } .ld .stage.not_interested { background: #fee2e2; color: #b91c1c; }
.ct-tablink { background: none; border: 0; padding: 0; font: inherit; color: var(--c-700); font-weight: 600; cursor: pointer; }
@media (max-width: 640px) {
  .ld-title { padding-right: 0; }
  .ld-convert { position: static; margin-top: 10px; }
  .ld-tl button { grid-template-columns: 26px 1fr; }
  .ld-when { grid-column: 2; padding-top: 0; }
  .ld-what { grid-column: 2; }
}
`;
