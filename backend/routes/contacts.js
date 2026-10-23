import { Router } from 'express';
import mongoose from 'mongoose';
import { Campaign, Company, Contact, EmailLog, Enrollment, Reply, STAGES, Suppression, remember, statusRank, upsertCompany } from '../models.js';
import { cleanFields, mapColumns } from '../sheets.js';
import { config } from '../config.js';
import { fill, parseCc } from '../mail.js';
import { FOLLOW_UPS } from '../templates.js';
import { addWorkingDays, enroll, newText, pickEmail, withSignature, markReplied, markUnsubscribed, runQueue, stopAll } from '../worker.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';

const router = Router();
const STATUSES = ['new', 'contacted', 'replied', 'unsubscribed', 'bounced'];
const INFO = ['name', 'company', 'title', 'phone', 'linkedin', 'website', 'industry', 'location', 'signal', 'notes', 'leadDate'];
const fields = (b = {}) => {
  const blank = (v) => (/^(none|n\/?a|-|null|nil)$/i.test(v) ? '' : v); // "none" in a sheet = empty
  const out = Object.fromEntries(INFO.map((k) => [k, blank(str(b[k], k === 'notes' ? 5000 : 300))]));
  out.customSubject = str(b.subject ?? b.customSubject, 500);
  out.customBody = str(b.body ?? b.customBody, 20000);
  return out;
};
// only the details that were actually given (so an update never wipes data)
const given = (b = {}) => Object.fromEntries(Object.entries(fields(b)).filter(([k, v]) => v && !['customSubject', 'customBody'].includes(k)));

/** link people to their company (created if new); returns how many companies were touched */
async function linkCompanies(rows, stage) {
  const byName = new Map();
  for (const r of rows) if (r.company) (byName.get(r.company) || byName.set(r.company, []).get(r.company)).push(r);
  for (const [name, list] of byName) {
    const first = list[0];
    const c = await upsertCompany(name, { website: first.website, industry: first.industry, location: first.location, source: first.batch || '', stage: stage || 'cold' });
    if (c) await Contact.updateMany({ email: { $in: list.map((r) => r.email).filter(Boolean) } }, { $set: { companyId: c._id } });
  }
  return byName.size;
}

// list + search + filter
router.get(
  '/',
  ah(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const filter = {};
    const q = str(req.query.search, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (q) filter.$or = ['name', 'email', 'company', 'title', 'phone', 'location'].map((k) => ({ [k]: new RegExp(q, 'i') }));
    if (mongoose.isValidObjectId(req.query.companyId)) filter.companyId = req.query.companyId;
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (str(req.query.batch)) filter.batch = str(req.query.batch);
    const [items, total, counts, batches] = await Promise.all([
      Contact.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-messages -customBody').populate('companyId', 'name stage owner'),
      Contact.countDocuments(filter),
      Contact.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Contact.distinct('batch'),
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / limit) || 1, counts: Object.fromEntries(counts.map((c) => [c._id, c.n])), batches: batches.filter(Boolean) });
  })
);

// one contact with its email history
router.get(
  '/:id',
  ah(async (req, res) => {
    const id = checkId(req.params.id);
    const contact = await Contact.findById(id).populate('companyId', 'name stage owner website industry location');
    if (!contact) throw fail(404, 'Contact not found');
    const [emails, replies] = await Promise.all([
      EmailLog.find({ contact: id }).sort({ sentAt: -1 }).limit(50).populate('campaign', 'name').lean(),
      Reply.find({ contact: id }).sort({ receivedAt: -1 }).limit(20).lean(),
    ]);
    // every email this person gets: first email + follow-ups (name / company filled in)
    const enr = await Enrollment.findOne({ contact: id }).sort({ createdAt: -1 }).populate('campaign').lean();
    const campaign = enr?.campaign || { fromFile: true };
    const planned = [];
    for (let i = 0; i < 20; i++) {
      const m = pickEmail(campaign, contact, i);
      if (!m) break;
      const first = planned[0]?.subject || '';
      planned.push({ subject: fill(m.subject?.trim() || (i === 0 ? '' : `Re: ${first.replace(/^re:\s*/i, '')}`), contact), body: fill(withSignature(m.body), contact) });
    }
    res.json({ contact, emails, replies: replies.map((r) => ({ ...r, snippet: newText(r.snippet) || r.snippet })), planned });
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const email = validEmail(req.body?.email);
    if (!email) throw fail(400, 'Valid email is required');
    if (await Contact.exists({ email })) throw fail(409, 'This email already exists');
    const memory = await Suppression.findOne({ email }).lean();
    const c = await Contact.create({ ...fields(req.body), email, status: memory?.reason || 'new', source: 'Added manually' });
    if (c.company) await linkCompanies([c], STAGES.includes(req.body?.stage) ? req.body.stage : 'cold');
    res.status(201).json(c);
  })
);

