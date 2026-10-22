// Reading sheets (CSV) and saving leads, opportunities and accounts into the CRM.
// Nothing here sends an email - it only saves data.
import { Company, Contact, STAGES, Suppression, remember, statusRank, upsertCompany } from './models.js';
import { str, validEmail } from './utils.js';

/* ---------- CSV ---------- */
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
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

/** every column as [{k, v}] - kept exactly as in the sheet */
export function cleanFields(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 80)
    .map((f) => ({ k: str(f?.k, 120), v: str(f?.v, 5000) }))
    .filter((f) => f.k && f.v);
}

/* ---------- which column is what ---------- */
// first matching rule wins; "not" stops e.g. "company_name" being taken as the person's name
const RULES = {
  email: { re: [/^(dm_)?e-?mail$/i, /^(contact|work|person).*e-?mail/i, /e-?mail(?!.*(sent|date|source|subject|body|status))/i], not: /company|sent|date|source|subject|body/i },
  name: { re: [/^(dm_)?name$/i, /^(contact|person|full|lead|dm).*name/i, /^name/i, /\bname\b/i], not: /company|brand|organi|business|file|campaign/i },
  company: { re: [/^company(_| )?name$/i, /^company$/i, /^brand(_| )?name/i, /^(company|brand|organi[sz]ation|business)/i], not: /contact|linkedin|size|url|phone/i },
  title: { re: [/^dm_title$/i, /^designation$/i, /designation/i, /^(job )?title$/i, /position/i], not: /role_title|subject|page/i },
  phone: { re: [/^(dm_)?phone$/i, /^mobile/i, /mobile|phone|whatsapp|contact no/i], not: /company contact/i },
  linkedin: { re: [/^dm_linkedin$/i, /^linkedin$/i, /^(person|contact|profile).*linkedin/i, /linkedin(?!.*(url|company|sent|connection))/i], not: /company|sent|date/i },
  website: { re: [/^website$/i, /website|domain|site url/i], not: /linkedin|job/i },
  industry: { re: [/^industry$/i, /industry|category|sector|vertical/i], not: /x/ },
  location: { re: [/^location$/i, /location|city|hq|state|country/i], not: /x/ },
  signal: { re: [/buying signal/i, /^signal$/i], not: /x/ },
  notes: { re: [/^remarks?$/i, /^notes?$/i, /remark/i], not: /evidence|lead notes/i },
  leadDate: { re: [/lead date/i, /date_added|date added/i], not: /x/ },
  sentDate: { re: [/sent date/i, /last (emailed|contacted)/i], not: /x/ },
  status: { re: [/^status$/i, /^lead status$/i, /^stage$/i], not: /x/ },
};
export function mapColumns(headers) {
  const used = new Set();
  const map = {};
  for (const [key, rule] of Object.entries(RULES)) {
    for (const re of rule.re) {
      const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(h) && !rule.not.test(h));
      if (i >= 0) { map[key] = i; used.add(i); break; }
    }
  }
  return map;
}

const none = (v) => (/^(none|n\/?a|-|null|nil|na)$/i.test(String(v || '').trim()) ? '' : String(v || '').trim());

/** "Status" text from an old sheet -> email status + pipeline stage */
export function statusFromSheet(raw, contacted) {
  const s = String(raw || '').toLowerCase();
  if (/convert|won|signed|client/.test(s)) return { status: 'replied', stage: 'account' };
  if (/^ni$|not interested|no interest|lost/.test(s)) return { status: 'unsubscribed', stage: 'cold' };
  if (/wrong|bounce|invalid/.test(s)) return { status: 'bounced', stage: 'cold' };
  if (/lead|meeting|ffu|follow|interested|call|demo|proposal/.test(s)) return { status: 'replied', stage: 'hot' };
  return { status: contacted || s ? 'contacted' : 'new', stage: 'cold' };
}

/** One sheet row -> lead object */
export function rowToLead(headers, row, map) {
  const cell = (k) => (map[k] === undefined ? '' : none(row[map[k]]));
  return {
    email: validEmail(cell('email')),
    name: cell('name'),
    company: cell('company'),
    title: cell('title'),
    phone: cell('phone'),
    linkedin: cell('linkedin'),
    website: cell('website'),
    industry: cell('industry'),
    location: cell('location'),
    signal: cell('signal'),
    notes: cell('notes'),
    leadDate: cell('leadDate'),
    sentDate: cell('sentDate'),
    sheetStatus: cell('status'),
    fields: cleanFields(headers.map((k, i) => ({ k, v: row[i] }))),
  };
}

const INFO = ['name', 'company', 'title', 'phone', 'linkedin', 'website', 'industry', 'location', 'signal', 'notes', 'leadDate'];

/**
 * Save one person. Finds them by email (or, without email, by name in the same company).
 * Existing people get their details filled / updated; their email status only ever moves forward
 * (a "replied" or "unsubscribed" person is never reset).
 */
