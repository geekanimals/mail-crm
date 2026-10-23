'use client';
// Import contacts from a CSV or Excel (.xlsx) file.
// Each row = one person + the FIRST email written for them (subject / body or subject_1 / body_1).
// Follow-ups are fixed (backend/templates.js) - only name and company change - and go every
// N working days (picked from the dropdown, Sat/Sun not counted) in the same thread, with CC.
// The moment they reply, nothing more is sent.
// Second mode "Already contacted": people you emailed before. A status column says what was already
// sent (first sent / followup 2 sent ...) and the next follow-up goes from there.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LuCalendarDays, LuDownload, LuFileSpreadsheet, LuPlay, LuUpload } from 'react-icons/lu';
import { api, num, notify } from '@/lib/api';

// [key, label, rules tried in order, never these] - e.g. "company_name" is never taken as the person's name
const BASIC = [
  ['email', 'Email *', [/^(dm_)?e-?mail$/i, /e-?mail|recipient/i], /company|sent|date|source|subject|body/i],
  ['name', 'Name', [/^(dm_)?name$/i, /^(contact|person|full|lead|dm).*name/i, /^name/i, /\bname\b/i], /company|brand|organi|business|file|campaign/i],
  ['company', 'Company', [/^company(_| )?name$/i, /^company$/i, /^brand(_| )?name/i, /company|organi|business|brand/i], /contact|linkedin|size|url|phone/i],
  ['title', 'Designation', [/^dm_title$/i, /designation/i, /^(job )?title$/i, /position/i], /role_title|subject|page/i],
  ['phone', 'Phone', [/^(dm_)?phone$/i, /^mobile/i, /phone|mobile|whatsapp/i], /company contact/i],
  ['linkedin', 'LinkedIn', [/^dm_linkedin$/i, /^linkedin$/i, /linkedin(?!.*(url|company|sent|connection))/i], /company|sent|date/i],
  ['website', 'Website', [/^website$/i, /website|domain/i], /linkedin|job/i],
  ['industry', 'Industry', [/^industry$/i, /industry|category|sector/i], /$^/],
  ['location', 'Location', [/^location$/i, /city|location|country|hq/i], /$^/],
  ['signal', 'Buying signal', [/buying signal/i, /^signal$/i], /$^/],
  ['notes', 'Notes / remarks', [/^remarks?$/i, /^notes?$/i], /$^/],
  ['leadDate', 'Lead date', [/lead date/i, /date_added|date added/i], /$^/],
  ['status', 'Status', [/^status$/i, /status|stage/i], /$^/],
  ['pipeline', 'Pipeline stage (per person)', [/^pipeline/i], /$^/],
  ['referredBy', 'Referred by', [/referr?ed.?by|^referral/i], /$^/],
  ['lastSent', 'Last email sent on', [/sent.?(on|date)/i, /^last/i], /$^/],
];
// big files go in small pieces, so each request finishes well inside the server's 60-second limit
const CHUNK = 25;
const STAGES = [['cold', 'Cold lead'], ['hot', 'Hot lead'], ['opportunity', 'Opportunity'], ['account', 'Account'], ['old_client', 'Old client']];

