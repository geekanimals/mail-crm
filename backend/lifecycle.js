// Client lifecycle after a lead: who does what, and the automatic hand-off from one person to the next.
//   Hot lead      -> Aanchal: reply and book a meeting
//   Opportunity   -> Aanchal: send the proposal and get the contract signed
//   Account (deal)-> estimate -> PO -> 50% advance (Aanchal) -> execution -> report (Manvi)
//                 -> full payment (Aanchal) -> case study (Bhargav) -> YouTube / Instagram / LinkedIn / SEO / playlist (Atul)
// Each step is a task in the owner's task list (Employee portal). Finishing a step needs its proof, then the
// next step's task is made for the next owner. The admin picks the owner of every step and can reassign tasks.
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { Company, Contact, User, getSetting, onStageChange, setSetting } from './models.js';
import { HrFile, HrTask } from './hr-models.js';
import { escapeHtml, sendPlain } from './mail.js';
import { addDays } from './hr-calc.js';
import { today } from './hr-util.js';
import { UPLOAD_DIR } from './routes/files.js';
import { fail } from './utils.js';

const { Schema, model } = mongoose;
const id = Schema.Types.ObjectId;

/* ---------------- the steps ---------------- */
// key, label, default owner (by first name), days to finish, what the task asks for
export const STEPS = [
  { key: 'meeting', label: 'Reply and book a meeting', who: 'Aanchal', days: 2, sales: true, ask: 'Answer the reply, book a meeting and add the notes. Moving the company to Opportunity finishes this task.' },
  { key: 'contract', label: 'Proposal and contract', who: 'Aanchal', days: 7, sales: true, ask: 'Send the proposal and get the contract signed. Converting the company to an account finishes this task.' },
  { key: 'estimate', label: 'Estimate', who: 'Aanchal', days: 2, ask: 'Upload the estimate (PDF) with its amount. It is emailed to the client.' },
  { key: 'po', label: 'Purchase order', who: 'Aanchal', days: 5, ask: "Upload the client's PO with its number." },
  { key: 'advance', label: '50% advance', who: 'Aanchal', days: 7, ask: 'Upload the advance invoice (it is emailed to the client), then mark the payment received.' },
  { key: 'execution', label: 'Execution', who: 'Manvi', days: 14, ask: 'Add the deliverables and tick each one when it is done.' },
  { key: 'report', label: 'Report', who: 'Manvi', days: 3, ask: 'Add the results and the report file or link. It is emailed to the client.' },
  { key: 'final', label: 'Full payment', who: 'Aanchal', days: 7, ask: 'Upload the final invoice (it is emailed to the client), then mark the payment received.' },
  { key: 'case_study', label: 'Case study', who: 'Bhargav', days: 5, ask: 'Publish the case study on the website and add its link.' },
  { key: 'content', label: 'Content posts', who: 'Atul', days: 7, ask: 'Post on every channel and add each link.' },
];
export const STEP = Object.fromEntries(STEPS.map((s) => [s.key, s]));
export const DEAL_STEPS = STEPS.filter((s) => !s.sales).map((s) => s.key);
export const CHANNELS = [
  ['youtube', 'YouTube video'],
  ['playlist', 'YouTube playlist'],
  ['instagram', 'Instagram post'],
  ['linkedin', 'LinkedIn post'],
  ['seo', 'SEO blog'],
];

/* ---------------- the deal (one per account project) ---------------- */
const fileRef = new Schema({ id: String, name: String, size: Number, type: { type: String } }, { _id: false }); // 'type' needs the long form
export const Deal = model(
  'Deal',
  new Schema(
    {
      company: { type: id, ref: 'Company', required: true, index: true },
      title: { type: String, default: '' },
      step: { type: String, default: 'estimate', index: true }, // current step key, or 'complete'
      value: { type: Number, default: 0 }, // from the estimate
      clientEmail: { type: String, default: '' }, // where estimates, invoices and reports go
      documents: [
        {
          kind: { type: String, enum: ['contract', 'estimate', 'po', 'invoice_advance', 'invoice_final', 'report', 'other'] },
          name: String,
          number: { type: String, default: '' },
          amount: { type: Number, default: 0 },
          file: fileRef,
          link: { type: String, default: '' },
          note: { type: String, default: '' },
          emailedTo: { type: String, default: '' },
          emailedAt: Date,
          by: String,
          at: { type: Date, default: () => new Date() },
        },
      ],
      payments: [{ kind: { type: String, enum: ['advance', 'final'] }, amount: Number, date: String, reference: String, by: String, at: { type: Date, default: () => new Date() } }],
      deliverables: [{ text: String, done: { type: Boolean, default: false }, doneAt: Date }],
      report: { text: { type: String, default: '' }, link: { type: String, default: '' } },
      caseStudyLink: { type: String, default: '' },
      content: [{ _id: false, channel: String, link: { type: String, default: '' }, at: Date }],
      timeline: [{ at: { type: Date, default: () => new Date() }, by: String, text: String }],
      completedAt: Date,
    },
    { timestamps: true }
  )
);

