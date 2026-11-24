// Website forms: every form on geekcreativeagency.com (client, creator, career, vendor) is sent here as well as by email.
//   POST /api/public/website-lead   - called by the website's server only, with the shared secret
//                                     (header x-website-secret = WEBSITE_LEAD_SECRET in both .env files)
//   /api/website-leads              - the admin's list: status, notes, search
// A CLIENT lead also lands in Pipeline: its company and contact are made (or matched), the company becomes a
// Hot lead, so Aanchal gets "Reply and book a meeting" on her own. Website leads are never put in an email
// sequence. Creator / career / vendor forms are only listed here (a career form keeps its resume).
// The same email sending the same form again is added to the entry it already has.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { Router } from 'express';
import mongoose from 'mongoose';
import { Company, Contact, Notification, User, bumpStage, getSetting, setSetting, stageChanged, upsertCompany } from '../models.js';
import { addDays } from '../hr-calc.js';
import { today } from '../hr-util.js';
import { HrFile, HrTask } from '../hr-models.js';
import { UPLOAD_DIR, removeFile } from './files.js';
import { stopAll } from '../worker.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';

const { Schema, model } = mongoose;
const id = Schema.Types.ObjectId;

// each form has its own statuses; the last ones of a form are "finished" (its task is closed)
const LABEL = {
  new: 'New', contacted: 'Contacted', converted: 'Converted', closed: 'Closed', spam: 'Spam',
  shortlisted: 'Shortlisted', interview: 'Interview', hired: 'Hired', rejected: 'Rejected',
  onboarded: 'Onboarded', notfit: 'Not a fit', partnered: 'Partnered',
  // client forms follow the company's Pipeline stage
  hot: 'Hot lead', opportunity: 'Opportunity', account: 'Account', old_client: 'Old client', cold: 'Cold (not now)',
};
export const LEAD_STATUSES = Object.keys(LABEL);
const STATUS_BY_FORM = {
  client: ['hot', 'opportunity', 'account', 'old_client', 'cold', 'spam'], // = Pipeline stage (spam: only here)
  career: ['new', 'shortlisted', 'interview', 'hired', 'rejected', 'spam'],
  creator: ['new', 'shortlisted', 'onboarded', 'notfit', 'spam'],
  vendor: ['new', 'contacted', 'partnered', 'notfit', 'spam'],
};
const FINISHED = new Set(['converted', 'closed', 'spam', 'hired', 'rejected', 'onboarded', 'notfit', 'partnered']);
export const FORMS = ['client', 'creator', 'career', 'vendor'];
const FORM_LABEL = { client: 'Client', creator: 'Creator', career: 'Career', vendor: 'Partner / vendor' };
// the fields each form sends, in the order they are shown (name / email / phone / company are kept on their own)
const FORM_FIELDS = {
  client: [['designation', 'Designation'], ['budget', 'Budget'], ['timeline', 'Timeline'], ['goal', 'Goal']],
  creator: [['instagram', 'Instagram'], ['city', 'City'], ['category', 'Category'], ['followers', 'Followers'], ['links', 'Other social links']],
  career: [['position', 'Position'], ['experience', 'Experience'], ['current_ctc', 'Current CTC'], ['expected_ctc', 'Expected CTC'], ['notice_period', 'Notice period'], ['location', 'Location'], ['linkedin', 'LinkedIn'], ['portfolio', 'LinkedIn / Portfolio'], ['role', 'Role'], ['why', 'Why Geek']],
  vendor: [['service', 'Service'], ['city', 'City'], ['website', 'Website'], ['about', 'About their work']],
};
const LONG = new Set(['goal', 'links', 'why', 'about']);
const RESUME = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const MAX_RESUME = 5 * 1024 * 1024;

