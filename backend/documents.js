// Client documents before an Opportunity becomes an account:
//   1. Agreement – from the template (Settings), filled for the campaign, edited freely, sent as a PDF with an
//      online "Review & accept" link. The client accepts (name + designation, recorded with the time) or asks for changes.
//   2. Estimate  – only after the agreement is accepted. A unique number (EST26-27-018, 019, …; the series restarts each
//      April), the client's billing details, items, GST and the total in words. Sent as a PDF.
//   3. Payment   – the advance is asked in Needs you; the admin says when it has come.
// Nothing is ever sent on its own: every email goes when a person presses Send. Every PDF can be downloaded at any time.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { config } from './config.js';
import { getSetting, setSetting } from './models.js';

const { Schema, model } = mongoose;
const id = Schema.Types.ObjectId;
const here = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS = path.join(here, 'assets', 'docs');

/* ---------------- models ---------------- */
export const ClientDoc = model(
  'ClientDoc',
  new Schema(
    {
      company: { type: id, ref: 'Company', index: true, required: true },
      kind: { type: String, enum: ['agreement', 'estimate'], required: true },
      version: { type: Number, default: 1 },
      status: { type: String, enum: ['draft', 'sent', 'accepted', 'changes', 'replaced', 'outside'], default: 'draft', index: true },
      number: { type: String, default: '' }, // estimates: EST26-27-018 (unique)
      fields: { type: Schema.Types.Mixed, default: {} }, // agreement: the values filled into the template
      html: { type: String, default: '' }, // agreement: the document text (edited freely)
      estimate: {
        date: String, // YYYY-MM-DD
        billTo: { name: String, address: String, gst: String },
        noGst: Boolean, // the client has no GST number (unregistered)
        items: [{ _id: false, desc: String, qty: Number, rate: Number, amount: Number }],
        gstRate: { type: Number, default: 18 },
        terms: [String],
        subtotal: Number,
        gst: Number,
        total: Number,
      },
      mail: { to: String, cc: String, subject: String, body: String },
      sentAt: Date,
      sentBy: String,
      sentTo: String,
      file: { _id: false, id: String, name: String }, // the PDF as it was sent (HrFile)
      token: { type: String, index: true }, // agreement: the client's review link
      viewedAt: Date,
      accepted: { name: String, designation: String, email: String, at: Date, ip: String, agent: String },
      signedFile: { _id: false, id: String, name: String },
      changes: [{ _id: false, text: String, name: String, at: Date }],
      outside: { note: String, by: String, at: Date }, // done outside the CRM (older deals)
      by: String,
    },
    { timestamps: true }
  )
);
// one counter per estimate series (EST-26-27 …): numbers are never used twice
const Counter = model('DocCounter', new Schema({ _id: String, seq: Number }, { versionKey: false }));