/* ---------------- step owners (set by the admin) ---------------- */
export async function stepOwners() {
  const saved = (await getSetting('stepOwners', {})) || {};
  const team = await User.find({ role: 'team', active: true }).select('name').lean();
  const byFirst = (n) => team.find((u) => u.name.split(/\s+/)[0].toLowerCase() === n.toLowerCase());
  const out = {};
  for (const s of STEPS) {
    const pick = saved[s.key] && team.find((u) => String(u._id) === String(saved[s.key]));
    const u = pick || byFirst(s.who);
    out[s.key] = u ? { _id: String(u._id), name: u.name } : null;
  }
  return out;
}
export async function saveStepOwners(map) {
  const team = new Set((await User.find({ role: 'team', active: true }).select('_id').lean()).map((u) => String(u._id)));
  const clean = {};
  for (const s of STEPS) if (map?.[s.key] && team.has(String(map[s.key]))) clean[s.key] = String(map[s.key]);
  await setSetting('stepOwners', clean);
  return stepOwners();
}
/** step days (admin can change them) */
export async function stepDays() {
  const saved = (await getSetting('stepDays', {})) || {};
  return Object.fromEntries(STEPS.map((s) => [s.key, Number(saved[s.key]) > 0 ? Number(saved[s.key]) : s.days]));
}
export async function saveStepDays(map) {
  const clean = {};
  for (const s of STEPS) {
    const n = Math.round(Number(map?.[s.key]));
    if (n >= 1 && n <= 90) clean[s.key] = n;
  }
  await setSetting('stepDays', clean);
  return stepDays();
}

/* ---------------- tasks ---------------- */
const note = (deal, by, text) => deal.timeline.push({ at: new Date(), by, text });

/** make the task of a step for its owner (once - an open task for the same step is kept) */
async function openTask({ step, company, deal }) {
  const s = STEP[step];
  const open = await HrTask.findOne({ step, company: company._id, ...(deal ? { deal: deal._id } : {}), status: { $ne: 'done' } });
  if (open) return open;
  const owner = (await stepOwners())[step];
  if (!owner) return null; // nobody set for this step yet: the admin sees it as "No owner" on the deal page
  const days = (await stepDays())[step];
  return HrTask.create({
    user: owner._id,
    title: `${s.label} – ${company.name}`,
    details: s.ask,
    due: addDays(today(), days),
    priority: s.sales ? 'high' : 'normal',
    step,
    company: company._id,
    deal: deal?._id,
  });
}

/** close the open task(s) of a step */
const closeTask = (filter) => HrTask.updateMany({ ...filter, status: { $ne: 'done' } }, { $set: { status: 'done', doneAt: new Date() } });

/** a deal moves to its next step: close this task, open the next one */
async function advance(deal, by) {
  const i = DEAL_STEPS.indexOf(deal.step);
  await closeTask({ deal: deal._id, step: deal.step });
  const next = DEAL_STEPS[i + 1];
  const company = await Company.findById(deal.company);
  note(deal, by, `${STEP[deal.step].label} done`);
  if (!next) {
    deal.step = 'complete';
    deal.completedAt = new Date();
    note(deal, 'CRM', 'Project complete – the company is now an old client');
    await deal.save();
    if (company) await Company.updateOne({ _id: company._id }, { $set: { stage: 'old_client' } });
    return deal;
  }
  deal.step = next;
  const t = company && (await openTask({ step: next, company, deal }));
  note(deal, 'CRM', t ? `${STEP[next].label} task given to ${(await User.findById(t.user).select('name').lean())?.name}` : `${STEP[next].label}: no owner set – choose one under Step owners`);
  await deal.save();
  return deal;
}