/* ---------- CSV ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  const first = text.split('\n')[0];
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/* ---------- Excel .xlsx (no library: unzip + read the XML) ---------- */
async function readXlsx(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 70000); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .xlsx file');
  const files = {};
  let p = view.getUint32(eocd + 16, true);
  for (let n = view.getUint16(eocd + 10, true); n > 0; n--) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extra = view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    files[name] = { method, size, local };
    p += 46 + nameLen + extra;
  }
  const read = async (name) => {
    const f = files[name];
    if (!f) return null;
    const start = f.local + 30 + view.getUint16(f.local + 26, true) + view.getUint16(f.local + 28, true);
    let data = bytes.subarray(start, start + f.size);
    if (f.method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    return new DOMParser().parseFromString(new TextDecoder().decode(data), 'application/xml');
  };
  const all = (doc, tag) => [...doc.getElementsByTagNameNS('*', tag)];
  const text = (el) => all(el, 't').map((t) => t.textContent).join('');

  // first sheet of the workbook
  const wb = await read('xl/workbook.xml');
  const rels = await read('xl/_rels/workbook.xml.rels');
  const firstId = wb && all(wb, 'sheet')[0]?.getAttribute('r:id');
  let target = rels && all(rels, 'Relationship').find((r) => r.getAttribute('Id') === firstId)?.getAttribute('Target');
  target = target ? 'xl/' + target.replace(/^\/?xl\//, '') : Object.keys(files).filter((f) => /^xl\/worksheets\/[^/]+\.xml$/.test(f)).sort()[0];
  const sheet = await read(target);
  if (!sheet) throw new Error('No sheet found in this file');
  const ss = await read('xl/sharedStrings.xml');
  const shared = ss ? all(ss, 'si').map(text) : [];

  const rows = [];
  for (const r of all(sheet, 'row')) {
    const row = [];
    for (const c of all(r, 'c')) {
      const col = (c.getAttribute('r') || '').replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const type = c.getAttribute('t');
      const v = all(c, 'v')[0]?.textContent ?? '';
      row[col >= 0 ? col : row.length] = type === 's' ? shared[+v] ?? '' : type === 'inlineStr' ? text(c) : v;
    }
    const filled = Array.from(row, (x) => x ?? '');
    if (filled.some((x) => String(x).trim())) rows.push(filled);
  }
  return rows;
}

/* ---------- "already sent" status -> how many emails went out (same rule as the backend) ---------- */
function parseStage(v, fixed) {
  const s = String(v || '').toLowerCase().replace(/[_]+/g, ' ').trim();
  if (!s || /^(new|fresh|not sent|pending|0)$/.test(s)) return { sent: 0 };
  if (/unsub/.test(s)) return { stop: 'Unsubscribed' };
  if (/bounce/.test(s)) return { stop: 'Bounced' };
  if (/repl/.test(s)) return { stop: 'Replied' };
  if (/done|complete|finished|all sent/.test(s)) return { sent: 1 + fixed };
  const fu = s.match(/(?:follow\s*-?\s*up|f\/?u)\s*-?\s*(\d+)/) || s.match(/(\d+)\s*(?:st|nd|rd|th)?\s*follow/);
  if (fu) return { sent: 1 + Math.min(Number(fu[1]), fixed) };
  if (/first|initial|intro|start|1st|^sent$|contacted/.test(s)) return { sent: 1 };
  return { error: true };
}
function parseDay(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  let d;
  if (/^\d{5}(\.\d+)?$/.test(s)) d = new Date(Math.round((Number(s) - 25569) * 86400000));
  else if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) d = new Date(s.slice(0, 10) + 'T10:30:00+05:30');
  else {
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    d = m ? new Date(`${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T10:30:00+05:30`) : new Date(s);
  }
  return isNaN(d) ? null : d;
}

/* ---------- working days (same rule as the backend) ---------- */
const GAPS = [1, 2, 3, 4, 5, 7, 10];
function addWorkingDays(from, n, skip) {
  const d = new Date(from);
  for (let left = n; left > 0; ) {
    d.setDate(d.getDate() + 1);
    if (!skip || (d.getDay() !== 0 && d.getDay() !== 6)) left--;
  }
  return d;
}
const firstWorkingDay = (d, skip) => {
  const x = new Date(d);
  while (skip && (x.getDay() === 0 || x.getDay() === 6)) x.setDate(x.getDate() + 1);
  return x;
};
const dayName = (d) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

/* ---------- find "subject 1 / body 1 / day 2 ..." columns ---------- */
function findMessageColumns(headers, subjectOnly = false) {
  const steps = {};
  headers.forEach((h, i) => {
    const n = parseInt((h.match(/\d+/) || [])[0], 10);
    const low = h.toLowerCase();
    let key = null;
    if (/subject|\bsub\b/.test(low)) key = 'subject';
    else if (/\bday/.test(low)) key = 'day';
    else if (/body|message|msg|content|text|mail/.test(low)) key = 'body';
    if (!key) return;
    const step = Number.isFinite(n) ? n : 1; // "subject" / "body" without a number = first email
    if (!Number.isFinite(n) && key === 'day') return;
    if (!Number.isFinite(n) && key === 'body' && !/body|message|msg|content|text/.test(low)) return; // e.g. the "Email" address column
    (steps[step] ||= {})[key] = i;
  });
  return Object.keys(steps).map(Number).sort((a, b) => a - b).filter((s) => steps[s].body !== undefined || (subjectOnly && s === 1 && steps[s].subject !== undefined)).map((s) => ({ step: s, ...steps[s] }));
}

