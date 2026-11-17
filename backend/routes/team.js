// Team members (admin only): add, change, reset password, delete. Each gets a login (email + password).
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { Attendance, HrDocument, HrFile, HrTask, Leave, Payslip, Target, WeeklyReport } from '../hr-models.js';
import { UPLOAD_DIR, photoFor, removeFile } from './files.js';
import { openLifecycleTasks, reassignTask } from '../lifecycle.js';
import { Company, User, hashPassword } from '../models.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';

const router = Router();
const EMP = ['code', 'department', 'phone', 'personalEmail', 'dob', 'gender', 'address', 'joiningDate', 'emergencyName', 'emergencyPhone', 'pan', 'bankName', 'bankAccount', 'ifsc', 'notes'];
const SAL = ['basic', 'hra', 'allowances', 'pt', 'tds', 'otherDeductions'];
const empFields = (b = {}, old = {}) => Object.fromEntries(EMP.map((k) => [k, b[k] !== undefined ? str(b[k], k === 'address' || k === 'notes' ? 1000 : 150) : old[k] || '']));
const salFields = (b = {}, old = {}) => Object.fromEntries(SAL.map((k) => [k, b[k] !== undefined && b[k] !== '' ? Math.max(0, Math.round(Number(b[k]) || 0)) : old[k] || 0]));
const todayStr = () => new Date().toISOString().slice(0, 10);
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
    const employee = empFields(req.body?.employee);
    if (employee.code && (await User.exists({ role: 'team', 'employee.code': employee.code }))) throw fail(409, 'This employee ID is already used');
    const u = await User.create({
      name,
      email,
      role: 'team',
      title: str(req.body?.title, 100),
      passwordHash: hashPassword(strongEnough(req.body?.password)),
      mustChangePassword: true, // they set their own password at the first login
      employee,
      salary: salFields(req.body?.salary),
      history: [{ date: employee.joiningDate || todayStr(), text: `Joined${str(req.body?.title, 100) ? ` as ${str(req.body.title, 100)}` : ''}` }],
    });
    res.status(201).json(u);
  })
);

/** someone leaves: their open lifecycle tasks (estimate, execution, posts ...) must go to another employee first */
async function handOver(req, u) {
  const open = await openLifecycleTasks(u._id);
  if (!open.length) return 0;
  const to = req.body?.handoverTo;
  if (!to || String(to) === String(u._id)) throw Object.assign(fail(409, `${u.name} has ${open.length} open client task(s). Choose who takes them over.`), { extra: { handover: open.length } });
  for (const t of open) await reassignTask(t._id, to, req.user);
  return open.length;
}

router.put(
  '/:id',
  ah(async (req, res) => {
    const u = await User.findOne({ _id: checkId(req.params.id), role: 'team' });
    if (!u) throw fail(404, 'Team member not found');
    const old = u.name;
    const oldTitle = u.title;
    const oldGross = (u.salary?.basic || 0) + (u.salary?.hra || 0) + (u.salary?.allowances || 0);
    if (req.body?.name !== undefined && str(req.body.name, 80)) u.name = str(req.body.name, 80);
    if (req.body?.title !== undefined) u.title = str(req.body.title, 100);
    if (req.body?.employee && typeof req.body.employee === 'object') {
      const e = empFields(req.body.employee, u.toObject().employee || {});
      if (e.code && (await User.exists({ _id: { $ne: u._id }, role: 'team', 'employee.code': e.code }))) throw fail(409, 'This employee ID is already used');
      u.employee = e;
    }
    if (req.body?.photo !== undefined) {
      const photo = await photoFor(req.body.photo, u._id);
      if (u.photo && u.photo !== photo) await removeFile(u.photo); // old photo goes
      u.photo = photo;
    }
    if (req.body?.salary && typeof req.body.salary === 'object') u.salary = salFields(req.body.salary, u.toObject().salary || {});
    // job history: designation and salary changes are noted automatically
    const newGross = (u.salary?.basic || 0) + (u.salary?.hra || 0) + (u.salary?.allowances || 0);
    if (u.title !== oldTitle) u.history.push({ date: todayStr(), text: `Designation changed${oldTitle ? ` from ${oldTitle}` : ''} to ${u.title || '(none)'}` });
    if (newGross !== oldGross && oldGross) u.history.push({ date: todayStr(), text: `Monthly gross salary changed from ₹${oldGross} to ₹${newGross}` });
    if (req.body?.historyNote) u.history.push({ date: todayStr(), text: str(req.body.historyNote, 300) });
    if (req.body?.email !== undefined) {
      const email = validEmail(req.body.email);
      if (!email) throw fail(400, 'Email is not valid');
      if (email !== u.email && (await User.exists({ email }))) throw fail(409, 'This email already has a login');
      u.email = email;
    }
    if (req.body?.active !== undefined && u.active !== (req.body.active === true)) {
      if (req.body.active !== true) await handOver(req, u);
      u.active = req.body.active === true;
      u.history.push({ date: todayStr(), text: u.active ? 'Activated again (can log in)' : 'Deactivated (left the company / login turned off)' });
    }
    if (req.body?.password) {
      u.passwordHash = hashPassword(strongEnough(req.body.password));
      u.mustChangePassword = true; // reset by the admin: they choose a new one at the next login
    }
    await u.save();
    // renamed: their tasks follow them
    if (old !== u.name) {
      await Company.updateMany({ 'tasks.member': old }, { $set: { 'tasks.$[t].member': u.name } }, { arrayFilters: [{ 't.member': old }] });
      await Company.updateMany({ team: old }, { $set: { 'team.$': u.name } });
    }
    res.json(u);
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const found = await User.findOne({ _id: checkId(req.params.id), role: 'team' });
    if (!found) throw fail(404, 'Team member not found');
    await handOver(req, found);
    const u = await User.findOneAndDelete({ _id: found._id });
    if (!u) throw fail(404, 'Team member not found');
    // their HR records go with them (attendance, leaves, tasks, reports, targets, documents, slips, files).
    // To keep the history, turn the login off instead of deleting.
    const files = await HrFile.find({ owner: u._id }).select('path').lean();
    await Promise.all([Attendance, Leave, HrTask, WeeklyReport, Target, HrDocument, Payslip].map((M) => M.deleteMany({ user: u._id })));
    await HrFile.deleteMany({ owner: u._id });
    await Promise.all(files.map((f) => fs.unlink(path.join(UPLOAD_DIR, path.basename(f.path))).catch(() => {})));
    res.json({ ok: true, name: u.name }); // their tasks on accounts (Pipeline) stay, so you can give them to someone else
  })
);

export default router;