export const WebsiteLead = model(
  'WebsiteLead',
  new Schema(
    {
      form: { type: String, enum: FORMS, default: 'client', index: true }, // which website form
      email: { type: String, required: true, lowercase: true, trim: true },
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      company: { type: String, default: '' },
      designation: { type: String, default: '' },
      budget: { type: String, default: '' },
      timeline: { type: String, default: '' },
      goal: { type: String, default: '' },
      fields: [{ _id: false, k: String, label: String, v: String }], // everything else the form asked, in order
      resume: new Schema({ id: String, name: String, size: Number, type: { type: String } }, { _id: false }), // career form
      page: { type: String, default: '' }, // the page the form was sent from
      status: { type: String, enum: LEAD_STATUSES, default: 'new', index: true },
      contact: { type: id, ref: 'Contact' },
      companyId: { type: id, ref: 'Company' },
      times: { type: Number, default: 1 }, // how many times this email has sent the form
      lastAt: { type: Date, default: () => new Date(), index: true },
      // every time the form came in, exactly as it was filled
      submissions: [{ _id: false, at: Date, name: String, phone: String, company: String, designation: String, budget: String, timeline: String, goal: String, fields: [{ _id: false, k: String, label: String, v: String }] }],
      notes: [{ by: String, text: String, at: { type: Date, default: () => new Date() } }],
    },
    { timestamps: true }
  ).index({ form: 1, email: 1 }, { unique: true }) // one entry per email per form
);
// older versions kept one entry per email for the client form only: swap that index for the new one
mongoose.connection.asPromise().then(() => WebsiteLead.syncIndexes()).catch((e) => console.warn('[website-lead] indexes:', e.message));

/* ---------------- the website calls this ---------------- */

const secretOk = (given) => {
  const want = String(process.env.WEBSITE_LEAD_SECRET || '').trim();
  if (want.length < 16) throw fail(503, 'Website leads are not set up (WEBSITE_LEAD_SECRET missing in .env)');
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
};

function readForm(b = {}) {
  const form = FORMS.includes(b.form) ? b.form : 'client';
  const email = validEmail(b.email);
  if (!email) throw fail(400, 'A valid email is required');
  const fields = FORM_FIELDS[form]
    .map(([k, label]) => ({ k, label, v: str(b[k], LONG.has(k) ? 4000 : 300) }))
    .filter((f) => f.v);
  const get = (k) => fields.find((f) => f.k === k)?.v || '';
  return {
    form,
    email,
    name: str(b.name, 120),
    phone: str(b.phone, 40),
    company: str(b.company, 200),
    designation: form === 'client' ? get('designation').slice(0, 120) : '',
    budget: form === 'client' ? get('budget').slice(0, 80) : '',
    timeline: form === 'client' ? get('timeline').slice(0, 80) : '',
    goal: form === 'client' ? get('goal') : '',
    fields,
    page: /^https?:\/\//i.test(str(b.page, 300)) ? str(b.page, 300) : '',
  };
}

/**
 * A career form's resume. The website sends it gzip-compressed (base64); it is checked, then kept compressed
 * on the server disk (".gz") - /api/files unpacks it when the admin downloads it.
 */