// CSV import: { rows:[{email,name,company,phone,location,subject,body,status}], batch, campaignId }
// File import (CSV / Excel converted in the browser):
// { rows:[{ email, name, company, phone, location, status, messages:[{subject, body, day}] }], batch, campaignId?, startNow? }
// messages = your own written emails for that person: [0] = first email, [1] = follow-up 1 ... day = days after the first email
function cleanMessages(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  let lastDay = -1;
  list.slice(0, 15).forEach((m, i) => {
    const body = str(m?.body, 20000);
    if (!body) return;
    let day = Number(m?.day);
    if (!Number.isFinite(day) || day < 0) day = i * config.intervalDays; // default: every 2 days
    day = Math.min(365, Math.max(day, lastDay)); // never go backwards in time
    lastDay = day;
    out.push({ subject: str(m?.subject, 500), body, day });
  });
  return out;
}

router.post(
  '/import',
  ah(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
    const batch = str(req.body.batch, 200) || `Import ${new Date().toISOString().slice(0, 10)}`;
    const seen = new Set();
    const valid = [];
    let invalid = 0;
    for (const r of rows) {
      const email = validEmail(r?.email);
      if (!email) { invalid++; continue; }
      if (seen.has(email)) continue;
      seen.add(email);
      const s = str(r.status, 40).toLowerCase();
      const status = /unsub/.test(s) ? 'unsubscribed' : /repl/.test(s) ? 'replied' : /bounce/.test(s) ? 'bounced' : /sent|contacted|emailed/.test(s) ? 'contacted' : 'new';
      valid.push({ ...fields(r), email, status, batch, source: `File: ${batch}`, messages: cleanMessages(r.messages), fields: cleanFields(r.fields) });
    }

    // People already in the CRM are never added twice (so nobody gets the first email again).
    // But you can re-upload to change their upcoming messages - unless they replied / unsubscribed / bounced.
    const existingDocs = await Contact.find({ email: { $in: valid.map((v) => v.email) } }).select('email status').lean();
    const existing = new Map(existingDocs.map((c) => [c.email, c]));
    let updated = 0;
    const updatedIds = [];
    for (const v of valid.filter((x) => existing.has(x.email))) {
      const c = existing.get(v.email);
      // details (name, company, title ... and every sheet column) are always refreshed
      const set = { ...given(v), ...(v.fields.length ? { fields: v.fields } : {}) };
      const canChangeEmails = v.messages.length && !['replied', 'unsubscribed', 'bounced'].includes(c.status);
      if (canChangeEmails) set.messages = v.messages;
      if (!Object.keys(set).length) continue;
      await Contact.updateOne({ _id: c._id }, { $set: set });
      updated++;
      if (canChangeEmails && c.status === 'new') updatedIds.push(c._id);
    }

    const fresh = valid.filter((v) => !existing.has(v.email));
    const memory = new Map((await Suppression.find({ email: { $in: fresh.map((v) => v.email) } }).lean()).map((s) => [s.email, s.reason]));
    for (const v of fresh) {
      const old = memory.get(v.email);
      if (old && statusRank(old) > statusRank(v.status)) v.status = old;
      if (v.status !== 'new') await remember(v.email, v.status);
    }
    let inserted = [];
    try {
      inserted = await Contact.insertMany(fresh, { ordered: false });
    } catch (e) {
      inserted = e.insertedDocs || [];
    }

    // every person is linked to their company (pipeline stage chosen on the upload page)
    const companies = await linkCompanies(valid, STAGES.includes(req.body.stage) ? req.body.stage : 'cold');

    // Start sending: into a chosen campaign, or a new one named after the file
    let added = 0;
    let noFirstEmail = 0;
    let campaignId = null;
    const ids = [...inserted.filter((c) => c.status === 'new').map((c) => c._id), ...updatedIds]; // only people who can get emails
    let campaign = mongoose.isValidObjectId(req.body.campaignId) ? await Campaign.findById(req.body.campaignId) : null;
    if (!campaign && req.body.startNow === true && ids.length) {
      const gap = parseInt(req.body.gapDays, 10);
      campaign = await Campaign.create({
        name: batch,
        fromFile: true,
        useContactContent: true,
        status: 'draft',
        gapDays: gap >= 1 && gap <= 30 ? gap : config.intervalDays, // working days between follow-ups
        cc: typeof req.body.cc === 'string' ? parseCc(req.body.cc).join(', ') : null,
      });
    }
    if (campaign && ids.length) {
      ({ added, noFirstEmail } = await enroll(campaign, { contactIds: ids }));
      campaignId = campaign._id;
      setImmediate(() => runQueue());
    }
    res.json({ inserted: inserted.length, updated, alreadyInCrm: existing.size, invalid, addedToCampaign: added, noFirstEmail, campaignId, batch, companies });
  })
);