/* ---------------- settings (Settings → Agreements & estimates) ---------------- */
export const AGREEMENT_TEMPLATE = `<h1>Barter Agreement</h1>
<p><b>Effective Date:</b> {{effective_date}}</p>
<p><b>Agency:</b> Geek Online Ventures Pvt. Ltd. (“Geek”)</p>
<p><b>Client:</b> {{client_name}} (“Client”)</p>
<p><b>Campaign Brand:</b> {{brand}}</p>
<h2>Scope and selection</h2>
<p>Geek shall source creators, coordinate opt-ins, brief approved creators, track deliverables, and provide a completion report. The package comprises <b>{{creators}} creator slots</b>. Geek shall present <b>no more than {{max_profiles}} distinct profiles in aggregate</b> to fill those slots, including replacement profiles. The Client shall approve the final selection. Before outreach, the parties shall confirm in writing the eligibility criteria, creator consideration, deliverables, timelines, and approval process.</p>
<p><b>Minimum % Guarantee</b> – Geek will make sure that a minimum of {{guarantee}} of all selected barter influencers complete the collaboration. We will try to get all of them to complete the collaboration, but reasons beyond anyone’s control can prevent completion, such as a health emergency, family issues, a lost courier, a non-responsive creator, or META-related issues. The Agency will also help with the brand book and coordinate returns of the product from the influencer if they are unable to complete the collaboration.</p>
<h2>Utilisation and carry-forward</h2>
<p>A slot is utilised when the creator completes the agreed deliverable or the Client expressly accepts it in writing. Where a creator withdraws or fails to deliver for reasons outside the Client’s control, Geek shall use reasonable efforts to arrange a replacement within the shortlist cap. <b>Any unutilised slots may be carried forward to a mutually agreed campaign for the same Brand within {{carry_months}} months after the original campaign closes</b>, without an additional agency fee for equivalent scope. Unutilised slots are not redeemable for cash.</p>
<h2>Agency fee and creator consideration</h2>
<p>The Client shall pay Geek an agency fee of <b>{{fee}} plus applicable GST</b>, on the following terms: {{payment_terms}}. For barter slots, the creator shall receive the agreed product or service. <b>For any slot the Client approves in writing as non-barter, the creator shall be paid {{nonbarter_payout}} upon completion of the agreed deliverable.</b> This payout is separate from the agency fee and shall be funded by the Client and disbursed by Geek, subject to applicable statutory deductions. Any additional costs or changes require prior written approval. On cancellation, the parties shall reconcile completed work and pre-approved non-recoverable costs.</p>
<h2>Content and usage rights</h2>
<p>The Client shall supply accurate, substantiated product claims and timely, consolidated feedback. Geek shall coordinate review against the agreed brief and applicable advertising disclosures. Creator opinions shall remain honest. Website use, reposting, editing, paid advertising, and whitelisting require separately agreed written usage rights and may be charged separately. Geek shall report completed deliverables and available metrics. No minimum reach, engagement, or sales are guaranteed.</p>
<h2>Confidentiality and non-circumvention</h2>
<p>Each party shall keep non-public campaign, commercial, and creator information confidential and disclose it only as necessary to perform this Agreement or as required by law. For {{noncirc_months}} months from each documented introduction, the Client shall not circumvent Geek by soliciting or engaging, directly or through another agency, affiliate or intermediary, a creator first introduced by Geek in writing for the Brand, without Geek’s prior written consent. This restriction excludes relationships the Client can document as predating the introduction.</p>
<p><b>Other costs</b> like creative ideation, scripts, printing, packaging, editing, etc. can be handled by Geek and will be charged separately on Client/Brand request.</p>
<p><b>Logistics/courier</b> of the barter hampers will be handled by Geek only and will be costed separately as it requires passing on creator’s contact information. If the Brand/Client wants to handle logistics/courier directly, then a separate fee of {{logistics_fee}} needs to be reimbursed to Geek, and a separate NDA/NCA will be required to be signed between the parties.</p>
<h2>Governing law and jurisdiction</h2>
<p>This Agreement is governed by Indian law. The parties shall first seek to resolve disputes in good faith. Unresolved disputes shall be subject to the jurisdiction of the competent courts at {{jurisdiction}}.</p>
<p>[Signatures]</p>
<h2>Annexure A</h2>
<p><b>Number of Creators:</b> {{annex_creators}}</p>
<p><b>Payment Terms:</b> {{annex_payment}}</p>
<p><b>Eligibility criteria:</b> {{annex_eligibility}}</p>
<p><b>Creator consideration:</b> {{annex_consideration}}</p>
<p><b>Deliverables:</b> {{annex_deliverables}}</p>
<p><b>Timelines:</b> {{annex_timelines}}</p>
<p><b>Approval process:</b> {{annex_approval}}</p>`;

