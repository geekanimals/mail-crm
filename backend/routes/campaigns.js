import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { Campaign, EmailLog, Enrollment } from '../models.js';
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
  const [enr, logs] = await Promise.all([
    Enrollment.aggregate([{ $match: { campaign: { $in: ids } } }, { $group: { _id: { c: '$campaign', s: '$status' }, n: { $sum: 1 } } }]),
    EmailLog.aggregate([
      { $match: { campaign: { $in: ids }, status: 'sent' } },
      { $group: { _id: '$campaign', sent: { $sum: 1 }, opened: { $sum: { $cond: [{ $ifNull: ['$openedAt', false] }, 1, 0] } }, people: { $addToSet: '$contact' } } },
    ]),
  ]);
  const out = {};
  for (const i of ids) out[i] = { contacts: 0, active: 0, replied: 0, completed: 0, unsubscribed: 0, bounced: 0, sent: 0, opened: 0, reached: 0 };
  for (const r of enr) {
    out[r._id.c][r._id.s] = r.n;
    out[r._id.c].contacts += r.n;
  }
  for (const r of logs) Object.assign(out[r._id], { sent: r.sent, opened: r.opened, reached: r.people.length });
  for (const s of Object.values(out)) {
    s.openRate = pct(s.opened, s.sent);
    s.replyRate = pct(s.replied, s.reached);
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
  ah(async (_req, res) => {
    const list = await Campaign.find().sort({ createdAt: -1 }).lean();
    const stats = await campaignStats(list.map((c) => c._id));
    res.json(list.map((c) => ({ ...c, stats: stats[c._id] })));
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
    res.json({ ...c, stats: stats[id], people, fixedFollowUps: FOLLOW_UPS.length, gap: c.gapDays || config.intervalDays, ccUsed: c.cc ?? (await globalCc()) });
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