/* ---------- Already-contacted leads: continue from the right follow-up ----------
 * { rows:[{ email, name, company, subject, body, status, lastSent }], batch, gapDays, cc }
 * status = what was ALREADY sent:  new | first sent | followup 1 sent ... followup 6 sent | replied | unsubscribed | bounced
 * lastSent = date of that last email (2026-10-15 / 15-10-2026 / 15/10/2026). Empty = next email goes today.
 * The next email goes N working days after lastSent, as "Re: <subject>" with the fixed follow-up text.
 */
export function parseStage(v) {
  const s = String(v || '').toLowerCase().replace(/[_]+/g, ' ').trim();
  if (!s || /^(new|fresh|not sent|pending|0)$/.test(s)) return { sent: 0 };
  if (/unsub/.test(s)) return { status: 'unsubscribed' };
  if (/bounce/.test(s)) return { status: 'bounced' };
  if (/repl/.test(s)) return { status: 'replied' };
  if (/done|complete|finished|all sent/.test(s)) return { sent: 1 + FOLLOW_UPS.length };
  const fu = s.match(/(?:follow\s*-?\s*up|f\/?u)\s*-?\s*(\d+)/) || s.match(/(\d+)\s*(?:st|nd|rd|th)?\s*follow/);
  if (fu) return { sent: 1 + Math.min(Number(fu[1]), FOLLOW_UPS.length) };
  if (/first|initial|intro|start|1st|^sent$|contacted/.test(s)) return { sent: 1 };
  return { error: `Unknown status "${v}"` };
}

export function parseDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  let d = null;
  if (/^\d{5}(\.\d+)?$/.test(s)) d = new Date(Math.round((Number(s) - 25569) * 86400000)); // Excel date number
  else if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) d = new Date(s.slice(0, 10) + 'T10:30:00+05:30');
  else {
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); // Indian style: day/month/year
    if (m) d = new Date(`${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T10:30:00+05:30`);
    else d = new Date(s);
  }
  return d && !isNaN(d) && d < new Date(Date.now() + 86400000) ? d : null;
}

router.post(
  '/import-continue',
  ah(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
    const batch = str(req.body.batch, 200) || `Continue ${new Date().toISOString().slice(0, 10)}`;
    const gapNum = parseInt(req.body.gapDays, 10);
    const gap = gapNum >= 1 && gapNum <= 30 ? gapNum : config.intervalDays;
    const out = { started: 0, fresh: 0, finished: 0, stopped: 0, skipped: 0, invalid: 0, errors: [] };
    const seen = new Set();
    // later chunks of the same file go into the same campaign
    let campaign = mongoose.isValidObjectId(req.body.campaignId) ? await Campaign.findById(req.body.campaignId) : null;
    const now = new Date();

    for (const r of rows) {
      const email = validEmail(r?.email);
      if (!email || seen.has(email)) { if (!email) out.invalid++; continue; }
      seen.add(email);
      const stage = parseStage(r.status);
      if (stage.error) { out.errors.push(`${email}: ${stage.error}`); out.skipped++; continue; }
      const subject = str(r.subject, 500);
      const body = str(r.body, 20000);

      const existing = await Contact.findOne({ email });
      const memory = await Suppression.findOne({ email }).lean();
      if (['unsubscribed', 'bounced'].includes(memory?.reason) || ['replied', 'unsubscribed', 'bounced'].includes(existing?.status)) { out.skipped++; continue; }
      if (existing && (await Enrollment.exists({ contact: existing._id, status: 'active' }))) { out.errors.push(`${email}: already running`); out.skipped++; continue; }

      const info = { ...given(r), batch, source: `File: ${batch}` };
      const sheetCols = cleanFields(r.fields);
      if (sheetCols.length) info.fields = sheetCols;
      const pipeline = STAGES.includes(req.body.stage) ? req.body.stage : 'cold';

      // replied / unsubscribed / bounced -> just remember, never email
      if (stage.status) {
        const c = existing ? Object.assign(existing, info, { status: stage.status }) : new Contact({ ...info, email, status: stage.status });
        await c.save();
        await remember(email, stage.status);
        if (c.company) await linkCompanies([c], stage.status === 'replied' ? 'hot' : pipeline);
        out.stopped++;
        continue;
      }
      if (stage.sent === 0 && !body) { out.errors.push(`${email}: status is new but no first email (subject/body)`); out.skipped++; continue; }
      if (stage.sent > 0 && !subject) { out.errors.push(`${email}: subject of the first email is needed for "Re: subject"`); out.skipped++; continue; }

      const contact = existing ? Object.assign(existing, info) : new Contact({ ...info, email });
      contact.messages = [{ subject, body, day: 0 }];
      if (stage.sent > 0) contact.status = 'contacted';
      await contact.save();
      if (stage.sent > 0) await remember(email, 'contacted');
      if (contact.company) await linkCompanies([contact], pipeline);

      if (stage.sent >= 1 + FOLLOW_UPS.length) { out.finished++; continue; } // everything already sent

      campaign ||= await Campaign.create({
        name: batch,
        fromFile: true,
        status: 'draft',
        gapDays: gap,
        cc: typeof req.body.cc === 'string' ? parseCc(req.body.cc).join(', ') : null,
      });
      const last = parseDate(r.lastSent);
      const due = stage.sent === 0 || !last ? now : addWorkingDays(last, gap);
      await Enrollment.updateOne(
        { campaign: campaign._id, contact: contact._id },
        {
          $setOnInsert: {
            status: 'active',
            step: stage.sent, // emails already sent -> the next one is step+1
            rootSubject: subject || undefined,
            messageIds: [],
            lastSentAt: last || undefined,
            nextSendAt: due < now ? now : due,
          },
        },
        { upsert: true }
      );
      if (stage.sent === 0) out.fresh++;
      else out.started++;
    }
    if (campaign) {
      await Campaign.updateOne({ _id: campaign._id }, { $set: { status: 'active' } });
      setImmediate(() => runQueue());
    }
    res.json({ ...out, errors: out.errors.slice(0, 50), campaignId: campaign?._id || null, batch });
  })
);

