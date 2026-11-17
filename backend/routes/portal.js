// What a team member or a client sees after logging in.
//  team   -> the tasks assigned to them on every account, can tick them done
//  client -> their own account: progress of the work the team is doing for them
import { Router } from 'express';
import { Company } from '../models.js';
import { DEAL_STEPS, Deal, STEP } from '../lifecycle.js';
import { ah, checkId, fail, str } from '../utils.js';

const router = Router();

router.get(
  '/',
  ah(async (req, res) => {
    const me = { _id: req.account?._id, name: req.user, role: req.role, email: req.account?.email, title: req.account?.title, mustChangePassword: Boolean(req.account?.mustChangePassword), photo: req.account?.photo || '' };
    if (req.role === 'team') {
      const list = await Company.find({ stage: { $in: ['account', 'old_client'] }, $or: [{ team: req.user }, { 'tasks.member': req.user }] }).select('name stage tasks team messages').lean();
      const accounts = list
        .map((c) => ({ _id: c._id, name: c.name, stage: c.stage, team: c.team || [], tasks: c.tasks.filter((t) => t.member === req.user), messages: (c.messages || []).slice(-100) }))
        .sort((a, b) => b.tasks.filter((t) => !t.done).length - a.tasks.filter((t) => !t.done).length);
      return res.json({ me, accounts });
    }
    if (req.role === 'client') {
      const c = await Company.findById(req.account.companyId).select('name stage tasks website team messages').lean();
      if (!c) return res.json({ me, account: null });
      // the project: which step it is at, and the documents sent to the client (estimate, invoices, report)
      const deal = await Deal.findOne({ company: c._id }).sort({ createdAt: -1 }).lean();
      const project = deal && {
        _id: deal._id,
        step: deal.step,
        steps: DEAL_STEPS.map((k) => ({ key: k, label: STEP[k].label })),
        documents: deal.documents.filter((d) => d.emailedAt).map((d) => ({ _id: d._id, kind: d.kind, name: d.name, number: d.number, amount: d.amount, file: d.file?.id ? d.file : null, link: d.link, at: d.emailedAt })),
        deliverables: deal.deliverables.map((d) => ({ _id: d._id, text: d.text, done: d.done })),
        report: deal.step === 'estimate' ? null : deal.report?.text ? deal.report : null,
      };
      return res.json({
        me,
        project,
        account: { _id: c._id, name: c.name, stage: c.stage, website: c.website, team: c.team || [], messages: (c.messages || []).slice(-100), tasks: c.tasks.map((t) => ({ _id: t._id, member: t.member, task: t.task, done: t.done, updatedAt: t.updatedAt })) },
      });
    }
    res.json({ me }); // admin
  })
);

// team member ticks their own task
router.put(
  '/tasks/:companyId/:taskId',
  ah(async (req, res) => {
    if (req.role !== 'team') throw fail(403, 'Only team members can update tasks');
    const c = await Company.findOneAndUpdate(
      { _id: checkId(req.params.companyId), tasks: { $elemMatch: { _id: checkId(req.params.taskId), member: req.user } } },
      { $set: { 'tasks.$.done': req.body?.done === true, 'tasks.$.updatedAt': new Date() } },
      { new: true }
    );
    if (!c) throw fail(404, 'Task not found');
    res.json({ ok: true });
  })
);

// write a message on an account: team members on that account, or the client of that account
router.post(
  '/messages/:companyId',
  ah(async (req, res) => {
    const text = str(req.body?.text, 5000);
    if (!text) throw fail(400, 'Write a message');
    const id = checkId(req.params.companyId);
    const allowed =
      req.role === 'team'
        ? { _id: id, stage: { $in: ['account', 'old_client'] }, $or: [{ team: req.user }, { 'tasks.member': req.user }] }
        : req.role === 'client' && String(req.account.companyId) === id
          ? { _id: id }
          : null;
    if (!allowed) throw fail(403, 'You cannot write on this account');
    const c = await Company.findOneAndUpdate(allowed, { $push: { messages: { author: req.user, role: req.role, text, createdAt: new Date() } } }, { new: true });
    if (!c) throw fail(403, 'You cannot write on this account');
    res.status(201).json(c.messages.at(-1));
  })
);

export default router;