/** where the client's documents go: the deal's email, else the client login, else the first contact */
async function clientEmailFor(deal) {
  if (deal.clientEmail) return deal.clientEmail;
  const u = await User.findOne({ role: 'client', companyId: deal.company }).select('email').lean();
  if (u?.email) return u.email;
  const c = await Contact.findOne({ companyId: deal.company, email: { $type: 'string' }, status: { $nin: ['bounced'] } }).sort({ repliedAt: -1 }).select('email').lean();
  return c?.email || '';
}

/** email a document (file attached) to the client */
async function emailDocument(deal, doc, { subject, intro }) {
  const to = await clientEmailFor(deal);
  if (!to) throw fail(400, 'There is no client email for this deal. Add it on the deal page first.');
  const company = await Company.findById(deal.company).select('name').lean();
  const attachments = [];
  if (doc.file?.id) {
    const f = await HrFile.findById(doc.file.id).lean();
    if (f) attachments.push({ filename: f.name, content: await fs.readFile(path.join(UPLOAD_DIR, path.basename(f.path))) });
  }
  const lines = [intro, doc.number && `Number: ${doc.number}`, doc.amount && `Amount: ₹${new Intl.NumberFormat('en-IN').format(doc.amount)}`, doc.link && `Link: ${doc.link}`, doc.note].filter(Boolean);
  await sendPlain({
    to,
    subject: subject.replace('{company}', company?.name || ''),
    text: `Hello,\n\n${lines.join('\n')}\n\nRegards,\nGeek Creative Agency`,
    html: `<p>Hello,</p>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}<p>Regards,<br>Geek Creative Agency</p>`,
    attachments,
  });
  doc.emailedTo = to;
  doc.emailedAt = new Date();
  return to;
}

/* ---------------- start a deal (company converted to an account) ---------------- */
export async function startDeal(company, { by = 'Admin', contract } = {}) {
  let deal = await Deal.findOne({ company: company._id, step: { $ne: 'complete' } });
  if (!deal) {
    deal = new Deal({ company: company._id, title: company.name, step: 'estimate' });
    note(deal, by, 'Contract signed – the company is now an account');
  }
  if (contract?.id) deal.documents.push({ kind: 'contract', name: 'Signed contract', file: contract, by });
  await closeTask({ company: company._id, step: { $in: ['meeting', 'contract'] } });
  await deal.save();
  const t = await openTask({ step: deal.step, company, deal });
  note(deal, 'CRM', t ? `${STEP[deal.step].label} task given to ${(await User.findById(t.user).select('name').lean())?.name}` : `${STEP[deal.step].label}: no owner set – choose one under Step owners`);
  await deal.save();
  return deal;
}

/* ---------------- sales steps follow the company's stage ---------------- */
onStageChange.push(async (company, from, to) => {
  try {
    if (to === 'hot') await openTask({ step: 'meeting', company });
    if (to === 'opportunity') {
      await closeTask({ company: company._id, step: 'meeting' });
      await openTask({ step: 'contract', company });
    }
    if (to === 'account') await startDeal(company, { by: 'CRM' });
    if (['cold'].includes(to)) await closeTask({ company: company._id, step: { $in: ['meeting', 'contract'] } });
  } catch (e) {
    console.error('[lifecycle] stage hook failed:', e.message);
  }
});

/* ---------------- who may work on a deal ---------------- */
export async function canWork(req, deal) {
  if (req.role === 'admin') return true;
  if (req.role !== 'team') return false;
  return Boolean(await HrTask.exists({ deal: deal._id, user: req.account._id }));
}
/** the current step may be done by the admin or the person who has its open task */
async function mustOwnStep(req, deal, step) {
  if (deal.step !== step) throw fail(400, `This deal is at "${STEP[deal.step]?.label || 'Complete'}", not "${STEP[step]?.label}"`);
  if (req.role === 'admin') return;
  const t = await HrTask.exists({ deal: deal._id, step, user: req.account._id, status: { $ne: 'done' } });
  if (!t) throw fail(403, 'This step is assigned to someone else');
}

