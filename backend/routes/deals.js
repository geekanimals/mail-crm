// Deals: the client work after a company becomes an account (estimate -> ... -> content posts).
// Admin: every deal, step owners, reassign. Employees: the deals they have a task on, and the step that is theirs.
import { Router } from 'express';
import mongoose from 'mongoose';
import { Company, User } from '../models.js';
import { HrTask } from '../hr-models.js';
import { CHANNELS, DEAL_STEPS, Deal, STEPS, canWork, dealSummary, reassignTask, saveStepDays, saveStepOwners, stepAction, stepDays, stepOwners } from '../lifecycle.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';

const router = Router();
router.use((req, _res, next) => (['admin', 'team'].includes(req.role) ? next() : next(fail(403, 'Not allowed'))));
const adminOnly = (req) => {
  if (req.role !== 'admin') throw fail(403, 'Only the admin can do this');
};
const names = async (ids) => new Map((await User.find({ _id: { $in: ids } }).select('name photo').lean()).map((u) => [String(u._id), u]));

router.get(
  '/',
  ah(async (req, res) => {
    const filter = {};
    if (req.role === 'team') filter._id = { $in: await HrTask.distinct('deal', { user: req.account._id, deal: { $ne: null } }) };
    if (req.query.show === 'open') filter.step = { $ne: 'complete' };
    if (req.query.show === 'complete') filter.step = 'complete';
    const deals = await Deal.find(filter).sort({ updatedAt: -1 }).limit(500).select('-timeline -documents.note').lean();
    const open = await HrTask.find({ deal: { $in: deals.map((d) => d._id) }, status: { $ne: 'done' } }).select('deal user due step').lean();
    const who = await names(open.map((t) => t.user));
    const byDeal = Object.fromEntries(open.map((t) => [String(t.deal), { taskId: t._id, name: who.get(String(t.user))?.name || '—', userId: t.user, due: t.due }]));
    const companies = new Map((await Company.find({ _id: { $in: deals.map((d) => d.company) } }).select('name').lean()).map((c) => [String(c._id), c.name]));
    res.json({ steps: DEAL_STEPS.map((k) => ({ key: k, label: STEPS.find((s) => s.key === k).label })), list: deals.map((d) => ({ ...dealSummary(d, byDeal), companyName: companies.get(String(d.company)) || d.title })) });
  })
);

// step owners + days (admin)
router.get(
  '/owners',
  ah(async (req, res) => {
    adminOnly(req);
    const team = await User.find({ role: 'team', active: true }).sort({ name: 1 }).select('name title').lean();
    res.json({ steps: STEPS.map(({ key, label, sales, days }) => ({ key, label, sales: Boolean(sales), defaultDays: days })), owners: await stepOwners(), days: await stepDays(), team });
  })
);
router.put(
  '/owners',
  ah(async (req, res) => {
    adminOnly(req);
    const owners = await saveStepOwners(req.body?.owners || {});
    const days = await saveStepDays(req.body?.days || {});
    res.json({ owners, days });
  })
);

// all open client tasks (sales + deals) with owner, for the admin's overview / reassign
router.get(
  '/tasks',
  ah(async (req, res) => {
    adminOnly(req);
    const list = await HrTask.find({ step: { $ne: null }, status: { $ne: 'done' } }).sort({ due: 1 }).limit(500).lean();
    const who = await names(list.map((t) => t.user));
    res.json(list.map((t) => ({ _id: t._id, title: t.title, step: t.step, due: t.due, status: t.status, deal: t.deal, company: t.company, user: t.user, name: who.get(String(t.user))?.name || '—' })));
  })
);
router.post(
  '/tasks/:taskId/reassign',
  ah(async (req, res) => {
    adminOnly(req);
    res.json(await reassignTask(checkId(req.params.taskId), checkId(req.body?.user), req.user));
  })
);

async function full(deal) {
  const d = deal.toObject ? deal.toObject() : deal;
  const tasks = await HrTask.find({ deal: d._id }).sort({ createdAt: 1 }).select('user step status due doneAt createdAt').lean();
  const who = await names(tasks.map((t) => t.user));
  const company = await Company.findById(d.company).select('name website stage').lean();
  const client = await User.findOne({ role: 'client', companyId: d.company }).select('email bountyMemberId').lean();
  return {
    ...d,
    companyName: company?.name || d.title,
    clientLogin: client ? { email: client.email, bounty: Boolean(client.bountyMemberId) } : null,
    tasks: tasks.map((t) => ({ ...t, name: who.get(String(t.user))?.name || '—' })),
    steps: DEAL_STEPS.map((k) => ({ key: k, label: STEPS.find((s) => s.key === k).label, ask: STEPS.find((s) => s.key === k).ask })),
    channels: CHANNELS.map(([key, label]) => ({ key, label })),
    timeline: [...(d.timeline || [])].reverse().slice(0, 300),
  };
}

async function load(req) {
  const d = await Deal.findById(checkId(req.params.id));
  if (!d) throw fail(404, 'Deal not found');
  if (!(await canWork(req, d))) throw fail(404, 'Deal not found');
  return d;
}

router.get('/:id', ah(async (req, res) => res.json(await full(await load(req)))));

router.put(
  '/:id',
  ah(async (req, res) => {
    adminOnly(req);
    const d = await load(req);
    if (req.body?.clientEmail !== undefined) {
      const e = req.body.clientEmail ? validEmail(req.body.clientEmail) : '';
      if (req.body.clientEmail && !e) throw fail(400, 'Client email is not valid');
      d.clientEmail = e || '';
    }
    if (req.body?.title !== undefined) d.title = str(req.body.title, 200) || d.title;
    await d.save();
    res.json(await full(d));
  })
);

router.post(
  '/:id/step/:step',
  ah(async (req, res) => {
    const d = await load(req);
    const out = await stepAction(req, d, str(req.params.step, 30), req.body || {});
    res.json(await full(out));
  })
);

// delete a deal (admin) - its tasks and files go too
router.delete(
  '/:id',
  ah(async (req, res) => {
    adminOnly(req);
    const d = await load(req);
    await HrTask.deleteMany({ deal: d._id });
    const { removeFile } = await import('./files.js');
    const files = await mongoose.model('HrFile').find({ owner: d._id }).select('_id').lean();
    for (const f of files) await removeFile(String(f._id));
    await d.deleteOne();
    res.json({ ok: true });
  })
);

export default router;