export async function saveLead(lead, { batch = '', source = '', stage, status } = {}) {
  const email = validEmail(lead.email);
  const info = {};
  for (const k of INFO) if (str(lead[k], 5000)) info[k] = str(lead[k], k === 'notes' ? 5000 : 500);
  if (!email && !info.name && !info.company) return { skipped: true };

  const company = info.company
    ? await upsertCompany(info.company, { website: info.website, industry: info.industry, location: info.location, source, stage: stage || 'cold' })
    : null;

  let contact = email ? await Contact.findOne({ email }) : null;
  if (!contact && !email && info.name && company) contact = await Contact.findOne({ companyId: company._id, email: { $exists: false }, name: new RegExp(`^${info.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  const created = !contact;
  if (!contact) contact = new Contact({ ...(email ? { email } : {}), batch, source });
  Object.assign(contact, info);
  if (company) contact.companyId = company._id;
  const fields = cleanFields(lead.fields);
  if (fields.length) contact.fields = fields;

  // email status: never go backwards; remembered unsubscribes / bounces always win
  let next = status || contact.status || 'new';
  if (email) {
    const memory = await Suppression.findOne({ email }).lean();
    if (memory && statusRank(memory.reason) > statusRank(next)) next = memory.reason;
  }
  if (statusRank(next) > statusRank(contact.status || 'new')) contact.status = next;
  await contact.save();
  if (email && contact.status !== 'new') await remember(email, contact.status);
  return { created, contact, company };
}

/* ---------- old "Opportunity" tab (free text, no header) ---------- */
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s-]{8,}\d)/;
export function parseOpportunity(row, team = []) {
  const cells = row.map((c) => String(c || '').trim());
  const [source, a = '', b = '', notes = '', ownerCell = ''] = cells;
  const text = `${a} ${b}`;
  const email = validEmail((text.match(EMAIL_RE) || [])[0]);
  const phone = ((text.match(PHONE_RE) || [])[0] || '').trim();
  const clean = (s) => s.replace(EMAIL_RE, '').replace(PHONE_RE, '').replace(/\s*[-–,:]+\s*$/g, '').replace(/^\s*[-–,:]+\s*/g, '').replace(/\s{2,}/g, ' ').trim();
  // company: first cell unless it is only a person's contact; else the email domain
  let company = clean(a.split(/\s+-\s+/)[0] || '');
  let person = clean(b.split(/\s+-\s+/)[0] || '');
  if (!company || EMAIL_RE.test(a.split(/\s+-\s+/)[0] || '')) {
    const domain = email ? email.split('@')[1].split('.')[0] : '';
    company = domain && !/gmail|yahoo|hotmail|outlook/.test(domain) ? domain.charAt(0).toUpperCase() + domain.slice(1) : company || person;
  }
  // "Alisha Sadnani" + care@albizzia.store -> person Alisha Sadnani, company Albizzia
  const domain = email ? email.split('@')[1].split('.')[0] : '';
  const looksLikePerson = /^[A-Z][a-z]+(\s[A-Z][a-z]+){1,2}$/.test(company);
  const related = domain && company.toLowerCase().replace(/[^a-z0-9]/g, '').includes(domain.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5));
  if (domain && !/gmail|yahoo|hotmail|outlook|rediff/.test(domain) && looksLikePerson && !related) {
    if (!person) person = company;
    company = domain.charAt(0).toUpperCase() + domain.slice(1);
  }
  // "Salman- the wedding company- salman@..." style
  const parts = a.split(/\s*-\s*/).map(clean).filter(Boolean);
  if (parts.length >= 2 && !person) { person = parts[0]; company = parts[1]; }
  const ownerName = team.find((m) => new RegExp(`\\b${m}\\b`, 'i').test(ownerCell)) || '';
  const extra = cells.slice(5).filter(Boolean).join(' · ');
  return {
    company,
    person: person && person !== company ? person : '',
    email,
    phone,
    owner: ownerName,
    source: source || 'Opportunity sheet',
    notes: [notes, ownerName ? '' : ownerCell, extra].filter(Boolean).join('\n'),
    fields: cleanFields(['Source', 'Brand / Contact', 'Contact', 'Notes', 'Owner'].map((k, i) => ({ k, v: cells[i] })).concat(cells.slice(5).map((v, i) => ({ k: `Column ${i + 6}`, v })))),
  };
}

/* ---------- old "Accounts" tab: brand + campaign, one column per team member ---------- */
export function parseAccounts(rows) {
  const [head, ...body] = rows;
  const nameCol = head.findIndex((h) => /brand|campaign|account|company/i.test(h));
  const memberCols = head.map((h, i) => ({ h: h.trim(), i })).filter(({ h, i }) => i !== nameCol && h && !/^s\.?\s*no|^sno|^#|^sr/i.test(h));
  return body
    .map((r) => {
      const name = String(r[nameCol] || '').trim();
      if (!name) return null;
      const tasks = memberCols.map(({ h, i }) => ({ member: h, task: String(r[i] || '').trim() })).filter((t) => t.task);
      const pretty = name.replace(/\b\w/g, (c) => c.toUpperCase());
      return { name: pretty, tasks, fields: cleanFields(head.map((k, i) => ({ k, v: r[i] }))) };
    })
    .filter(Boolean);
}

export { STAGES, Company };