export default function ImportPage() {
  const [mode, setMode] = useState('fresh'); // fresh = new leads, continue = already contacted
  const [file, setFile] = useState(null); // { name, headers, rows }
  const [map, setMap] = useState({});
  const [msgCols, setMsgCols] = useState([]);
  const [batch, setBatch] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [prog, setProg] = useState(''); // "75 / 465" while a big file is being saved
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [defaults, setDefaults] = useState({ followUps: [], skipWeekends: true });
  const [gap, setGap] = useState(3); // working days between follow-ups (default 3)
  const [cc, setCc] = useState('');
  const [ownFollowUps, setOwnFollowUps] = useState(false);
  const [today, setToday] = useState(null);
  const [pstage, setPstage] = useState('cold'); // pipeline stage for the companies in this upload

  useEffect(() => {
    api('/api/campaigns').then((l) => setCampaigns(l.filter((c) => c.status !== 'completed'))).catch(() => {});
    api('/api/campaigns/defaults')
      .then((d) => {
        setDefaults(d);
        setGap(d.intervalDays || 3);
        setCc(d.cc || '');
        setToday(new Date());
      })
      .catch(() => {});
  }, []);

  const onFile = async (f) => {
    if (!f) return;
    try {
      let rows;
      if (/\.xlsx$/i.test(f.name)) rows = await readXlsx(await f.arrayBuffer());
      else if (/\.(csv|txt)$/i.test(f.name)) rows = parseCSV(await f.text());
      else return notify('Please upload a .csv or .xlsx file (old .xls: save as .xlsx first)', 'error');
      const headers = (rows.shift() || []).map((h) => String(h).trim());
      if (!rows.length) return notify('The file has no rows', 'error');

      const msgs = findMessageColumns(headers, mode === 'continue');
      const used = new Set(msgs.flatMap((m) => [m.subject, m.body, m.day]).filter((x) => x !== undefined));
      const m = {};
      for (const [key, , rules, not] of BASIC) {
        for (const re of rules) {
          const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(h) && !not.test(h));
          if (i >= 0) { m[key] = i; used.add(i); break; }
        }
      }
      // the email column must contain addresses
      const looksEmail = (i) => rows.slice(0, 10).some((r) => /^\S+@\S+\.\S+$/.test(String(r[i] || '').trim()));
      if (m.email === undefined || !looksEmail(m.email)) {
        const i = headers.findIndex((_, idx) => looksEmail(idx));
        if (i >= 0) m.email = i;
      }
      setFile({ name: f.name, headers, rows });
      setMap(m);
      setMsgCols(msgs);
      setBatch(f.name.replace(/\.(csv|txt|xlsx)$/i, ''));
      setResult(null);
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  const cell = (r, i) => (i === undefined ? '' : String(r[i] ?? '').trim());
  const msgIdx = new Set(msgCols.flatMap((m) => [m.subject, m.body, m.day]).filter((x) => x !== undefined));
  const people = () =>
    file.rows.map((r) => {
      const o = Object.fromEntries(BASIC.filter(([k]) => map[k] !== undefined).map(([k]) => [k, cell(r, map[k])]));
      o.firstSubject = msgCols[0] ? cell(r, msgCols[0].subject) : '';
      // every column of the sheet, saved with the contact (A to Z)
      o.fields = file.headers.map((k, i) => ({ k: k || `Column ${i + 1}`, v: cell(r, i) })).filter((f) => f.v && !msgIdx.has(file.headers.indexOf(f.k)));
      o.messages = (ownFollowUps ? msgCols : msgCols.slice(0, 1))
        .map((m) => ({ subject: cell(r, m.subject), body: cell(r, m.body), day: m.day !== undefined && cell(r, m.day) !== '' ? Number(cell(r, m.day)) : undefined }))
        .filter((x) => x.body);
      return o;
    });

  const runImport = async (startNow) => {
    setBusy(true);
    const all = people();
    const total = { inserted: 0, updated: 0, alreadyInCrm: 0, invalid: 0, addedToCampaign: 0, noFirstEmail: 0 };
    let cid = campaignId;
    try {
      for (let i = 0; i < all.length; i += CHUNK) {
        setProg(`${Math.min(i + CHUNK, all.length)} / ${all.length}`);
        const r = await api('/api/contacts/import', { method: 'POST', body: { rows: all.slice(i, i + CHUNK), batch, campaignId: cid || undefined, startNow, gapDays: gap, cc, stage: pstage } });
        for (const k in total) total[k] += r[k] || 0;
        if (r.campaignId) cid = r.campaignId; // later chunks go into the same campaign
      }
      setResult({ ...total, campaignId: cid, startNow });
      setFile(null);
      notify(startNow || campaignId ? `${total.addedToCampaign} people will start receiving your emails` : `${total.inserted} contacts imported`);
    } catch (e) {
      notify(e.message, 'error');
    }
    setBusy(false);
  };

  const runContinue = async () => {
    setBusy(true);
    const all = people().map((p, i) => ({
      ...p,
      subject: msgCols[0] ? cell(file.rows[i], msgCols[0].subject) : '',
      body: msgCols[0] ? cell(file.rows[i], msgCols[0].body) : '',
      messages: undefined,
    }));
    const total = { started: 0, fresh: 0, finished: 0, stopped: 0, skipped: 0, invalid: 0, alreadyInCrm: 0, savedNoEmail: 0, errors: [] };
    let cid;
    try {
      for (let i = 0; i < all.length; i += CHUNK) {
        setProg(`${Math.min(i + CHUNK, all.length)} / ${all.length}`);
        const r = await api('/api/contacts/import-continue', { method: 'POST', body: { rows: all.slice(i, i + CHUNK), batch, gapDays: gap, cc, campaignId: cid, stage: pstage } });
        for (const k of ['started', 'fresh', 'finished', 'stopped', 'skipped', 'invalid', 'alreadyInCrm', 'savedNoEmail']) total[k] += r[k] || 0;
        total.errors.push(...(r.errors || []));
        if (r.campaignId) cid = r.campaignId;
      }
      setResult({ ...total, campaignId: cid, continue: true });
      setFile(null);
      notify(`${total.started + total.fresh} people will get their next email`);
    } catch (e) {
      notify(e.message, 'error');
    }
    setBusy(false);
  };

  const sample = () => {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = mode === 'continue' ? [
      ['name', 'email', 'company', 'subject', 'status', 'last_sent_date'],
      ['Aakriti Rawal', 'aakriti@example.com', 'House of Chikankari', 'On your Series A - creator amplification for House of Chikankari', 'first sent', '15-10-2026'],
      ['Rahul Sharma', 'rahul@example.com', 'Acme', 'Quick idea for Acme', 'followup 1 sent', '13-10-2026'],
      ['Priya Singh', 'priya@example.com', 'Bright Labs', 'Creator campaigns for Bright Labs', 'followup 2 sent', '12-10-2026'],
      ['Neha Gupta', 'neha@example.com', 'Glow Co', 'Barter creators for Glow Co', 'replied', ''],
    ] : [
      ['name', 'email', 'company', 'subject', 'body'],
      ['Aakriti Rawal', 'aakriti@example.com', 'House of Chikankari', 'On your Series A - creator amplification for House of Chikankari',
        'Hi Aakriti,\n\nSaw House of Chikankari raised its Series A in April. With funding in, launches and awareness spend usually follow, and creator amplification is how that spend gets noticed.\n\nWe run influencer campaigns with micro- and nano-creators on a barter basis...\n\nIf it\'s worth it, reply and I\'ll send a short note on what a barter creator campaign would look like for your brand.'],
      ['Rahul Sharma', 'rahul@example.com', 'Acme', 'Quick idea for Acme', 'Hi Rahul,\n\nYour first email written by you...'],
    ];
    const text = rows.map((r) => r.map(q).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv' }));
    a.download = mode === 'continue' ? 'geek-sample-already-contacted.csv' : 'geek-sample-first-email.csv';
    a.click();
  };

  const preview = file ? people() : []; // every row from the file
  const nextFor = (p) => {
    const st = parseStage(p.status, fixed);
    if (st.error) return { text: `Unknown status "${p.status}"`, bad: true };
    if (st.stop) return { text: `${st.stop} — never emailed` };
    if (st.sent >= 1 + fixed) return { text: 'All emails sent — nothing more' };
    const label = st.sent === 0 ? 'First email' : `Follow-up ${st.sent}`;
    const last = parseDay(p.lastSent);
    let when = 'today';
    if (st.sent > 0 && last && today) {
      const d = addWorkingDays(last, gap, defaults.skipWeekends);
      when = d < today ? 'today (overdue)' : dayName(d);
    }
    return { text: `${label} · ${when}` };
  };
  const fixed = defaults.followUps.length;
  const hasOwnFu = msgCols.length > 1;
  const fuCount = ownFollowUps && hasOwnFu ? `${msgCols.length - 1} from your file` : `${fixed} fixed`;
  // example timeline if the first email goes out today
  const plan = [];
  if (today) {
    let d = firstWorkingDay(today, defaults.skipWeekends);
    plan.push(['First email', d]);
    for (let i = 1; i <= (ownFollowUps && hasOwnFu ? msgCols.length - 1 : fixed); i++) {
      d = addWorkingDays(d, gap, defaults.skipWeekends);
      plan.push([`Follow-up ${i}`, d]);
    }
  }

  return (
    <>
      <style>{css}</style>
      <div className="page-title">
        <div>
          <h1>Import Contacts</h1>
          <p>{mode === 'fresh'
            ? 'File mein sirf first email likho. Follow-ups fixed hain (sirf naam + company badlega). Reply aate hi aage ka koi mail nahi jayega.'
            : 'Jinko pehle mail ja chuka hai: status likho (first sent / followup 2 sent …), agla follow-up wahi se jayega.'}</p>
        </div>
        {mode !== 'google' && <button className="btn soft" onClick={sample}><LuDownload /> Download sample</button>}
      </div>

      <div className="im-modes">
        {[['fresh', 'Fresh leads', 'New people · first email from your file'], ['continue', 'Already contacted', 'Continue from the next follow-up'], ['google', 'Google Sheet (old data)', 'Old leads, opportunities, accounts · no emails sent']].map(([k, t, d]) => (
          <button key={k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); setFile(null); setResult(null); }}>
            <b>{t}</b><span>{d}</span>
          </button>
        ))}
      </div>

      {mode === 'google' && <GoogleImport />}

      {mode !== 'google' && !file && (
        <>
          <label className="card im-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
            <span className="im-icon"><LuFileSpreadsheet /></span>
            <b>Drag & drop your CSV or Excel (.xlsx) file here</b>
            <span className="muted small">or click to choose a file</span>
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => onFile(e.target.files[0])} />
          </label>
          {mode === 'continue' && (
            <div className="card">
              <h2>How to write the &quot;already contacted&quot; file</h2>
              <div className="table-wrap">
                <table className="im-guide">
                  <thead><tr><th>Column</th><th>What to write</th></tr></thead>
                  <tbody>
                    <tr><td><code>email</code></td><td>Person&apos;s email (required)</td></tr>
                    <tr><td><code>name</code>, <code>company</code></td><td>Used in the follow-ups (&quot;Hi Aakriti&quot;, &quot;… for House of Chikankari&quot;)</td></tr>
                    <tr><td><code>subject</code></td><td>Subject of the <b>first</b> email you sent them — follow-ups go as &quot;Re: subject&quot; (required)</td></tr>
                    <tr><td><code>status</code></td><td>What was <b>already sent</b> — see the list below (required)</td></tr>
                    <tr><td><code>last_sent_date</code></td><td>Date of that last email, e.g. <code>15-10-2026</code> or <code>2026-10-15</code>. The next one goes after your chosen gap in working days. Empty = goes today</td></tr>
                  </tbody>
                </table>
              </div>
              <h3 className="im-h3">Status values</h3>
              <div className="table-wrap">
                <table className="im-guide">
                  <thead><tr><th>Write in status</th><th>Next email that goes</th></tr></thead>
                  <tbody>
                    <tr><td><code>new</code> (or empty)</td><td>First email — needs <code>subject</code> + <code>body</code> like a fresh lead</td></tr>
                    <tr><td><code>first sent</code></td><td>Follow-up 1</td></tr>
                    {Array.from({ length: Math.max(0, (fixed || 6) - 1) }, (_, i) => (
                      <tr key={i}><td><code>followup {i + 1} sent</code></td><td>Follow-up {i + 2}</td></tr>
                    ))}
                    <tr><td><code>followup {fixed || 6} sent</code></td><td>Nothing — all emails done</td></tr>
                    <tr><td><code>replied</code> / <code>unsubscribed</code> / <code>bounced</code></td><td>Nothing, ever — saved so they are never emailed again</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="small muted im-note">Also understood: <code>fu2</code>, <code>follow-up 2 sent</code>, <code>2nd followup sent</code>. Rows with an unknown status are skipped and listed after the upload. Reply / unsubscribe still stops everything.</p>
            </div>
          )}
          {mode === 'fresh' && (
          <div className="card">
            <h2>How to write your file</h2>
            <div className="table-wrap">
              <table className="im-guide">
                <thead><tr><th>Column</th><th>What to write</th></tr></thead>
                <tbody>
                  <tr><td><code>email</code></td><td>Person&apos;s email (required)</td></tr>
                  <tr><td><code>name</code>, <code>company</code></td><td>Used in the fixed follow-ups (&quot;Hi Aakriti&quot;, &quot;… for House of Chikankari&quot;)</td></tr>
                  <tr><td><code>subject</code>, <code>body</code></td><td>Your first email for this person (or <code>subject_1</code>, <code>body_1</code>)</td></tr>
                  <tr><td>Follow-ups</td><td>Not needed in the file — {fixed || 6} fixed follow-ups go automatically as &quot;Re: first subject&quot; in the same thread, only if they have <b>not</b> replied</td></tr>
                  <tr><td><code>status</code></td><td>Optional — <code>contacted</code> / <code>replied</code> / <code>unsubscribed</code> for old leads</td></tr>
                </tbody>
              </table>
            </div>
            <p className="small muted im-note">Gap between follow-ups and CC are chosen after you upload. Saturday &amp; Sunday are off — only working days are counted.</p>
          </div>
          )}
        </>
      )}

      {mode !== 'google' && file && (
        <div className="card">
          <h2>{file.name} · {num(file.rows.length)} people</h2>
          <div className="im-grid">
            {BASIC.filter(([k]) => mode === 'continue' || k !== 'lastSent').map(([key, label]) => (
              <label className="field" key={key}>
                {mode === 'continue' && key === 'status' ? 'Status (already sent) *' : mode === 'fresh' && key === 'status' ? 'Previous status' : label}
                <select value={map[key] ?? ''} onChange={(e) => setMap({ ...map, [key]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">— skip —</option>
                  {file.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>

          {mode === 'continue' ? (
            <div className={`im-found ${msgCols[0]?.subject !== undefined && map.status !== undefined ? '' : 'none'}`}>
              {msgCols[0]?.subject !== undefined ? <>First-email subject column found</> : <>No <code>subject</code> column found — needed for &quot;Re: subject&quot;</>}
              {map.status === undefined && <> · <b>choose the Status column above</b></>}
            </div>
          ) : (
          <div className={`im-found ${msgCols.length ? '' : 'none'}`}>
            {msgCols.length ? (
              <><b>First email found</b> (subject + body) · then {fuCount} follow-ups</>
            ) : (
              <>No subject / body columns found. Contacts will be imported without a first email.</>
            )}
          </div>
          )}
          {mode === 'fresh' && hasOwnFu && (
            <label className="im-own">
              <input type="checkbox" checked={ownFollowUps} onChange={(e) => setOwnFollowUps(e.target.checked)} />
              Your file also has {msgCols.length - 1} follow-up column(s). Use those instead of the fixed follow-ups
            </label>
          )}

          {map.email !== undefined && (
            <div className="im-count">All {num(preview.length)} people from the file{preview.filter((p) => !p.email).length ? ` · ${preview.filter((p) => !p.email).length} without email (saved for LinkedIn / phone, never emailed)` : ''}</div>
          )}
          {map.email !== undefined && (
            <div className="table-wrap im-preview">
              {mode === 'continue' ? (
              <table>
                <thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Last sent</th><th>Next email</th><th>Subject</th></tr></thead>
                <tbody>
                  {preview.map((p, i) => {
                    const n = nextFor(p);
                    return (
                      <tr key={i}>
                        <td>{p.email}</td>
                        <td>{p.name}</td>
                        <td>{p.status || 'new'}</td>
                        <td>{p.lastSent || '—'}</td>
                        <td className={n.bad ? 'im-bad' : 'im-next'}>{n.text}</td>
                        <td className="im-cell">{p.firstSubject}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              ) : (
              <table>
                <thead><tr><th>Email</th><th>Name</th><th>Company</th><th>First subject</th><th>First message</th></tr></thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i}>
                      <td>{p.email}</td>
                      <td>{p.name}</td>
                      <td>{p.company}</td>
                      <td className="im-cell">{p.messages[0]?.subject}</td>
                      <td className="im-cell">{p.messages[0]?.body}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}

            </div>
          )}

          <div className="im-sched">
            <h3><LuCalendarDays /> Follow-ups</h3>
            <div className="im-grid">
              <label className="field">
                Gap between follow-ups
                <select value={gap} onChange={(e) => setGap(Number(e.target.value))} disabled={Boolean(campaignId)}>
                  {GAPS.map((g) => <option key={g} value={g}>Every {g} working day{g > 1 ? 's' : ''}</option>)}
                </select>
              </label>
              <label className="field">
                CC on every email
                <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="mayank@geekcreativeagency.com" disabled={Boolean(campaignId)} />
              </label>
            </div>
            {mode === 'continue' ? (
              <p className="small muted">Next email = last sent date + this gap (working days). Already overdue → goes today.</p>
            ) : campaignId ? (
              <p className="small muted">Existing campaign chosen — its own gap and CC are used.</p>
            ) : (
              <div className="im-plan">
                {plan.map(([l, d]) => <span key={l}><b>{l}</b>{dayName(d)}</span>)}
              </div>
            )}
            <p className="small muted">{defaults.skipWeekends ? 'Saturday & Sunday are off: nothing is sent and they are not counted (Thursday + 2 working days = Monday). ' : ''}Several CCs: separate with commas. Empty = no CC.</p>
          </div>

          <div className="im-grid">
            <label className="field">Name for this upload<input value={batch} onChange={(e) => setBatch(e.target.value)} /></label>
            <label className="field">
              Pipeline stage (companies)
              <select value={pstage} onChange={(e) => setPstage(e.target.value)}>
                {STAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {mode === 'fresh' && <label className="field">
              Add to an existing campaign (optional)
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">— no —</option>
                {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </label>}
          </div>
          {mode === 'continue' ? (
          <div className="row">
            <button className="btn" disabled={busy || map.email === undefined || map.status === undefined} onClick={runContinue}>
              <LuPlay /> {busy ? `Working… ${prog}` : 'Import & continue follow-ups'}
            </button>
            <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
          </div>
          ) : (
          <div className="row">
            <button className="btn" disabled={busy || map.email === undefined} onClick={() => runImport(true)}>
              <LuPlay /> {busy ? `Working… ${prog}` : campaignId ? 'Import & add to campaign' : 'Import & start sending'}
            </button>
            <button className="btn ghost" disabled={busy || map.email === undefined} onClick={() => runImport(false)}><LuUpload /> Import only</button>
            <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
          </div>
          )}
          <p className="small muted im-note">Sending follows your daily limit and sending hours (.env). People who already got emails, replied or unsubscribed are skipped.</p>
        </div>
      )}

      {result?.continue && (
        <div className="card">
          <div className="im-result">
            <div><b>{num(result.started)}</b><span>Continue from next follow-up</span></div>
            <div><b>{num(result.fresh)}</b><span>Get the first email</span></div>
            <div><b>{num(result.stopped + result.finished)}</b><span>Replied / unsub / all done — no email</span></div>
            <div><b>{num(result.savedNoEmail)}</b><span>Saved without email (LinkedIn / phone)</span></div>
            <div><b>{num(result.alreadyInCrm)}</b><span>Already in CRM — skipped</span></div>
            <div><b>{num(result.skipped + result.invalid)}</b><span>Skipped</span></div>
          </div>
          {result.errors.length > 0 && (
            <details className="im-errors">
              <summary>{result.errors.length} row(s) need attention</summary>
              <ul>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </details>
          )}
          {result.campaignId && <p className="im-note"><Link className="im-link" href={`/campaigns?open=${result.campaignId}`}>Open the campaign to watch progress →</Link></p>}
        </div>
      )}

      {result && !result.continue && (
        <div className="card">
          <div className="im-result">
            <div><b>{num(result.inserted)}</b><span>New contacts</span></div>
            <div><b>{num(result.alreadyInCrm)}</b><span>Already in CRM — skipped</span></div>
            <div><b>{num(result.invalid)}</b><span>Invalid / no email</span></div>
            <div><b>{num(result.addedToCampaign)}</b><span>Started sending</span></div>
          </div>
          {result.noFirstEmail > 0 && <p className="im-note">{num(result.noFirstEmail)} people were not started because their row has no first email (subject + body). Add it to the file and upload again.</p>}
          {result.campaignId && <p className="im-note"><Link className="im-link" href={`/campaigns?open=${result.campaignId}`}>Open the campaign to watch progress →</Link></p>}
        </div>
      )}
    </>
  );
}

/* ---------- old data from a Google Sheet link (no email is sent) ---------- */
const KINDS = [
  ['', 'Detect automatically'],
  ['leads', 'Leads (name, email, company, status …)'],
  ['opportunities', 'Opportunities (brand, contact, notes, owner)'],
  ['accounts', 'Accounts (brand + campaign, a column per team member)'],
];
function GoogleImport() {
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState('');
  const [stage, setStage] = useState('');
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);

  // follow the import while it runs
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const t = setTimeout(() => {
      api(`/api/companies/import/google/${job.id}`)
        .then((j) => {
          setJob(j);
          if (j.status === 'done') {
            notify('Sheet imported');
            setHistory((h) => [j, ...h]);
          }
          if (j.status === 'error') notify(j.error, 'error');
        })
        .catch((e) => notify(e.message, 'error'));
    }, 1500);
    return () => clearTimeout(t);
  }, [job]);

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/api/companies/import/google', { method: 'POST', body: { url, kind: kind || undefined, stage: stage || undefined } });
      setJob({ id: r.jobId, kind: r.kind, status: 'running', done: 0, total: r.rows, result: {} });
    } catch (err) {
      notify(err.message, 'error');
    }
    setBusy(false);
  };

  const r = job?.result || {};
  const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0;
  const LABELS = { newContacts: 'New contacts', updatedContacts: 'Contacts updated', withoutEmail: 'Without email (saved)', companies: 'Companies', opportunities: 'Opportunities', accounts: 'Accounts', tasks: 'Team tasks', skipped: 'Skipped (empty rows)' };

  return (
    <>
      <form className="card im-google" onSubmit={start}>
        <h2>Import old data from Google Sheets</h2>
        <p className="muted small">Paste the link of <b>one tab</b> (the link changes when you click a tab — it ends with <code>#gid=…</code>). Do it once for each tab: Leads, Opportunity, Accounts. Every column is saved. <b>No email is sent.</b></p>
        <label className="field">Google Sheet link (this tab)<input required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" /></label>
        <div className="im-grid">
          <label className="field">What is in this tab?
            <select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="field">Pipeline stage for leads
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">From the Status column</option>
              {STAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <p className="small muted">Status column: Converted → Account · Lead / Meeting done / FFU → Hot lead (marked replied, no auto email) · NI → never emailed · rest → Cold lead. The sheet must be shared as &quot;Anyone with the link&quot;.</p>
        <div className="row"><button className="btn" disabled={busy || job?.status === 'running'}><LuDownload /> {job?.status === 'running' ? 'Importing…' : 'Import this tab'}</button></div>
        {job && (
          <div className="im-job">
            <div className="im-bar"><span style={{ width: `${job.status === 'done' ? 100 : pct}%` }} /></div>
            <p className="small">{job.status === 'running' ? `Importing ${job.kind}… ${num(job.done)} / ${num(job.total)}` : job.status === 'done' ? `Done — ${job.kind}` : `Error: ${job.error}`}</p>
            {job.status !== 'running' && (
              <div className="im-result">
                {Object.entries(r).map(([k, v]) => <div key={k}><b>{num(v)}</b><span>{LABELS[k] || k}</span></div>)}
              </div>
            )}
          </div>
        )}
      </form>
      {history.length > 1 && <p className="small muted">Imported this session: {history.map((h) => h.kind).join(', ')}</p>}
      <div className="row"><Link className="btn ghost" href="/pipeline">Open Pipeline →</Link><Link className="btn ghost" href="/contacts">Open Contacts →</Link></div>
    </>
  );
}

const css = `
.im-google { display: flex; flex-direction: column; gap: 12px; }
.im-google code { background: #f1f5f9; padding: 1px 6px; border-radius: 6px; }
.im-job { border: 1px solid rgba(50,193,223,.25); border-radius: 14px; padding: 14px; background: rgba(50,193,223,.05); display: flex; flex-direction: column; gap: 10px; }
.im-bar { height: 8px; border-radius: 99px; background: rgba(148,163,184,.2); overflow: hidden; }
.im-bar span { display: block; height: 100%; background: linear-gradient(90deg, #5fd3eb, #1aa9c8); transition: width .4s; }
.im-drop { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 56px 20px; border: 1.5px dashed var(--c-200); cursor: pointer; text-align: center; }
.im-drop:hover { border-color: var(--c); background: rgba(255,255,255,.8); box-shadow: 0 14px 40px rgba(50,193,223,.16); }
.im-icon { width: 64px; height: 64px; border-radius: 20px; background: linear-gradient(150deg, #5fd3eb, #32c1df 55%, #1aa9c8); color: #fff; display: grid; place-items: center; font-size: 28px; box-shadow: 0 10px 24px rgba(50,193,223,.35); margin-bottom: 6px; }
.im-guide td { font-size: 13.5px; }
.im-guide code, .im-note code { background: #f1f5f9; padding: 1px 6px; border-radius: 6px; font-size: 12.5px; }
.im-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
.im-found { background: rgba(22,163,74,.1); color: #166534; padding: 12px 14px; border-radius: 10px; margin-bottom: 16px; font-size: 13.5px; }
.im-found.none { background: rgba(249,115,22,.1); color: #9a3412; }
.im-preview { margin-bottom: 16px; max-height: 460px; overflow: auto; border: 1px solid rgba(148,163,184,.22); border-radius: 12px; }
.im-preview thead th { position: sticky; top: 0; z-index: 1; background: #f4fbfd; }
.im-count { font-size: 13px; font-weight: 600; color: var(--c-700); margin: 0 0 8px; }
.im-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.im-note { margin-top: 12px; }
.im-modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.im-modes button { text-align: left; border: 1px solid rgba(50,193,223,.25); background: rgba(255,255,255,.6); border-radius: 16px; padding: 14px 16px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font: inherit; color: #334155; transition: all .15s; }
.im-modes button span { font-size: 12.5px; color: #64748b; }
.im-modes button:hover { border-color: var(--c); box-shadow: 0 8px 22px rgba(50,193,223,.14); }
.im-modes button.on { background: linear-gradient(150deg, #5fd3eb, #32c1df 55%, #1aa9c8); color: #fff; border-color: transparent; box-shadow: 0 10px 24px rgba(50,193,223,.3); }
.im-modes button.on span { color: rgba(255,255,255,.88); }
.im-h3 { font-size: 14px; margin: 18px 0 10px; }
.im-next { color: var(--c-700); font-weight: 600; white-space: nowrap; }
.im-bad { color: #e11d48; font-weight: 600; }
.im-errors { margin-top: 14px; font-size: 13px; }
.im-errors summary { cursor: pointer; color: #b45309; font-weight: 600; }
.im-errors ul { margin: 8px 0 0 18px; color: #475569; }
@media (max-width: 600px) { .im-modes { grid-template-columns: 1fr; } }
.im-own { display: flex; gap: 8px; align-items: center; font-size: 13.5px; margin: -6px 0 16px; cursor: pointer; }
.im-sched { border: 1px solid rgba(50,193,223,.25); background: rgba(50,193,223,.05); border-radius: 14px; padding: 16px; margin-bottom: 16px; }
.im-sched h3 { display: flex; align-items: center; gap: 8px; font-size: 15px; margin-bottom: 12px; color: var(--c-700); }
.im-sched .im-grid { margin-bottom: 12px; }
.im-plan { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 10px; }
.im-plan span { flex-shrink: 0; background: #fff; border: 1px solid rgba(50,193,223,.25); border-radius: 10px; padding: 7px 11px; font-size: 12.5px; color: #475569; display: flex; flex-direction: column; }
.im-plan b { color: var(--c-700); font-size: 12px; }
.im-link { color: var(--c-700); font-weight: 600; }
.im-result { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.im-result div { background: rgba(255,255,255,.6); border: 1px solid rgba(148,163,184,.25); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; }
.im-result b { font-size: 24px; }
.im-result span { font-size: 12.5px; color: #64748b; }
@media (max-width: 700px) { .im-result { grid-template-columns: repeat(2, 1fr); } }
`;