export const DOC_DEFAULTS = {
  agreementTemplate: AGREEMENT_TEMPLATE,
  agreementFields: {
    creators: '100',
    guarantee: '80–90%',
    paymentTerms: '50% advance, 50% after the first campaign',
    nonBarterPayout: '1000',
    logisticsFee: 'INR 20,000/100 creators',
    carryMonths: '6',
    nonCircMonths: '24',
    jurisdiction: 'Bangalore',
  },
  signatory: { name: '', designation: 'Director' }, // "For Geek" on the agreement
  geek: {
    name: 'Geek Online Ventures Pvt Ltd',
    address: 'No. 33, 1st Floor, 1st Main,\nGanga Nagar, HMT Layout, CBI Main Road,\nBengaluru, Karnataka – 560032.',
    gstin: '29AADCG3170D1ZU',
    hsn: '998361/00440452',
    pan: 'AADCG3170D',
  },
  bank: 'HDFC BANK\nCurrent Account No.: 01842560003206\nIFSC Code: HDFC0000184\nINDIRANAGAR BRANCH',
  estimateTerms: ['50% Advance to be done at the earliest to start the campaign', 'All remaining payments will be done within 7 days from the date of Invoice'],
  estimatePrefix: 'EST',
  estimateStart: { '26-27': 18 }, // the next number of a series (EST26-27-017 was the last made by hand)
  advancePercent: 50,
};
// the first version of the template (before the bold phrases of the Google Doc were added): a saved copy of it is upgraded
const FIRST_TEMPLATE = ['{{creators}} creator slots', 'no more than {{max_profiles}} distinct profiles in aggregate', 'Any unutilised slots may be carried forward to a mutually agreed campaign for the same Brand within {{carry_months}} months after the original campaign closes', '{{fee}} plus applicable GST', 'For any slot the Client approves in writing as non-barter, the creator shall be paid {{nonbarter_payout}} upon completion of the agreed deliverable.', 'Other costs', 'Logistics/courier'].reduce((t, x) => t.replace(`<b>${x}</b>`, x), AGREEMENT_TEMPLATE);
export async function docSettings() {
  const s = { ...((await getSetting('docSettings', {})) || {}) };
  if (s.agreementTemplate === FIRST_TEMPLATE) delete s.agreementTemplate;
  return { ...DOC_DEFAULTS, ...s, agreementFields: { ...DOC_DEFAULTS.agreementFields, ...(s.agreementFields || {}) }, geek: { ...DOC_DEFAULTS.geek, ...(s.geek || {}) }, signatory: { ...DOC_DEFAULTS.signatory, ...(s.signatory || {}) }, estimateStart: { ...DOC_DEFAULTS.estimateStart, ...(s.estimateStart || {}) } };
}
export const saveDocSettings = (s) => setSetting('docSettings', s);