const money = (v) => {
  const n = Math.round(Number(String(v ?? '').replace(/[,₹\s]/g, '')) * 100) / 100;
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const linkOk = (v) => /^https?:\/\/\S+\.\S+/i.test(String(v || '').trim());
const isDayStr = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/** the file handed in must belong to this deal (uploaded for it) */
async function dealFile(deal, f) {
  const fid = typeof f === 'object' ? f?.id : f;
  if (!mongoose.isValidObjectId(fid)) return null;
  const r = await HrFile.findOne({ _id: fid, owner: deal._id }).lean();
  return r ? { id: String(r._id), name: r.name, size: r.size, type: r.type } : null;
}

/* ---------------- step actions ---------------- */
// body.action decides what happens. Returns the saved deal.
export async function stepAction(req, deal, step, body = {}) {
  const by = req.user;
  const action = String(body.action || '');
  await mustOwnStep(req, deal, step);
  const text = (v, n = 2000) => String(v ?? '').trim().slice(0, n);

  if (step === 'estimate') {
    const file = await dealFile(deal, body.file);
    const amount = money(body.amount);
    if (!file) throw fail(400, 'Upload the estimate file');
    if (!amount) throw fail(400, 'Enter the estimate amount');
    if (body.clientEmail) deal.clientEmail = text(body.clientEmail, 200).toLowerCase();
    const doc = deal.documents.create({ kind: 'estimate', name: file.name, number: text(body.number, 60), amount, file, note: text(body.note), by });
    const to = await emailDocument(deal, doc, { subject: 'Estimate from Geek Creative Agency – {company}', intro: 'Please find our estimate attached.' });
    deal.documents.push(doc);
    deal.value = amount;
    note(deal, by, `Estimate of ₹${amount} emailed to ${to}`);
    return advance(deal, by);
  }

  if (step === 'po') {
    const file = await dealFile(deal, body.file);
    const number = text(body.number, 80);
    if (!number) throw fail(400, 'Enter the PO number');
    if (!file) throw fail(400, 'Upload the PO file');
    deal.documents.push({ kind: 'po', name: file.name, number, amount: money(body.amount), file, by });
    note(deal, by, `PO ${number} saved`);
    return advance(deal, by);
  }

  if (step === 'advance' || step === 'final') {
    const kind = step === 'advance' ? 'invoice_advance' : 'invoice_final';
    const label = step === 'advance' ? 'advance' : 'final';
    if (action === 'invoice') {
      const file = await dealFile(deal, body.file);
      const amount = money(body.amount);
      if (!file) throw fail(400, 'Upload the invoice file');
      if (!amount) throw fail(400, 'Enter the invoice amount');
      const doc = deal.documents.create({ kind, name: file.name, number: text(body.number, 60), amount, file, by });
      const to = await emailDocument(deal, doc, {
        subject: `${step === 'advance' ? 'Advance invoice' : 'Invoice'} from Geek Creative Agency – {company}`,
        intro: step === 'advance' ? 'Please find the advance invoice attached.' : 'Please find the final invoice attached.',
      });
      deal.documents.push(doc);
      note(deal, by, `${step === 'advance' ? 'Advance' : 'Final'} invoice of ₹${amount} emailed to ${to}`);
      await deal.save();
      return deal;
    }
    if (action === 'paid') {
      if (!deal.documents.some((d) => d.kind === kind)) throw fail(400, 'Send the invoice first');
      const amount = money(body.amount);
      if (!amount) throw fail(400, 'Enter the amount received');
      if (!isDayStr(body.date) || body.date > today()) throw fail(400, 'Enter the date the payment came');
      deal.payments.push({ kind: label, amount, date: body.date, reference: text(body.reference, 120), by });
      note(deal, by, `${step === 'advance' ? 'Advance' : 'Full'} payment of ₹${amount} received${body.reference ? ` (ref ${text(body.reference, 120)})` : ''}`);
      return advance(deal, by);
    }
    throw fail(400, 'Unknown action');
  }

  if (step === 'execution') {
    if (action === 'add') {
      const t = text(body.text, 300);
      if (!t) throw fail(400, 'Write the deliverable');
      if (deal.deliverables.length >= 100) throw fail(400, 'Too many deliverables');
      deal.deliverables.push({ text: t });
    } else if (action === 'tick') {
      const d = deal.deliverables.id(body.itemId);
      if (!d) throw fail(404, 'Deliverable not found');
      d.done = body.done === true;
      d.doneAt = d.done ? new Date() : null;
      if (d.done) note(deal, by, `Done: ${d.text}`);
    } else if (action === 'remove') {
      const d = deal.deliverables.id(body.itemId);
      if (d) d.deleteOne();
    } else if (action === 'complete') {
      if (!deal.deliverables.length) throw fail(400, 'Add the deliverables first');
      if (deal.deliverables.some((d) => !d.done)) throw fail(400, 'Tick every deliverable first');
      return advance(deal, by);
    } else throw fail(400, 'Unknown action');
    await deal.save();
    return deal;
  }

  if (step === 'report') {
    const file = await dealFile(deal, body.file);
    const link = text(body.link, 1000);
    const summary = text(body.text, 10000);
    if (link && !linkOk(link)) throw fail(400, 'The report link must start with https://');
    if (!file && !link) throw fail(400, 'Upload the report file or add its link');
    if (!summary) throw fail(400, 'Write the results');
    deal.report = { text: summary, link };
    const doc = deal.documents.create({ kind: 'report', name: file?.name || 'Report', file: file || undefined, link, note: summary, by });
    const to = await emailDocument(deal, doc, { subject: 'Campaign report – {company}', intro: 'Here is the report of the work we did for you.' });
    deal.documents.push(doc);
    note(deal, by, `Report emailed to ${to}`);
    return advance(deal, by);
  }

  if (step === 'case_study') {
    const link = text(body.link, 1000);
    if (!linkOk(link)) throw fail(400, 'Add the link of the published case study (https://…)');
    deal.caseStudyLink = link;
    note(deal, by, `Case study published: ${link}`);
    return advance(deal, by);
  }

  if (step === 'content') {
    const ch = CHANNELS.find(([k]) => k === body.channel);
    if (!ch) throw fail(400, 'Unknown channel');
    const link = text(body.link, 1000);
    if (link && !linkOk(link)) throw fail(400, 'The link must start with https://');
    const row = deal.content.find((c) => c.channel === ch[0]);
    if (row) Object.assign(row, { link, at: link ? new Date() : null });
    else deal.content.push({ channel: ch[0], link, at: link ? new Date() : null });
    if (link) note(deal, by, `${ch[1]} posted: ${link}`);
    if (CHANNELS.every(([k]) => deal.content.find((c) => c.channel === k)?.link)) return advance(deal, by);
    await deal.save();
    return deal;
  }
  throw fail(400, 'Unknown step');
}

/** admin: give the open task of the deal's current step (or a sales task) to someone else */
export async function reassignTask(taskId, userId, by) {
  const t = await HrTask.findById(taskId);
  if (!t || t.status === 'done') throw fail(404, 'Open task not found');
  const u = await User.findOne({ _id: userId, role: 'team', active: true }).select('name').lean();
  if (!u) throw fail(400, 'Choose an active employee');
  const from = (await User.findById(t.user).select('name').lean())?.name || 'someone';
  t.user = u._id;
  t.comments.push({ author: by, text: `Reassigned from ${from} to ${u.name}` });
  await t.save();
  if (t.deal) {
    const d = await Deal.findById(t.deal);
    if (d) {
      note(d, by, `${STEP[t.step]?.label || 'Task'} reassigned from ${from} to ${u.name}`);
      await d.save();
    }
  }
  return t;
}

/** open lifecycle tasks of an employee (used when they are deactivated) */
export const openLifecycleTasks = (userId) => HrTask.find({ user: userId, status: { $ne: 'done' }, step: { $exists: true, $ne: null } }).lean();

/** deal summary for lists */
export function dealSummary(d, ownersByTask = {}) {
  const paid = (d.payments || []).reduce((n, p) => n + (p.amount || 0), 0);
  return {
    _id: d._id,
    company: d.company,
    title: d.title,
    step: d.step,
    stepLabel: STEP[d.step]?.label || 'Complete',
    value: d.value || 0,
    received: paid,
    due: Math.max(0, (d.value || 0) - paid),
    owner: ownersByTask[String(d._id)] || null,
    updatedAt: d.updatedAt,
    completedAt: d.completedAt,
  };
}

export const escapeForHtml = escapeHtml;
