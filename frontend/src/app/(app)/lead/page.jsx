'use client';
// The one page for a lead, opened from everywhere (Pipeline, Contacts, Replies, Emails, Website Leads, Deals):
// the company at the top (stage, convert, details, team, tasks, messages) and every person's full details below.
// /lead?company=<id>&person=<id> jumps to that person; /lead?person=<id> is a person with no company.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LuChevronLeft } from 'react-icons/lu';
import CompanyDetails from '@/components/CompanyDetails';
import PersonDetails from '@/components/PersonDetails';
import { api, notify } from '@/lib/api';

export default function LeadPage() {
  const router = useRouter();
  const [q, setQ] = useState(null); // { company, person, convert } from the address
  const [people, setPeople] = useState(null);

  useEffect(() => {
    const read = () => {
      const s = new URLSearchParams(window.location.search);
      setQ({ company: s.get('company') || '', person: s.get('person') || '', convert: s.get('convert') === '1' });
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
        if (cid) router.replace(`/lead?company=${cid}&person=${q.person}`), setTimeout(() => setQ({ ...q, company: String(cid) }), 0);
      })
      .catch((e) => notify(e.message, 'error'));
  }, [q, router]);

  const companyId = q?.company || '';
  const loadPeople = useCallback(() => {
    if (!companyId) return;
    api(`/api/companies/${companyId}`).then((r) => setPeople(r.contacts)).catch((e) => notify(e.message, 'error'));
  }, [companyId]);
  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  // jump to the person that was clicked, once their card is on the page
  const goTo = (pid) => {
    const el = document.getElementById(`p-${pid}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
    return true;
  };
  useEffect(() => {
    if (!q?.person || !people) return undefined;
    let tries = 0;
    const t = setInterval(() => (goTo(q.person) || ++tries > 20) && clearInterval(t), 250);
    return () => clearInterval(t);
  }, [q, people]);

  if (!q) return <p className="muted">Loading…</p>;
  return (
    <div className="ld">
      <style>{css}</style>
      <button type="button" className="ld-back" onClick={() => (window.history.length > 1 ? router.back() : router.push('/pipeline'))}><LuChevronLeft /> Back</button>
      {q.company ? (
        <>
          <CompanyDetails id={q.company} inline convertFirst={q.convert} onPerson={goTo} onChanged={loadPeople} onClose={() => router.push('/pipeline')} />
          <h2 className="ld-h">People at this company {people ? `(${people.length})` : ''}</h2>
          {people && people.length === 0 && <p className="muted">No people yet. Add one with “Add member” above.</p>}
          {(people || []).map((p) => <PersonDetails key={p._id} id={p._id} inline onChanged={loadPeople} />)}
        </>
      ) : q.person ? (
        <>
          <p className="muted small">Not linked to a company yet. Add their company in “Edit” and it gets its own page.</p>
          <PersonDetails id={q.person} inline />
        </>
      ) : (
        <p className="empty">Nothing to show. Open a company from <Link href="/pipeline">Pipeline</Link> or a person from <Link href="/contacts">Contacts</Link>.</p>
      )}
    </div>
  );
}

const css = `
.ld { display: flex; flex-direction: column; gap: 16px; }
.ld-back { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; padding: 0; font: inherit; color: var(--c-700); font-weight: 600; cursor: pointer; }
.ld-h { margin: 10px 0 0; font-size: 18px; }
`;