async function saveResume(r, owner) {
  if (!r || typeof r !== 'object') return null;
  const ext = String(r.name || '').split('.').pop().toLowerCase();
  if (!RESUME[ext]) return null;
  const sent = Buffer.from(str(r.data, MAX_RESUME * 1.4).replace(/^data:[^,]*,/, ''), 'base64');
  if (!sent.length) return null;
  let buf;
  try {
    buf = r.gzip ? zlib.gunzipSync(sent, { maxOutputLength: MAX_RESUME }) : sent;
  } catch {
    return null; // broken, or bigger than 5 MB once unpacked
  }
  if (!buf.length || buf.length > MAX_RESUME) return null;
  const real = ext === 'pdf' ? buf.subarray(0, 5).toString('latin1') === '%PDF-' : ext === 'docx' ? buf[0] === 0x50 && buf[1] === 0x4b : buf.subarray(0, 4).toString('hex') === 'd0cf11e0';
  if (!real) return null;
  const name = str(r.name, 120).replace(/[^\w.\- ]+/g, '').trim() || `resume.${ext}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const stored = `${crypto.randomBytes(16).toString('hex')}.${ext}.gz`;
  await fs.writeFile(path.join(UPLOAD_DIR, stored), zlib.gzipSync(buf, { level: 9 }));
  const f = await HrFile.create({ owner, name, type: RESUME[ext], size: buf.length, path: stored, uploadedBy: 'Website' });
  return { id: String(f._id), name: f.name, size: f.size, type: f.type };
}

/** the lead in Pipeline: company + contact, the company moves to Hot, the meeting task gets the form details */
async function toPipeline(f) {
  const companyName = f.company || f.name || f.email.split('@')[1];
  const summary = [
    'Website enquiry',
    f.name && `Name: ${f.name}`,
    f.designation && `Designation: ${f.designation}`,
    `Email: ${f.email}`,
    f.phone && `Phone: ${f.phone}`,
    f.budget && `Budget: ${f.budget}`,
    f.timeline && `Timeline: ${f.timeline}`,
    f.goal && `Goal: ${f.goal}`,
  ].filter(Boolean).join('\n');

  const company = await upsertCompany(companyName, { source: 'Website' });
  if (!company) return {};

  let contact = await Contact.findOne({ email: f.email });
  if (!contact) {
    try {
      contact = await Contact.create({
        email: f.email, name: f.name, company: companyName, companyId: company._id, title: f.designation, phone: f.phone,
        source: 'Website', notes: f.goal.slice(0, 1000), status: 'replied', repliedAt: new Date(),
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
      contact = await Contact.findOne({ email: f.email });
    }
  } else {
    // fill what is empty; never overwrite what the team already has
    for (const [k, v] of [['name', f.name], ['title', f.designation], ['phone', f.phone], ['company', companyName]]) if (!contact[k] && v) contact[k] = v;
    if (!contact.companyId) contact.companyId = company._id;
    if (!['unsubscribed', 'bounced'].includes(contact.status)) {
      contact.status = 'replied'; // they wrote to us: no more sequence emails
      contact.repliedAt = new Date();
    }
    await contact.save();
  }
  if (contact) await stopAll(contact._id, 'replied');

  await bumpStage(company._id, 'hot'); // Hot -> Aanchal's "Reply and book a meeting" task (lifecycle)
  // put the form on the open meeting task, so Aanchal has everything without opening the CRM
  await HrTask.updateMany(
    { company: company._id, step: 'meeting', status: { $ne: 'done' }, details: { $not: /Website enquiry/ } },
    [{ $set: { details: { $concat: [{ $ifNull: ['$details', ''] }, '\n\n', summary] } } }]
  ).catch(() => {});
  return { contact, company };
}

/* ---------------- who handles each form (the admin picks an employee; client forms follow the lifecycle) ---------------- */

const OWNED = ['career', 'creator', 'vendor'];
const owners = async () => ({ ...(await getSetting('websiteFormOwners', {})) });
/** the forms this login may see: admin all, an employee the forms the admin gave them */
async function allowedForms(req) {
  if (req.role === 'admin') return FORMS;
  if (req.role !== 'team') return [];
  const o = await owners();
  return OWNED.filter((k) => String(o[k] || '') === String(req.account._id));
}
const whoName = (req) => (req.role === 'admin' ? 'Admin' : req.account?.name || 'Team');

/** a task for the employee who handles this form (one open task per entry) */
async function ownerTask(lead) {
  const ownerId = (await owners())[lead.form];
  if (!ownerId || !(await User.exists({ _id: ownerId, role: 'team', active: { $ne: false } }))) return;
  if (await HrTask.exists({ websiteLead: lead._id, status: { $ne: 'done' } })) return;
  const lines = [
    `${FORM_LABEL[lead.form]} form from the website`,
    lead.name && `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    lead.phone && `Phone: ${lead.phone}`,
    lead.company && `Company: ${lead.company}`,
    ...(lead.fields || []).map((x) => `${x.label}: ${x.v}`),
    lead.resume?.id && 'Resume: attached (download it under Website forms)',
    '',
    'Open it under Website forms in your portal, update its status and add notes.',
  ].filter((x) => typeof x === 'string');
  await HrTask.create({
    user: ownerId,
    title: `${FORM_LABEL[lead.form]} form – ${lead.name || lead.email}`,
    details: lines.join('\n').slice(0, 4000),
    due: addDays(today(), 2),
    priority: 'normal',
    step: 'website_form',
    websiteLead: lead._id,
  });
}
const closeOwnerTask = (lead) => HrTask.updateMany({ websiteLead: lead._id, status: { $ne: 'done' } }, { $set: { status: 'done', doneAt: new Date() } });