/* ---------------- small helpers ---------------- */
export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const unesc = (s = '') => String(s).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
export const inr = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
const tz = () => config.timezone || 'Asia/Kolkata';
export const ymdIst = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(d);
export const dmy = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || '');
};
const when = (d) => new Date(d).toLocaleString('en-IN', { timeZone: tz(), day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** 129800 -> "One Lakh Twenty Nine Thousand Eight Hundred Only" (Indian system) */
export function inWords(n) {
  n = Math.round(Number(n) || 0);
  if (!n) return 'Zero Only';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ` ${a[x % 10]}` : ''}`);
  const three = (x) => [Math.floor(x / 100) ? `${a[Math.floor(x / 100)]} Hundred` : '', two(x % 100)].filter(Boolean).join(' ');
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${crore >= 100 ? three(crore) : two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return `${parts.join(' ')} Only`;
}

/* ---------------- estimate numbers ---------------- */
export const financialYear = (d = new Date()) => {
  const [y, m] = ymdIst(d).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
};
/** the next number of the series, without using it (shown on a draft) */
export async function peekEstimateNumber() {
  const st = await docSettings();
  const fy = financialYear();
  const c = await Counter.findById(`${st.estimatePrefix}-${fy}`).lean();
  const next = c ? c.seq + 1 : Number(st.estimateStart?.[fy]) || 1;
  return `${st.estimatePrefix}${fy}-${String(next).padStart(3, '0')}`;
}
/** take the next number for good (atomic: two people at once never get the same one) */
export async function takeEstimateNumber() {
  const st = await docSettings();
  const fy = financialYear();
  const key = `${st.estimatePrefix}-${fy}`;
  const start = Number(st.estimateStart?.[fy]) || 1;
  await Counter.updateOne({ _id: key }, { $setOnInsert: { seq: start - 1 } }, { upsert: true });
  const c = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true }).lean();
  return `${st.estimatePrefix}${fy}-${String(c.seq).padStart(3, '0')}`;
}
/** a draft that is deleted gives its number back, but only if it was the last one taken (so no gaps) */
export async function giveBackEstimateNumber(number) {
  const m = String(number || '').match(/^(.*?)(\d{2}-\d{2})-(\d+)$/);
  if (!m) return;
  await Counter.updateOne({ _id: `${m[1]}-${m[2]}`, seq: Number(m[3]) }, { $inc: { seq: -1 } });
}

/* ---------------- the agreement text ---------------- */
const FIELD_KEYS = {
  effective_date: (f) => dmy(f.effectiveDate),
  client_name: (f) => f.clientName,
  brand: (f) => f.brand,
  creators: (f) => f.creators,
  max_profiles: (f) => f.maxProfiles,
  guarantee: (f) => f.guarantee,
  fee: (f) => (f.fee ? `₹\u00A0${inr(f.fee)}` : ''), // a no-break space keeps ₹ with the number
  payment_terms: (f) => f.paymentTerms,
  nonbarter_payout: (f) => (f.nonBarterPayout ? `₹${inr(f.nonBarterPayout)}` : ''),
  logistics_fee: (f) => f.logisticsFee,
  carry_months: (f) => f.carryMonths,
  noncirc_months: (f) => f.nonCircMonths,
  jurisdiction: (f) => f.jurisdiction,
  annex_creators: (f) => f.annexCreators,
  annex_payment: (f) => f.annexPayment,
  annex_eligibility: (f) => f.annexEligibility,
  annex_consideration: (f) => f.annexConsideration,
  annex_deliverables: (f) => f.annexDeliverables,
  annex_timelines: (f) => f.annexTimelines,
  annex_approval: (f) => f.annexApproval,
};
/** the template with the campaign's values (an empty value stays as a visible blank to fill) */
export function fillTemplate(template, fields = {}) {
  return String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => {
    if (!FIELD_KEYS[k]) return m;
    const v = String(FIELD_KEYS[k](fields) ?? '').trim();
    // marked with the field's key, so a change on the left updates this spot in the editor right away
    return `<span data-f="${k}">${v ? esc(v).replace(/\n/g, '<br>') : '__________'}</span>`;
  });
}

/** the document HTML, kept to a safe set of tags (from the editor) */
const ALLOWED = new Set(['p', 'h1', 'h2', 'h3', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'br']);
export function cleanHtml(html) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<\s*(\/?)\s*([a-zA-Z0-9]+)[^>]*>|([^<]+)/g;
  let m;
  const spans = []; // only the field marks (<span data-f="fee">) are kept; other spans the browser adds are dropped
  const src = String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').slice(0, 200000);
  while ((m = re.exec(src))) {
    if (m[3] !== undefined) out.push(esc(unesc(m[3])));
    else if (m[2]) {
      let tag = m[2].toLowerCase();
      if (tag === 'span') {
        if (m[1]) {
          if (spans.pop()) out.push('</span>');
        } else {
          const f = m[0].match(/data-f\s*=\s*["']?([a-z_]+)/);
          spans.push(!!f);
          if (f) out.push(`<span data-f="${f[1]}">`);
        }
        continue;
      }
      if (tag === 'div') tag = 'p';
      if (!ALLOWED.has(tag)) continue;
      if (tag === 'br') out.push('<br>');
      else out.push(m[1] ? `</${tag}>` : `<${tag}>`);
    }
  }
  while (spans.length) if (spans.pop()) out.push('</span>');
  return out.join('').replace(/<p>\s*<\/p>/g, '').trim();
}

/** HTML -> blocks for the PDF: { type: 'p'|'h1'|'h2'|'h3'|'li', ordered, n, runs: [{ text, b, i, u }] } */
export function toBlocks(html) {
  const blocks = [];
  const re = /<\s*(\/?)\s*([a-z0-9]+)\s*>|([^<]+)/g;
  let cur = null;
  const style = { b: 0, i: 0, u: 0 };
  const lists = [];
  const open = (type) => {
    if (cur && cur.runs.some((r) => r.text.trim())) blocks.push(cur);
    const l = lists[lists.length - 1];
    cur = { type, runs: [], ...(type === 'li' ? { ordered: l?.ordered, n: l ? ++l.n : 1, depth: lists.length } : {}) };
  };
  const close = () => {
    if (cur && cur.runs.some((r) => r.text.trim())) blocks.push(cur);
    cur = null;
  };
  let m;
  const src = String(html || '').replace(/<\/?span\b[^>]*>/gi, ''); // field marks are for the editor only
  while ((m = re.exec(src))) {
    if (m[3] !== undefined) {
      const text = unesc(m[3]).replace(/\s+/g, ' ');
      if (!text.trim() && !cur) continue;
      if (!cur) open('p');
      cur.runs.push({ text, b: style.b > 0, i: style.i > 0, u: style.u > 0 });
      continue;
    }
    const end = Boolean(m[1]);
    const tag = m[2];
    if (['b', 'strong'].includes(tag)) style.b += end ? -1 : 1;
    else if (['i', 'em'].includes(tag)) style.i += end ? -1 : 1;
    else if (tag === 'u') style.u += end ? -1 : 1;
    else if (tag === 'br') {
      if (!cur) open('p');
      cur.runs.push({ text: '\n', b: false, i: false, u: false });
    } else if (['p', 'h1', 'h2', 'h3', 'li'].includes(tag)) end ? close() : open(tag);
    else if (tag === 'ul' || tag === 'ol') {
      if (end) {
        close();
        lists.pop();
      } else {
        close();
        lists.push({ ordered: tag === 'ol', n: 0 });
      }
    }
  }
  close();
  for (const b of blocks) {
    b.runs = b.runs.filter((r) => r.text);
    while (b.runs.length && b.runs[b.runs.length - 1].text === '\n') b.runs.pop(); // the browser leaves a <br> at the end
    while (b.runs.length && b.runs[0].text === '\n') b.runs.shift();
    if (b.runs.length) {
      b.runs[0].text = b.runs[0].text.replace(/^ +/, '');
      b.runs[b.runs.length - 1].text = b.runs[b.runs.length - 1].text.replace(/ +$/, '');
    }
  }
  return blocks;
}

/* ---------------- PDF ---------------- */
let PDFDocument;
async function pdfkit() {
  if (PDFDocument) return PDFDocument;
  try {
    PDFDocument = (await import('pdfkit')).default;
  } catch {
    throw Object.assign(new Error('PDFs cannot be made yet: run "npm install" in the backend folder (the pdfkit package is missing).'), { status: 500 });
  }
  return PDFDocument;
}
const FONT = {
  r: path.join(ASSETS, 'LiberationSans-Regular.ttf'),
  b: path.join(ASSETS, 'LiberationSans-Bold.ttf'),
  i: path.join(ASSETS, 'LiberationSans-Italic.ttf'),
  bi: path.join(ASSETS, 'LiberationSans-BoldItalic.ttf'),
}; // Liberation Sans (looks like Arial) with the ₹ sign added
async function newDoc(title) {
  const PDF = await pdfkit();
  const doc = new PDF({ size: 'A4', margins: { top: 50, bottom: 60, left: 56, right: 56 }, bufferPages: true, info: { Title: title, Author: 'Geek Online Ventures Pvt Ltd' } });
  for (const [k, f] of Object.entries(FONT)) doc.registerFont(k, f);
  return doc;
}
const done = (doc) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
const fontOf = (r) => (r.b && r.i ? 'bi' : r.b ? 'b' : r.i ? 'i' : 'r');
/** one paragraph of styled runs, wrapped in the given width */
function runs(doc, list, opts = {}) {
  // a line break (<br>) starts a new line in the same paragraph: each line is drawn on its own
  const lines = [[]];
  for (const r of list)
    String(r.text || '')
      .split('\n')
      .forEach((t, i) => {
        if (i) lines.push([]);
        if (t) lines[lines.length - 1].push({ ...r, text: t });
      });
  if (lines.length === 1) return runLine(doc, list, opts);
  lines.forEach((line, i) => {
    if (!line.length) return doc.moveDown(0.6);
    // a line that ends with a break is not stretched to the full width
    runLine(doc, line, { ...opts, align: i < lines.length - 1 && opts.align === 'justify' ? 'left' : opts.align });
  });
}
function runLine(doc, list, { size = 10.5, x, width, align = 'left', lineGap = 3, color = '#1f2328' } = {}) {
  const parts = list.filter((r) => r.text).map((r) => ({ ...r, text: String(r.text) }));
  // a space at the start of a run is moved to the end of the run before it (it would be dropped); a line break stays
  for (let i = 1; i < parts.length; i++)
    if (/^[ \t]/.test(parts[i].text) && !parts[i - 1].text.endsWith('\n')) {
      parts[i - 1].text = `${parts[i - 1].text.replace(/[ \t]+$/, '')} `;
      parts[i].text = parts[i].text.replace(/^[ \t]+/, '');
    }
  const list2 = parts.filter((p) => p.text);
  if (!list2.length) return;
  doc.fillColor(color);
  list2.forEach((p, i, parts) => {
    doc.font(fontOf(p)).fontSize(size);
    const opts = { continued: i < parts.length - 1, underline: Boolean(p.u), align, lineGap };
    if (i === 0) doc.text(p.text, x ?? doc.page.margins.left, doc.y, { ...opts, width: width ?? doc.page.width - doc.page.margins.left - doc.page.margins.right });
    else doc.text(p.text, opts);
  });
}
async function exists(f) {
  try {
    await fs.access(f);
    return true;
  } catch {
    return false;
  }
}
function footer(doc, left) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 38;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // write in the margin without making a new page
    doc.font('r').fontSize(8).fillColor('#8a94a6');
    doc.text(left, doc.page.margins.left, y, { width: 360, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, doc.page.width - doc.page.margins.right - 120, y, { width: 120, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

/** the agreement PDF (accepted: the client's acceptance is written in their signature block) */
export async function agreementPdf(d, company) {
  const st = await docSettings();
  const f = d.fields || {};
  const doc = await newDoc(`Agreement – ${f.brand || company?.name || ''}`);
  const W = doc.page.width - 112;
  if (await exists(path.join(ASSETS, 'logo.png'))) doc.image(path.join(ASSETS, 'logo.png'), (doc.page.width - 96) / 2, 40, { width: 96 });
  doc.y = 88;
  for (const b of toBlocks(d.html)) {
    const text = b.runs.map((r) => r.text).join('').trim();
    if (b.type === 'p' && text === '[Signatures]') {
      signatures(doc, d, st, company, W);
      continue;
    }
    if (doc.y > doc.page.height - 120 && b.type !== 'p' && b.type !== 'li') doc.addPage();
    if (b.type === 'h1') {
      doc.moveDown(0.2);
      runs(doc, b.runs.map((r) => ({ ...r, b: true })), { size: 17, align: 'center' });
      doc.moveDown(0.8);
    } else if (b.type === 'h2' || b.type === 'h3') {
      doc.moveDown(0.5);
      runs(doc, b.runs.map((r) => ({ ...r, b: true })), { size: b.type === 'h2' ? 12 : 11 });
      doc.moveDown(0.25);
    } else if (b.type === 'li') {
      const indent = 14 * (b.depth || 1);
      const y = doc.y;
      doc.font('r').fontSize(10.5).fillColor('#1f2328').text(b.ordered ? `${b.n}.` : '•', doc.page.margins.left + indent - 12, y, { width: 14, lineBreak: false });
      doc.y = y;
      runs(doc, b.runs, { x: doc.page.margins.left + indent + 4, width: W - indent - 4 });
      doc.moveDown(0.2);
    } else {
      runs(doc, b.runs, { align: 'justify' });
      doc.moveDown(0.55);
    }
  }
  footer(doc, `Geek Online Ventures Pvt. Ltd. · Agreement · ${f.brand || company?.name || ''}${d.version > 1 ? ` · version ${d.version}` : ''}`);
  return done(doc);
}

function signatures(doc, d, st, company, W) {
  const f = d.fields || {};
  if (doc.y > doc.page.height - 230) doc.addPage();
  doc.moveDown(0.8);
  const top = doc.y;
  const colW = (W - 30) / 2;
  const L = doc.page.margins.left;
  const R = L + colW + 30;
  // Geek
  doc.font('b').fontSize(10.5).fillColor('#1f2328').text('For Geek:', L, top, { width: colW });
  const sig = path.join(ASSETS, 'signature.png');
  doc.image(sig, L, top + 18, { width: 170 });
  let y = top + 18 + 170 * (242 / 803) + 6;
  doc.font('r').fontSize(10).text(['Geek Online Ventures Pvt. Ltd.', [st.signatory.name, st.signatory.designation].filter(Boolean).join(', '), `Date: ${dmy(f.effectiveDate)}`].filter(Boolean).join('\n'), L, y, { width: colW, lineGap: 2 });
  const leftEnd = doc.y;
  // the client
  doc.font('b').fontSize(10.5).text('For the Client:', R, top, { width: colW });
  doc.font('r').fontSize(10).text(f.clientName || company?.name || '', R, top + 16, { width: colW });
  if (d.accepted?.at) {
    y = doc.y + 8;
    doc.roundedRect(R, y, colW, 74, 6).fillAndStroke('#ecfdf3', '#86efac');
    doc.fillColor('#14532d').font('b').fontSize(10).text('Accepted electronically', R + 10, y + 8, { width: colW - 20 });
    doc.font('r').fontSize(9.5).text(`${d.accepted.name}${d.accepted.designation ? `, ${d.accepted.designation}` : ''}\n${when(d.accepted.at)} (IST)${d.accepted.email ? `\n${d.accepted.email}` : ''}`, R + 10, doc.y + 2, { width: colW - 20, lineGap: 1.5 });
    doc.fillColor('#1f2328');
  } else {
    y = doc.y + 34;
    doc.moveTo(R, y).lineTo(R + colW - 10, y).strokeColor('#9aa4b2').lineWidth(0.8).stroke();
    doc.font('r').fontSize(9.5).fillColor('#5b6573').text('Name, designation and date', R, y + 5, { width: colW });
    doc.fillColor('#1f2328');
  }
  doc.y = Math.max(leftEnd, doc.y) + 18;
  doc.x = L;
}

/** the estimate PDF – the same layout as the estimates made by hand */
export async function estimatePdf(d) {
  const st = await docSettings();
  const e = d.estimate || {};
  const doc = await newDoc(`Estimate ${d.number}`);
  const L = 56;
  const W = doc.page.width - 112;
  if (await exists(path.join(ASSETS, 'logo.png'))) doc.image(path.join(ASSETS, 'logo.png'), (doc.page.width - 110) / 2, 40, { width: 110 });
  doc.font('r').fontSize(17).fillColor('#1f2328').text('ESTIMATE', L, 92, { width: W, align: 'center' });
  doc.font('b').fontSize(10.5).text(d.number || '', L, 96, { width: W - 10, align: 'right' });
  doc.font('r').fontSize(10).text(`Estimate Date :${dmy(e.date)}`, L, 112, { width: W - 10, align: 'right' });
  // Geek
  doc.y = 132;
  doc.font('b').fontSize(10.5).text(st.geek.name, L, doc.y);
  doc.font('r').fontSize(10).text([st.geek.address, st.geek.gstin && `GSTIN ${st.geek.gstin}`, st.geek.hsn && `HSN/ SAC code - ${st.geek.hsn}`, st.geek.pan && `PAN NO - ${st.geek.pan}`].filter(Boolean).join('\n'), { lineGap: 1.5 });
  // Bill to
  doc.moveDown(1.2);
  doc.font('r').fontSize(10).text('Bill To');
  doc.moveDown(0.6);
  doc.font('b').fontSize(10.5).text(e.billTo?.name || '');
  doc.font('r').fontSize(10).text([e.billTo?.address, e.billTo?.gst && `GST - ${e.billTo.gst}`].filter(Boolean).join('\n'), { lineGap: 1.5 });
  // items
  doc.moveDown(1.2);
  const cols = [
    { k: '#', w: 28, a: 'left' },
    { k: 'Description', w: 212, a: 'left' },
    { k: 'Qty', w: 44, a: 'left' },
    { k: 'Rate', w: 50, a: 'left' },
    { k: 'GST', w: 44, a: 'left' },
    { k: 'Amount', w: W - 378, a: 'right' },
  ];
  let y = doc.y;
  const row = (cells, { head = false, h = 22 } = {}) => {
    let x = L;
    const height = Math.max(h, ...cells.map((c, i) => doc.font(head ? 'b' : 'r').fontSize(10).heightOfString(String(c ?? ''), { width: cols[i].w - 10 }) + 10));
    if (y + height > doc.page.height - 80) {
      doc.addPage();
      y = 50;
    }
    if (head) doc.rect(L, y, W, height).fill('#5f5f5f');
    cells.forEach((c, i) => {
      doc.rect(x, y, cols[i].w, height).lineWidth(0.8).strokeColor('#1f2328').stroke();
      const isHeadDesc = head && i === 1;
      doc.font(head ? 'b' : 'r').fontSize(10).fillColor(head ? '#ffffff' : '#1f2328').text(String(c ?? ''), x + 5, y + 6, { width: cols[i].w - 10, align: isHeadDesc ? 'center' : head && i === 5 ? 'center' : cols[i].a });
      x += cols[i].w;
    });
    y += height;
  };
  row(cols.map((c) => c.k), { head: true, h: 24 });
  (e.items || []).forEach((it, i) => row([i + 1, it.desc, it.qty || '', it.rate ? inr(it.rate) : '', '', inr(it.amount)]));
  row(['', '', '', '', `${e.gstRate ?? 18}%`, inr(e.gst)]);
  // total
  y += 24;
  doc.font('b').fontSize(10.5).fillColor('#1f2328').text('Total', L + W - 250, y, { width: 100, lineBreak: false });
  doc.text(`₹ ${inr(e.total)}`, L + W - 160, y, { width: 160, align: 'right', lineBreak: false });
  y += 32;
  doc.font('b').fontSize(10).text('Total In Words', L + W - 250, y, { width: 250, continued: true }).font('r').text(`: ${inWords(e.total)}`);
  // terms
  doc.moveDown(2);
  doc.font('b').fontSize(10.5).fillColor('#1f2328').text('Terms & Conditions', L, doc.y, { width: W });
  doc.moveDown(0.6);
  for (const t of (e.terms || []).filter((x) => String(x).trim())) {
    const ty = doc.y;
    doc.font('r').fontSize(10).text('-', L + 30, ty, { width: 10, lineBreak: false });
    doc.text(String(t), L + 54, ty, { width: W - 60 });
  }
  doc.moveDown(1.4);
  doc.font('b').fontSize(10.5).text('Bank Details', L, doc.y, { continued: true }).font('r').text(' :');
  doc.moveDown(0.6);
  doc.font('r').fontSize(10).text(st.bank, L, doc.y, { width: W, lineGap: 1.5 });
  doc.moveDown(1.2);
  doc.text('Looking forward for your business', L, doc.y, { width: W });
  if (doc.y > doc.page.height - 150) doc.addPage();
  doc.moveDown(0.8);
  doc.image(path.join(ASSETS, 'signature.png'), L + 20, doc.y, { width: 165 });
  doc.y += 165 * (242 / 803) + 6;
  doc.font('b').fontSize(10.5).text('Authorized Signature', L + 16, doc.y);
  footer(doc, `Geek Online Ventures Pvt Ltd · Estimate ${d.number}`);
  return done(doc);
}

/** the totals of an estimate (amount = qty × rate, or the amount typed when there is no qty) */
export function estimateTotals(e) {
  const items = (e.items || [])
    .map((it) => {
      const qty = Number(it.qty) || 0;
      const rate = Number(String(it.rate ?? '').replace(/[,₹\s]/g, '')) || 0;
      const typed = Number(String(it.amount ?? '').replace(/[,₹\s]/g, '')) || 0;
      const amount = Math.round((qty && rate ? qty * rate : typed || rate) * 100) / 100;
      return { desc: String(it.desc || '').trim().slice(0, 300), qty: qty || undefined, rate: rate || undefined, amount };
    })
    .filter((it) => it.desc || it.amount);
  const subtotal = items.reduce((n, it) => n + it.amount, 0);
  const gstRate = Number.isFinite(Number(e.gstRate)) ? Number(e.gstRate) : 18;
  const gst = Math.round(subtotal * gstRate) / 100;
  return { items, subtotal, gstRate, gst, total: Math.round((subtotal + gst) * 100) / 100 };
}

export const newToken = () => crypto.randomBytes(24).toString('base64url');
export const fileName = (d, company) =>
  d.kind === 'estimate' ? `${d.number || 'Estimate'} – ${company?.name || 'Client'}.pdf` : `Agreement – Geek x ${d.fields?.brand || company?.name || 'Client'}${d.version > 1 ? ` (v${d.version})` : ''}${d.accepted?.at ? ' – accepted' : ''}.pdf`;