// Edit a person. Saves the main details AND the "all details from the sheet" list, and keeps both in step:
// change Designation in the main details -> the sheet's "Designation" column changes too, and the other way round.
router.put(
  '/:id',
  ah(async (req, res) => {
    const c = await Contact.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Contact not found');
    const body = req.body || {};
    const clean = fields(body);
    const changed = {}; // core detail -> new value
    for (const k of INFO) if (body[k] !== undefined && clean[k] !== (c[k] || '')) changed[k] = clean[k];
    if (body.email !== undefined) {
      const raw = str(body.email, 254);
      const e = raw ? validEmail(raw) : '';
      if (e === null) throw fail(400, 'That email address does not look right');
      if (e !== (c.email || '')) changed.email = e;
    }

    // sheet details: the edited list if sent, else the saved one
    const before = (c.fields || []).map((f) => ({ k: f.k, v: f.v }));
    let list = Array.isArray(body.fields) ? cleanFields(body.fields) : before.map((f) => ({ ...f }));
    const map = mapColumns(list.map((f) => f.k));
    for (const [k, i] of Object.entries(map)) {
      if (![...INFO, 'email'].includes(k) || !list[i]) continue;
      if (k in changed) list[i].v = changed[k]; // main detail edited -> sheet follows
      else {
        const old = before.find((f) => f.k === list[i].k)?.v || '';
        if (list[i].v !== old) changed[k] = k === 'email' ? validEmail(list[i].v) || c.email || '' : list[i].v; // sheet edited -> main detail follows
      }
    }
    list = list.filter((f) => f.v);

    if (changed.email) {
      const taken = await Contact.exists({ email: changed.email, _id: { $ne: c._id } });
      if (taken) throw fail(409, `${changed.email} is already saved on another contact`);
    }
    for (const [k, v] of Object.entries(changed)) c[k] = k === 'email' && !v ? undefined : v;
    c.fields = list;
    if (body.subject !== undefined) c.customSubject = clean.customSubject;
    if (body.body !== undefined) c.customBody = clean.customBody;

    if ('company' in changed) {
      const co = changed.company ? await upsertCompany(changed.company, { website: c.website, industry: c.industry, location: c.location, source: c.batch || '' }) : null;
      c.companyId = co?._id || undefined;
    }
    try {
      await c.save();
    } catch (e) {
      if (e?.code === 11000) throw fail(409, 'That email is already saved on another contact');
      throw e;
    }
    res.json(c);
  })
);

router.post(
  '/:id/replied',
  ah(async (req, res) => {
    const c = await Contact.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Contact not found');
    await markReplied(c, { snippet: 'Marked as replied manually' });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/unsubscribe',
  ah(async (req, res) => {
    const c = await Contact.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Contact not found');
    await markUnsubscribed(c);
    res.json({ ok: true });
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const c = await Contact.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Contact not found');
    if (c.status !== 'new') await remember(c.email, c.status); // so a re-import won't email them again
    await stopAll(c._id, 'stopped');
    await c.deleteOne();
    res.json({ ok: true });
  })
);

export default router;