export const hook = Router();
hook.post(
  '/',
  ah(async (req, res) => {
    if (!secretOk(req.get('x-website-secret'))) throw fail(401, 'Not allowed');
    const f = readForm(req.body);
    const at = new Date();
    const sub = { at, name: f.name, phone: f.phone, company: f.company, designation: f.designation, budget: f.budget, timeline: f.timeline, goal: f.goal, fields: f.fields };

    let lead = await WebsiteLead.findOne({ form: f.form, email: f.email });
    const again = Boolean(lead);
    if (lead) {
      lead.submissions.push(sub);
      if (lead.submissions.length > 20) lead.submissions = lead.submissions.slice(-20);
      lead.times += 1;
      lead.lastAt = at;
      for (const k of ['name', 'phone', 'company', 'designation', 'budget', 'timeline', 'goal', 'page']) if (f[k]) lead[k] = f[k];
      if (f.fields.length) lead.fields = f.fields;
      const what = f.goal || f.fields.find((x) => LONG.has(x.k))?.v || '';
      lead.notes.push({ by: 'Website', text: `Sent the form again${what ? `: ${what.slice(0, 300)}` : ''}` });
      if (['closed', 'spam', 'rejected', 'notfit'].includes(lead.status)) lead.status = 'new'; // came back after being closed: look at it again
    } else {
      try {
        lead = new WebsiteLead({ ...f, submissions: [sub], lastAt: at });
        await lead.save();
      } catch (e) {
        if (e?.code !== 11000) throw e;
        return res.status(202).json({ ok: true }); // the same form twice at the same moment: the first one wins
      }
    }

    if (f.form === 'career' && req.body?.resume) {
      try {
        const r = await saveResume(req.body.resume, lead._id);
        if (r) {
          if (lead.resume?.id) await removeFile(lead.resume.id); // keep the newest resume only
          lead.resume = r;
        }
      } catch (e) {
        console.error('[website-lead] resume:', e.message);
      }
    }

    // client form: Pipeline + Aanchal's task. A problem here never loses the lead itself.
    if (f.form === 'client') {
      try {
        const { contact, company } = await toPipeline(f);
        if (contact) lead.contact = contact._id;
        if (company) lead.companyId = company._id;
      } catch (e) {
        console.error('[website-lead] pipeline:', e.message);
        lead.notes.push({ by: 'CRM', text: `Could not add to Pipeline: ${e.message}` });
      }
    }
    await lead.save();
    if (f.form !== 'client') await ownerTask(lead).catch((e) => console.error('[website-lead] task:', e.message));

    const label = FORM_LABEL[f.form];
    await Notification.create({
      type: 'website',
      contact: lead.contact,
      name: f.name || f.email,
      text: `${again ? `Sent the ${label.toLowerCase()} form again` : `New ${label.toLowerCase()} form`}${f.company ? ` · ${f.company}` : ''}`,
    }).catch(() => {});
    res.status(201).json({ ok: true });
  })
);

/* ---------------- the pages: admin (every form) and the employee who handles a form ---------------- */

/** a client lead's status is its company's Pipeline stage (or Spam); other forms keep their own status */
const clientStatus = (l) => ((l.form || 'client') !== 'client' ? l.status : l.status === 'spam' ? 'spam' : l.stage || 'hot');
const shape = (l) => ({
  _id: l._id,
  form: l.form || 'client',
  formLabel: FORM_LABEL[l.form || 'client'],
  fields: l.fields?.length ? l.fields : FORM_FIELDS.client.map(([k, label]) => ({ k, label, v: l[k] || '' })).filter((x) => x.v),
  resume: l.resume?.id ? l.resume : null,
  name: l.name,
  email: l.email,
  phone: l.phone,
  company: l.company,
  designation: l.designation,
  budget: l.budget,
  timeline: l.timeline,
  goal: l.goal,
  page: l.page,
  status: clientStatus(l),
  statusLabel: LABEL[clientStatus(l)] || l.status,
  times: l.times,
  lastAt: l.lastAt,
  createdAt: l.createdAt,
  companyId: l.companyId,
  stage: l.stage,
  submissions: l.submissions || [],
  notes: (l.notes || []).map((n) => ({ _id: n._id, by: n.by, text: n.text, at: n.at })),
});

async function withStage(list) {
  const ids = list.map((l) => l.companyId).filter(Boolean);
  const stages = Object.fromEntries((await Company.find({ _id: { $in: ids } }).select('stage').lean()).map((c) => [String(c._id), c.stage]));
  return list.map((l) => shape({ ...l, stage: l.companyId ? stages[String(l.companyId)] || '' : '' }));
}
const formMatch = (k) => (k === 'client' ? { $in: ['client', null] } : k);

export const admin = Router();

