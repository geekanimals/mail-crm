import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { Campaign, Contact, EmailLog, Enrollment } from '../models.js';
import { enroll, globalCc, runQueue, withSignature } from '../worker.js';
import { parseCc } from '../mail.js';
import { FOLLOW_UPS } from '../templates.js';
import { ah, checkId, fail, pct, str } from '../utils.js';

const router = Router();

function parse(b = {}) {
  const data = {
    name: str(b.name, 200),
    subject: str(b.subject, 500),
    body: str(b.body, 50000),
    useContactContent: b.useContactContent !== false,
    followUps: (Array.isArray(b.followUps) ? b.followUps.slice(0, 15) : [])
      .map((f) => ({ delayDays: Math.min(60, Math.max(1, parseInt(f?.delayDays) || config.intervalDays)), body: str(f?.body, 50000) }))
      .filter((f) => f.body),
    ...schedule(b),
  };
  if (!data.name || !data.subject || !data.body) throw fail(400, 'Name, subject and message are required');
  return data;
}

// follow-up gap (working days) + CC
function schedule(b = {}) {
  const out = {};
  const gap = parseInt(b.gapDays, 10);
  if (gap >= 1 && gap <= 30) out.gapDays = gap;
  if (typeof b.cc === 'string') out.cc = parseCc(b.cc).join(', ');
  return out;
}

/** stats for many campaigns at once */
export async function campaignStats(ids) {
  const [enr, logs, waiting] = await Promise.all([
    Enrollment.aggregate([{ $match: { campaign: { $in: ids } } }, { $group: { _id: { c: '$campaign', s: '$status' }, n: { $sum: 1 } } }]),
    EmailLog.aggregate([
      { $match: { campaign: { $in: ids }, status: 'sent' } },
      { $group: { _id: '$campaign', sent: { $sum: 1 }, opened: { $sum: { $cond: [{ $ifNull: ['$openedAt', false] }, 1, 0] } }, people: { $addToSet: '$contact' } } },
    ]),
    // still waiting for their first email (in the queue; the daily limit decides when it goes)
    Enrollment.aggregate([{ $match: { campaign: { $in: ids }, status: 'active', step: 0 } }, { $group: { _id: '$campaign', n: { $sum: 1 }, next: { $min: '$nextSendAt' } } }]),
  ]);
  const out = {};
  for (const i of ids) out[i] = { contacts: 0, active: 0, replied: 0, completed: 0, unsubscribed: 0, bounced: 0, sent: 0, opened: 0, reached: 0, waiting: 0 };
  for (const r of enr) {
    out[r._id.c][r._id.s] = r.n;
    out[r._id.c].contacts += r.n;
  }
  for (const r of logs) Object.assign(out[r._id], { sent: r.sent, opened: r.opened, reached: r.people.length });
  for (const r of waiting) Object.assign(out[r._id], { waiting: r.n, waitingFrom: r.next });
  for (const s of Object.values(out)) {
    s.openRate = pct(s.opened, s.sent);
    s.replyRate = pct(s.replied, s.reached);
  }
  return out;
}

/**
 * A campaign made from an uploaded file: how many people the file had and why some get no emails.
 * Worked out from the contacts that file saved (their batch = the campaign name), so it is right for old uploads too.
 * People already in the CRM before the upload are not saved again, so they are not counted here.
 */
export async function fileReport(campaigns) {
  const names = campaigns.filter((c) => c.fromFile).map((c) => c.name);
  if (!names.length) return {};
  const rows = await Contact.aggregate([
    { $match: { batch: { $in: names } } },
    { $group: { _id: { batch: '$batch', status: '$status', noEmail: { $in: [{ $ifNull: ['$email', ''] }, ['']] } }, n: { $sum: 1 } } },
  ]);
  const out = {};
  for (const r of rows) {
    const o = (out[r._id.batch] ||= { inFile: 0, bounced: 0, unsubscribed: 0, replied: 0, noEmail: 0 });
    o.inFile += r.n;
    if (r._id.noEmail) o.noEmail += r.n;
    else if (['bounced', 'unsubscribed', 'replied'].includes(r._id.status)) o[r._id.status] += r.n;
  }
  return out;
}

