// Team members (admin only): add, change, reset password, delete. Each gets a login (email + password).
import { Router } from 'express';
import { Company, User, hashPassword } from '../models.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';

const router = Router();
export const strongEnough = (pw) => {
  const p = String(pw || '');
  if (p.length < 8) throw fail(400, 'Password must be at least 8 characters');
  return p;
};

router.get(
  '/',
  ah(async (_req, res) => {
    const members = await User.find({ role: 'team' }).sort({ name: 1 }).lean();
    const companies = await Company.find({ 'tasks.0': { $exists: true } }).select('tasks').lean();
    const open = {};
    for (const c of companies) for (const t of c.tasks) if (!t.done) open[t.member] = (open[t.member] || 0) + 1;
    res.json(members.map((m) => ({ ...m, passwordHash: undefined, openTasks: open[m.name] || 0 })));
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const name = str(req.body?.name, 80);
    const email = validEmail(req.body?.email);
    if (!name || !email) throw fail(400, 'Name and a valid email are required');
    if (await User.exists({ email })) throw fail(409, 'This email already has a login');
    if (await User.exists({ role: 'team', name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) throw fail(409, 'A team member with this name already exists');
    const u = await User.create({ name, email, role: 'team', title: str(req.body?.title, 100), passwordHash: hashPassword(strongEnough(req.body?.password)) });
    res.status(201).json(u);
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const u = await User.findOne({ _id: checkId(req.params.id), role: 'team' });
    if (!u) throw fail(404, 'Team member not found');
    const old = u.name;
    if (req.body?.name !== undefined && str(req.body.name, 80)) u.name = str(req.body.name, 80);
    if (req.body?.title !== undefined) u.title = str(req.body.title, 100);
    if (req.body?.email !== undefined) {
      const email = validEmail(req.body.email);
      if (!email) throw fail(400, 'Email is not valid');
      if (email !== u.email && (await User.exists({ email }))) throw fail(409, 'This email already has a login');
      u.email = email;
    }
    if (req.body?.active !== undefined) u.active = req.body.active === true;
    if (req.body?.password) u.passwordHash = hashPassword(strongEnough(req.body.password));
    await u.save();
    // renamed: their tasks follow them
    if (old !== u.name) await Company.updateMany({ 'tasks.member': old }, { $set: { 'tasks.$[t].member': u.name } }, { arrayFilters: [{ 't.member': old }] });
    res.json(u);
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const u = await User.findOneAndDelete({ _id: checkId(req.params.id), role: 'team' });
    if (!u) throw fail(404, 'Team member not found');
    res.json({ ok: true, name: u.name }); // their tasks stay on the accounts (you can reassign them)
  })
);

export default router;
