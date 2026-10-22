// What a team member or a client sees after logging in.
//  team   -> the tasks assigned to them on every account, can tick them done
//  client -> their own account: progress of the work the team is doing for them
import { Router } from 'express';
import { Company } from '../models.js';
import { ah, checkId, fail } from '../utils.js';

const router = Router();

router.get(
  '/',
  ah(async (req, res) => {
    const me = { name: req.user, role: req.role, email: req.account?.email, title: req.account?.title };
    if (req.role === 'team') {
      const list = await Company.find({ 'tasks.member': req.user }).select('name stage tasks').lean();
      const accounts = list
        .map((c) => ({ _id: c._id, name: c.name, stage: c.stage, tasks: c.tasks.filter((t) => t.member === req.user) }))
        .sort((a, b) => b.tasks.filter((t) => !t.done).length - a.tasks.filter((t) => !t.done).length);
      return res.json({ me, accounts });
    }
    if (req.role === 'client') {
      const c = await Company.findById(req.account.companyId).select('name stage tasks website').lean();
      if (!c) return res.json({ me, account: null });
      return res.json({ me, account: { name: c.name, stage: c.stage, website: c.website, tasks: c.tasks.map((t) => ({ _id: t._id, member: t.member, task: t.task, done: t.done, updatedAt: t.updatedAt })) } });
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

export default router;