// which forms this login handles (the employee portal shows "Website forms" only when there are some)
admin.get(
  '/mine',
  ah(async (req, res) => {
    const forms = await allowedForms(req);
    const others = forms.filter((k) => k !== 'client');
    const fresh = others.length ? await WebsiteLead.aggregate([{ $match: { form: { $in: others }, status: 'new' } }, { $group: { _id: '$form', n: { $sum: 1 } } }]) : [];
    const by = Object.fromEntries(fresh.map((c) => [c._id, c.n]));
    if (forms.includes('client')) {
      // client: still a Hot lead (waiting for the meeting)
      const ids = await WebsiteLead.distinct('companyId', { form: formMatch('client'), status: { $ne: 'spam' }, companyId: { $exists: true } });
      by.client = await Company.countDocuments({ _id: { $in: ids }, stage: 'hot' });
    }
    res.json({ forms: forms.map((k) => ({ key: k, label: FORM_LABEL[k], fresh: by[k] || 0 })) });
  })
);

// admin: the employee who handles each form
admin.get(
  '/owners',
  ah(async (req, res) => {
    if (req.role !== 'admin') throw fail(403, 'Only the admin can do this');
    const [o, team] = await Promise.all([owners(), User.find({ role: 'team', active: { $ne: false } }).select('name').sort({ name: 1 }).lean()]);
    res.json({ owners: Object.fromEntries(OWNED.map((k) => [k, o[k] ? String(o[k]) : ''])), team: team.map((u) => ({ _id: u._id, name: u.name })) });
  })
);
admin.put(
  '/owners',
  ah(async (req, res) => {
    if (req.role !== 'admin') throw fail(403, 'Only the admin can do this');
    const o = await owners();
    for (const k of OWNED) {
      if (req.body?.[k] === undefined) continue;
      const v = str(req.body[k], 40);
      if (v && !(mongoose.isValidObjectId(v) && (await User.exists({ _id: v, role: 'team' })))) throw fail(400, 'Choose an employee from the list');
      if (String(o[k] || '') !== v) {
        // hand the open tasks of this form to the new person (or close them when nobody handles it)
        const open = await WebsiteLead.find({ form: k }).select('_id').lean();
        const ids = open.map((x) => x._id);
        if (v) await HrTask.updateMany({ websiteLead: { $in: ids }, status: { $ne: 'done' } }, { $set: { user: v } });
        else await HrTask.updateMany({ websiteLead: { $in: ids }, status: { $ne: 'done' } }, { $set: { status: 'done', doneAt: new Date() } });
      }
      o[k] = v;
    }
    await setSetting('websiteFormOwners', o);
    res.json({ owners: Object.fromEntries(OWNED.map((k) => [k, o[k] || ''])) });
  })
);

admin.get(
  '/',
  ah(async (req, res) => {
    const allowed = await allowedForms(req);
    if (!allowed.length) throw fail(403, 'No website forms are given to you');
    const form = allowed.includes(req.query.form) ? req.query.form : allowed[0];
    const base = { form: formMatch(form) };
    const filter = { ...base };
    if (form !== 'client' && STATUS_BY_FORM[form].includes(req.query.status)) filter.status = req.query.status;
    const q = str(req.query.q, 100);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { company: rx }, { phone: rx }, { goal: rx }, { 'fields.v': rx }];
    }
    let list;
    let by;
    if (form === 'client') {
      // status = Pipeline stage: work it out for every client lead, then filter
      const all = await withStage(await WebsiteLead.find(filter).sort({ lastAt: -1 }).limit(1000).lean());
      const allForCount = q ? await withStage(await WebsiteLead.find(base).select('status companyId form').lean()) : all;
      by = {};
      for (const l of allForCount) by[l.status] = (by[l.status] || 0) + 1;
      list = (STATUS_BY_FORM.client.includes(req.query.status) ? all.filter((l) => l.status === req.query.status) : all).slice(0, 300);
    } else {
      const [found, counts] = await Promise.all([
        WebsiteLead.find(filter).sort({ lastAt: -1 }).limit(300).lean(),
        WebsiteLead.aggregate([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      ]);
      list = await withStage(found);
      by = Object.fromEntries(counts.map((c) => [c._id, c.n]));
    }
    const o = await owners();
    const ownerName = OWNED.includes(form) && o[form] ? (await User.findById(o[form]).select('name').lean())?.name || '' : '';
    res.json({
      form,
      formLabel: FORM_LABEL[form],
      list,
      counts: { all: Object.values(by).reduce((n, c) => n + c, 0), ...Object.fromEntries(STATUS_BY_FORM[form].map((s) => [s, by[s] || 0])) },
      statuses: STATUS_BY_FORM[form].map((k) => ({ key: k, label: LABEL[k] })),
      owner: OWNED.includes(form) ? { id: o[form] ? String(o[form]) : '', name: ownerName } : null,
      isAdmin: req.role === 'admin',
      ready: String(process.env.WEBSITE_LEAD_SECRET || '').trim().length >= 16,
    });
  })
);