router.get(
  '/defaults',
  ah(async (_req, res) =>
    res.json({ intervalDays: config.intervalDays, sequenceDays: config.sequenceDays, skipWeekends: config.skipWeekends, cc: await globalCc(), followUps: FOLLOW_UPS.map(withSignature) })
  )
);

router.get(
  '/',
  ah(async (req, res) => {
    if (req.query.page === undefined) {
      const list = await Campaign.find().sort({ createdAt: -1 }).lean();
      const stats = await campaignStats(list.map((c) => c._id));
      return res.json(list.map((c) => ({ ...c, stats: stats[c._id] })));
    }
    // dashboard "Campaign history": one page at a time, with search and a status filter
    const limit = 10;
    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const filter = {};
    if (['draft', 'active', 'paused', 'completed'].includes(req.query.status)) filter.status = req.query.status;
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) filter.name = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const [list, total, counts] = await Promise.all([
      Campaign.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Campaign.countDocuments(filter),
      Campaign.aggregate([...(q ? [{ $match: { name: filter.name } }] : []), { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const [stats, files] = await Promise.all([campaignStats(list.map((c) => c._id)), fileReport(list)]);
    res.json({
      list: list.map((c) => ({ _id: c._id, name: c.name, status: c.status, createdAt: c.createdAt, fromFile: c.fromFile, emails: c.fromFile ? null : 1 + (c.followUps || []).length, stats: stats[c._id], file: files[c.name] || null })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    });
  })
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const id = checkId(req.params.id);
    const c = await Campaign.findById(id).lean();
    if (!c) throw fail(404, 'Campaign not found');
    const oid = new mongoose.Types.ObjectId(id);
    const [stats, people] = await Promise.all([
      campaignStats([oid]),
      Enrollment.find({ campaign: id }).sort({ updatedAt: -1 }).limit(200).populate('contact', 'name email messages.day').lean(),
    ]);
    res.json({ ...c, stats: stats[id], people, fixedFollowUps: FOLLOW_UPS.length, gap: c.gapDays || config.intervalDays, ccUsed: c.cc ?? (await globalCc()), file: (await fileReport([c]))[c.name] || null });
  })
);

router.post('/', ah(async (req, res) => res.status(201).json(await Campaign.create(parse(req.body)))));

router.put(
  '/:id',
  ah(async (req, res) => {
    const c = await Campaign.findByIdAndUpdate(checkId(req.params.id), { $set: parse(req.body) }, { new: true });
    if (!c) throw fail(404, 'Campaign not found');
    res.json(c);
  })
);

// change follow-up gap / CC of a running campaign: { gapDays, cc }
router.put(
  '/:id/schedule',
  ah(async (req, res) => {
    const c = await Campaign.findByIdAndUpdate(checkId(req.params.id), { $set: schedule(req.body) }, { new: true });
    if (!c) throw fail(404, 'Campaign not found');
    res.json(c);
  })
);

// add contacts and start sending: { batch?, onlyNew? }
router.post(
  '/:id/start',
  ah(async (req, res) => {
    const c = await Campaign.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Campaign not found');
    const r = await enroll(c, { batch: str(req.body?.batch, 200), onlyNew: req.body?.onlyNew !== false });
    setImmediate(() => runQueue());
    res.json(r);
  })
);

router.post(
  '/:id/:action(pause|resume)',
  ah(async (req, res) => {
    const id = checkId(req.params.id);
    const c = await Campaign.findById(id).select('status').lean();
    if (!c) throw fail(404, 'Campaign not found');
    if (req.params.action === 'pause' && c.status !== 'active') throw fail(400, 'Only a running campaign can be paused');
    if (req.params.action === 'resume' && c.status !== 'paused') throw fail(400, 'Only a paused campaign can be resumed');
    const status = req.params.action === 'pause' ? 'paused' : (await Enrollment.exists({ campaign: id, status: 'active' })) ? 'active' : 'completed';
    await Campaign.updateOne({ _id: id }, { $set: { status } });
    if (status === 'active') setImmediate(() => runQueue());
    res.json({ status });
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const id = checkId(req.params.id);
    await Enrollment.updateMany({ campaign: id, status: 'active' }, { $set: { status: 'stopped' } });
    await Campaign.deleteOne({ _id: id });
    res.json({ ok: true });
  })
);

export default router;
