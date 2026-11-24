// Website leads: the "Work with us" (client) form on geekcreativeagency.com is sent here as well as by email.
//   POST /api/public/website-lead   - called by the website's server only, with the shared secret
//                                     (header x-website-secret = WEBSITE_LEAD_SECRET in both .env files)
//   /api/website-leads              - the admin's list: status, notes, search
// Every lead also lands in Pipeline: its company and contact are made (or matched), the company becomes a
// Hot lead, so Aanchal gets "Reply and book a meeting" on her own. Website leads are never put in an email
// sequence. The same email sending the form again is added to the lead it already has.
import crypto from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import { Company, Contact, Notification, bumpStage, upsertCompany } from '../models.js';
import { HrTask } from '../hr-models.js';
import { stopAll } from '../worker.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';

const { Schema, model } = mongoose;
const id = Schema.Types.ObjectId;

export const LEAD_STATUSES = ['new', 'contacted', 'converted', 'closed', 'spam'];
const LABEL = { new: 'New', contacted: 'Contacted', converted: 'Converted', closed: 'Closed', spam: 'Spam' };

export const WebsiteLead = model(
  'WebsiteLead',
  new Schema(
    {
      email: { type: String, required: true, lowercase: true, trim: true, unique: true },
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      company: { type: String, default: '' },
      designation: { type: String, default: '' },
      budget: { type: String, default: '' },
      timeline: { type: String, default: '' },
      goal: { type: String, default: '' },
      page: { type: String, default: '' }, // the page the form was sent from
      status: { type: String, enum: LEAD_STATUSES, default: 'new', index: true },
      contact: { type: id, ref: 'Contact' },
      companyId: { type: id, ref: 'Company' },
      times: { type: Number, default: 1 }, // how many times this email has sent the form
      lastAt: { type: Date, default: () => new Date(), index: true },
      // every time the form came in, exactly as it was filled
      submissions: [{ _id: false, at: Date, name: String, phone: String, company: String, designation: String, budget: String, timeline: String, goal: String }],
      notes: [{ by: String, text: String, at: { type: Date, default: () => new Date() } }],
    },
    { timestamps: true }
  )
);

/* ---------------- the website calls this ---------------- */

const secretOk = (given) => {
  const want = String(process.env.WEBSITE_LEAD_SECRET || '').trim();
  if (want.length < 16) throw fail(503, 'Website leads are not set up (WEBSITE_LEAD_SECRET missing in .env)');
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
};

function readForm(b = {}) {
  const email = validEmail(b.email);
  if (!email) throw fail(400, 'A valid email is required');
  return {
    email,
    name: str(b.name, 120),
    phone: str(b.phone, 40),
    company: str(b.company, 200),
    designation: str(b.designation, 120),
    budget: str(b.budget, 80),
    timeline: str(b.timeline, 80),
    goal: str(b.goal, 4000),
    page: /^https?:\/\//i.test(str(b.page, 300)) ? str(b.page, 300) : '',
  };
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

export const hook = Router();
hook.post(
  '/',
  ah(async (req, res) => {
    if (!secretOk(req.get('x-website-secret'))) throw fail(401, 'Not allowed');
    const f = readForm(req.body);
    const at = new Date();
    const sub = { at, name: f.name, phone: f.phone, company: f.company, designation: f.designation, budget: f.budget, timeline: f.timeline, goal: f.goal };

    let lead = await WebsiteLead.findOne({ email: f.email });
    const again = Boolean(lead);
    if (lead) {
      lead.submissions.push(sub);
      if (lead.submissions.length > 20) lead.submissions = lead.submissions.slice(-20);
      lead.times += 1;
      lead.lastAt = at;
      for (const k of ['name', 'phone', 'company', 'designation', 'budget', 'timeline', 'goal', 'page']) if (f[k]) lead[k] = f[k];
      lead.notes.push({ by: 'Website', text: `Sent the form again${f.goal ? `: ${f.goal.slice(0, 300)}` : ''}` });
      if (['closed', 'spam'].includes(lead.status)) lead.status = 'new';
    } else {
      try {
        lead = new WebsiteLead({ ...f, submissions: [sub], lastAt: at });
        await lead.save();
      } catch (e) {
        if (e?.code !== 11000) throw e;
        return res.status(202).json({ ok: true }); // the same form twice at the same moment: the first one wins
      }
    }

    // Pipeline + Aanchal's task. A problem here never loses the lead itself.
    try {
      const { contact, company } = await toPipeline(f);
      if (contact) lead.contact = contact._id;
      if (company) lead.companyId = company._id;
    } catch (e) {
      console.error('[website-lead] pipeline:', e.message);
      lead.notes.push({ by: 'CRM', text: `Could not add to Pipeline: ${e.message}` });
    }
    await lead.save();

    await Notification.create({
      type: 'website',
      contact: lead.contact,
      name: f.name || f.email,
      text: `${again ? 'Sent the website form again' : 'New website enquiry'}${f.company ? ` · ${f.company}` : ''}`,
    }).catch(() => {});
    res.status(201).json({ ok: true });
  })
);

/* ---------------- the admin's page ---------------- */

const shape = (l) => ({
  _id: l._id,
  name: l.name,
  email: l.email,
  phone: l.phone,
  company: l.company,
  designation: l.designation,
  budget: l.budget,
  timeline: l.timeline,
  goal: l.goal,
  page: l.page,
  status: l.status,
  statusLabel: LABEL[l.status],
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

export const admin = Router();
admin.get(
  '/',
  ah(async (req, res) => {
    const filter = {};
    if (LEAD_STATUSES.includes(req.query.status)) filter.status = req.query.status;
    const q = str(req.query.q, 100);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { company: rx }, { phone: rx }, { goal: rx }];
    }
    const [list, counts] = await Promise.all([
      WebsiteLead.find(filter).sort({ lastAt: -1 }).limit(300).lean(),
      WebsiteLead.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const by = Object.fromEntries(counts.map((c) => [c._id, c.n]));
    res.json({
      list: await withStage(list),
      counts: { all: counts.reduce((n, c) => n + c.n, 0), ...Object.fromEntries(LEAD_STATUSES.map((s) => [s, by[s] || 0])) },
      statuses: LEAD_STATUSES.map((k) => ({ key: k, label: LABEL[k] })),
      ready: String(process.env.WEBSITE_LEAD_SECRET || '').trim().length >= 16,
    });
  })
);

const one = async (req) => {
  const l = await WebsiteLead.findById(checkId(req.params.id));
  if (!l) throw fail(404, 'Lead not found');
  return l;
};
const reply = async (res, l) => res.json((await withStage([l.toObject()]))[0]);

admin.put(
  '/:id',
  ah(async (req, res) => {
    const l = await one(req);
    if (!LEAD_STATUSES.includes(req.body?.status)) throw fail(400, 'Unknown status');
    if (l.status !== req.body.status) {
      l.notes.push({ by: 'Admin', text: `Status: ${LABEL[l.status]} → ${LABEL[req.body.status]}` });
      l.status = req.body.status;
      await l.save();
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
    l.notes.push({ by: 'Admin', text });
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
    n.deleteOne();
    await l.save();
    await reply(res, l);
  })
);

// removes the lead from this list only; its company and contact stay in Pipeline
admin.delete(
  '/:id',
  ah(async (req, res) => {
    const l = await one(req);
    await l.deleteOne();
    res.json({ ok: true });
  })
);