/** client lead: move its company in Pipeline (same rules as Pipeline), or mark it Spam */
async function setClientStage(req, l, to) {
  const c = l.companyId ? await Company.findById(l.companyId) : null;
  const before = l.status === 'spam' ? 'spam' : c?.stage || 'hot';
  if (before === to) return;
  if (to === 'spam') {
    l.status = 'spam';
    if (c && ['hot', 'opportunity'].includes(c.stage)) {
      const from = c.stage;
      c.stage = 'cold'; // out of the active Pipeline: Aanchal's open meeting / contract task closes
      await c.save();
      await stageChanged(c, from, 'cold');
    }
  } else {
    if (!c) throw fail(400, 'This lead is not in Pipeline (its company was deleted). Add it in Pipeline first.');
    if (to === 'account' && c.stage !== 'account') throw fail(400, 'To make it an account, use "Convert to account" in Pipeline. That also makes the client login.');
    l.status = 'new';
    if (c.stage !== to) {
      const from = c.stage;
      c.stage = to;
      await c.save();
      await stageChanged(c, from, to); // the lifecycle hands out the tasks (meeting, contract, deal)
    }
  }
  l.notes.push({ by: whoName(req), text: `Status: ${LABEL[before]} → ${LABEL[to]}${to !== 'spam' ? ' (Pipeline updated)' : ''}` });
  await l.save();
}

/** an entry this login may work on */
const one = async (req) => {
  const l = await WebsiteLead.findById(checkId(req.params.id));
  if (!l || !(await allowedForms(req)).includes(l.form || 'client')) throw fail(404, 'Not found');
  return l;
};
const reply = async (res, l) => res.json((await withStage([l.toObject()]))[0]);

admin.put(
  '/:id',
  ah(async (req, res) => {
    const l = await one(req);
    const form = l.form || 'client';
    if (!STATUS_BY_FORM[form].includes(req.body?.status)) throw fail(400, 'Unknown status');
    if (form === 'client') {
      await setClientStage(req, l, req.body.status);
      return reply(res, l);
    }
    if (l.status !== req.body.status) {
      l.notes.push({ by: whoName(req), text: `Status: ${LABEL[l.status] || l.status} → ${LABEL[req.body.status]}` });
      l.status = req.body.status;
      await l.save();
      if (form !== 'client' && FINISHED.has(l.status)) await closeOwnerTask(l);
    }
    await reply(res, l);
  })
);

admin.post(
  '/:id/notes',
  ah(async (req, res) => {
    const l = await one(req);
    const text = str(req.body?.text, 2000);
    if (!text) throw fail(400, 'Write a note');
    l.notes.push({ by: whoName(req), text });
    await l.save();
    await reply(res, l);
  })
);

admin.delete(
  '/:id/notes/:nid',
  ah(async (req, res) => {
    const l = await one(req);
    const n = l.notes.id(req.params.nid);
    if (!n) throw fail(404, 'Note not found');
    if (req.role !== 'admin' && n.by !== whoName(req)) throw fail(403, 'You can delete only your own note');
    n.deleteOne();
    await l.save();
    await reply(res, l);
  })
);

// admin only: removes the entry (its resume and open task too); a client lead's company and contact stay in Pipeline
admin.delete(
  '/:id',
  ah(async (req, res) => {
    if (req.role !== 'admin') throw fail(403, 'Only the admin can delete');
    const l = await one(req);
    for (const f of await HrFile.find({ owner: l._id }).select('_id').lean()) await removeFile(String(f._id));
    await HrTask.deleteMany({ websiteLead: l._id, status: { $ne: 'done' } });
    await l.deleteOne();
    res.json({ ok: true });
  })
);

/** may this employee download this file? (a resume of a form they handle) */
export async function teamMayReadLeadFile(req, ownerId) {
  const l = await WebsiteLead.findById(ownerId).select('form').lean().catch(() => null);
  return Boolean(l && (await allowedForms(req)).includes(l.form || 'client'));
}
