// HR - admin side: attendance, leave approvals, holidays, tasks, weekly reports, targets, documents, payroll.
// Employees themselves are added / changed in routes/team.js (login + all their details).
import { Router } from 'express';
import mongoose from 'mongoose';
import { User, getSetting, setSetting } from '../models.js';
import { Attendance, HrDocument, HrTask, Holiday, Leave, Payslip, Target, WeeklyReport } from '../hr-models.js';
import { isDay, isMonth, payroll, splitLeave, weekOf } from '../hr-calc.js';
import { balanceFor, leaveDays, registerFor, timeField, today } from '../hr-util.js';
import { fileRefs } from './files.js';
import { ah, checkId, fail, str } from '../utils.js';

const router = Router();
const employees = (extra = {}) => User.find({ role: 'team', ...extra }).sort({ name: 1 }).lean();
async function employee(idv) {
  const u = await User.findOne({ _id: checkId(idv), role: 'team' }).lean();
  if (!u) throw fail(404, 'Employee not found');
  return u;
}
const names = async () => new Map((await employees()).map((u) => [String(u._id), u.name]));
const withName = (list, map) => list.map((x) => ({ ...x, name: map.get(String(x.user)) || '(deleted)' }));

// overview: who is in today, what waits for the admin
router.get(
  '/overview',
  ah(async (_req, res) => {
    const day = today();
    const [list, todayRows, pendingLeaves, pendingFixes, openTasks] = await Promise.all([
      employees(),
      Attendance.find({ day }).lean(),
      Leave.countDocuments({ status: 'pending' }),
      Attendance.countDocuments({ 'request.status': 'pending' }),
      HrTask.aggregate([{ $match: { status: { $ne: 'done' } } }, { $group: { _id: '$user', n: { $sum: 1 } } }]),
    ]);
    const att = new Map(todayRows.map((a) => [String(a.user), a]));
    const tasks = new Map(openTasks.map((t) => [String(t._id), t.n]));
    const onLeave = await Leave.find({ status: 'approved', from: { $lte: day }, to: { $gte: day } }).select('user').lean();
    const leaveSet = new Set(onLeave.map((l) => String(l.user)));
    res.json({
      today: day,
      pendingLeaves,
      pendingFixes,
      people: list.map((u) => {
        const a = att.get(String(u._id));
        return { _id: u._id, name: u.name, title: u.title, active: u.active, photo: u.photo || '', code: u.employee?.code || '', checkIn: a?.checkIn || null, checkOut: a?.checkOut || null, onLeave: leaveSet.has(String(u._id)), openTasks: tasks.get(String(u._id)) || 0 };
      }),
    });
  })
);

// one employee: everything about them
router.get(
  '/employees/:id',
  ah(async (req, res) => {
    const u = await employee(req.params.id);
    const [balance, documents] = await Promise.all([balanceFor(u), HrDocument.find({ user: u._id }).sort({ createdAt: -1 }).lean()]);
    res.json({ ...u, passwordHash: undefined, balance, documents });
  })
);

/* ---------------- attendance ---------------- */
router.get(
  '/attendance',
  ah(async (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : today().slice(0, 7);
    const people = mongoose.isValidObjectId(req.query.user) ? [await employee(req.query.user)] : await employees({ active: true });
    const out = [];
    for (const u of people) out.push({ _id: u._id, name: u.name, ...(await registerFor(u, month)) });
    res.json({ month, people: out });
  })
);

// admin sets / fixes the times of a day
router.put(
  '/attendance',
  ah(async (req, res) => {
    const u = await employee(req.body?.user);
    const day = str(req.body?.day, 10);
    if (!isDay(day)) throw fail(400, 'Choose a day');
    const checkIn = timeField(day, req.body?.checkIn);
    const checkOut = timeField(day, req.body?.checkOut);
    if (checkIn && checkOut && checkOut <= checkIn) throw fail(400, 'Check-out must be after check-in');
    if (!checkIn && checkOut) throw fail(400, 'Enter the check-in time too');
    const set = { editedBy: req.user };
    if (checkIn !== undefined) set.checkIn = checkIn;
    if (checkOut !== undefined) set.checkOut = checkOut;
    if (req.body?.note !== undefined) set.note = str(req.body.note, 500);
    const a = await Attendance.findOneAndUpdate({ user: u._id, day }, { $set: set, $setOnInsert: { user: u._id, day } }, { upsert: true, new: true });
    res.json(a);
  })
);

router.get(
  '/attendance/requests',
  ah(async (_req, res) => {
    const list = await Attendance.find({ 'request.status': 'pending' }).sort({ day: -1 }).lean();
    res.json(withName(list, await names()));
  })
);

router.post(
  '/attendance/:id/decide',
  ah(async (req, res) => {
    const a = await Attendance.findOne({ _id: checkId(req.params.id), 'request.status': 'pending' });
    if (!a) throw fail(404, 'Request not found');
    if (req.body?.approve === true) {
      a.checkIn = a.request.checkIn;
      a.checkOut = a.request.checkOut || a.checkOut || null;
      a.editedBy = req.user;
      a.request.status = 'approved';
    } else a.request.status = 'rejected';
    await a.save();
    res.json(a);
  })
);

/* ---------------- leaves ---------------- */
router.get(
  '/leaves',
  ah(async (req, res) => {
    const filter = {};
    if (['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status)) filter.status = req.query.status;
    if (mongoose.isValidObjectId(req.query.user)) filter.user = req.query.user;
    const list = await Leave.find(filter).sort({ status: 1, from: -1 }).limit(300).lean();
    const map = await names();
    // balance next to each pending request, so the admin sees what will be paid
    const people = new Map();
    for (const l of list.filter((x) => x.status === 'pending')) if (!people.has(String(l.user))) people.set(String(l.user), await User.findById(l.user).lean());
    const out = [];
    for (const l of withName(list, map)) {
      const u = people.get(String(l.user));
      out.push(u ? { ...l, balance: await balanceFor(u, +l.from.slice(0, 4)) } : l);
    }
    res.json(out);
  })
);

router.post(
  '/leaves/:id/decide',
  ah(async (req, res) => {
    const l = await Leave.findOne({ _id: checkId(req.params.id), status: 'pending' });
    if (!l) throw fail(404, 'Leave request not found');
    l.adminNote = str(req.body?.note, 500);
    l.decidedAt = new Date();
    if (req.body?.approve === true) {
      const u = await User.findById(l.user).lean();
      const bal = await balanceFor(u, +l.from.slice(0, 4));
      Object.assign(l, splitLeave(l.days, bal.available), { status: 'approved' });
    } else l.status = 'rejected';
    await l.save();
    res.json(l);
  })
);

// admin adds a leave for someone (approved straight away)
router.post(
  '/leaves',
  ah(async (req, res) => {
    const u = await employee(req.body?.user);
    const from = str(req.body?.from, 10);
    const to = str(req.body?.to, 10) || from;
    const half = req.body?.half === true;
    const days = await leaveDays(from, to, half);
    if (await Leave.exists({ user: u._id, status: { $in: ['pending', 'approved'] }, from: { $lte: to }, to: { $gte: from } })) throw fail(409, 'There is already a leave on these dates');
    const bal = await balanceFor(u, +from.slice(0, 4));
    const l = await Leave.create({ user: u._id, from, to, half, days, reason: str(req.body?.reason, 1000) || 'Added by admin', status: 'approved', decidedAt: new Date(), ...splitLeave(days, bal.available) });
    res.status(201).json(l);
  })
);

/* ---------------- holidays ---------------- */
router.get(
  '/holidays',
  ah(async (req, res) => {
    const year = /^\d{4}$/.test(req.query.year || '') ? req.query.year : today().slice(0, 4);
    res.json(await Holiday.find({ day: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }).sort({ day: 1 }).lean());
  })
);
router.post(
  '/holidays',
  ah(async (req, res) => {
    const day = str(req.body?.day, 10);
    const name = str(req.body?.name, 100);
    if (!isDay(day) || !name) throw fail(400, 'Choose a date and write the holiday name');
    res.status(201).json(await Holiday.findOneAndUpdate({ day }, { $set: { name } }, { upsert: true, new: true }));
  })
);
router.delete(
  '/holidays/:id',
  ah(async (req, res) => {
    if (!(await Holiday.findByIdAndDelete(checkId(req.params.id)))) throw fail(404, 'Holiday not found');
    res.json({ ok: true });
  })
);

/* ---------------- tasks ---------------- */
const taskBody = (b = {}) => {
  const out = {};
  if (b.title !== undefined) out.title = str(b.title, 300);
  if (b.details !== undefined) out.details = str(b.details, 5000);
  if (b.due !== undefined) out.due = isDay(b.due) ? b.due : '';
  if (b.priority !== undefined) out.priority = ['low', 'normal', 'high'].includes(b.priority) ? b.priority : 'normal';
  if (b.status !== undefined) {
    if (!['todo', 'doing', 'done'].includes(b.status)) throw fail(400, 'Unknown status');
    out.status = b.status;
    out.doneAt = b.status === 'done' ? new Date() : null;
  }
  return out;
};
router.get(
  '/tasks',
  ah(async (req, res) => {
    const filter = {};
    if (mongoose.isValidObjectId(req.query.user)) filter.user = req.query.user;
    if (['todo', 'doing', 'done'].includes(req.query.status)) filter.status = req.query.status;
    else if (req.query.status === 'open') filter.status = { $ne: 'done' };
    const list = await HrTask.find(filter).sort({ status: 1, due: 1, createdAt: -1 }).limit(500).lean();
    res.json(withName(list, await names()));
  })
);
router.post(
  '/tasks',
  ah(async (req, res) => {
    const u = await employee(req.body?.user);
    const body = taskBody(req.body);
    if (!body.title) throw fail(400, 'Write the task');
    res.status(201).json(await HrTask.create({ ...body, user: u._id }));
  })
);
router.put(
  '/tasks/:id',
  ah(async (req, res) => {
    const body = taskBody(req.body);
    if (req.body?.user !== undefined) body.user = (await employee(req.body.user))._id;
    if (body.title === '') throw fail(400, 'Write the task');
    const t = await HrTask.findByIdAndUpdate(checkId(req.params.id), { $set: body }, { new: true });
    if (!t) throw fail(404, 'Task not found');
    res.json(t);
  })
);
router.post(
  '/tasks/:id/comments',
  ah(async (req, res) => {
    const text = str(req.body?.text, 2000);
    if (!text) throw fail(400, 'Write a comment');
    const t = await HrTask.findByIdAndUpdate(checkId(req.params.id), { $push: { comments: { author: req.user, text } } }, { new: true });
    if (!t) throw fail(404, 'Task not found');
    res.status(201).json(t);
  })
);
router.delete(
  '/tasks/:id',
  ah(async (req, res) => {
    if (!(await HrTask.findByIdAndDelete(checkId(req.params.id)))) throw fail(404, 'Task not found');
    res.json({ ok: true });
  })
);

/* ---------------- weekly reports ---------------- */
router.get(
  '/reports',
  ah(async (req, res) => {
    const week = isDay(req.query.week) ? weekOf(req.query.week) : weekOf(today());
    const [people, list] = await Promise.all([employees({ active: true }), WeeklyReport.find({ week }).lean()]);
    const byUser = new Map(list.map((r) => [String(r.user), r]));
    res.json({ week, people: people.map((u) => ({ _id: u._id, name: u.name, report: byUser.get(String(u._id)) || null })) });
  })
);
router.get(
  '/reports/user/:id',
  ah(async (req, res) => {
    const u = await employee(req.params.id);
    res.json(await WeeklyReport.find({ user: u._id }).sort({ week: -1 }).limit(60).lean());
  })
);
router.put(
  '/reports/:id/note',
  ah(async (req, res) => {
    const r = await WeeklyReport.findByIdAndUpdate(checkId(req.params.id), { $set: { adminNote: str(req.body?.note, 2000) } }, { new: true });
    if (!r) throw fail(404, 'Report not found');
    res.json(r);
  })
);

/* ---------------- monthly targets ---------------- */
const items = (list) => (Array.isArray(list) ? list : [])
  .map((i) => (typeof i === 'string' ? { text: str(i, 500) } : { _id: mongoose.isValidObjectId(i?._id) ? i._id : undefined, text: str(i?.text, 500), done: i?.done === true }))
  .filter((i) => i.text)
  .slice(0, 100);
router.get(
  '/targets',
  ah(async (req, res) => {
    const filter = {};
    filter.month = isMonth(req.query.month) ? req.query.month : today().slice(0, 7);
    if (mongoose.isValidObjectId(req.query.user)) filter.user = req.query.user;
    res.json(withName(await Target.find(filter).sort({ createdAt: 1 }).lean(), await names()));
  })
);
router.post(
  '/targets',
  ah(async (req, res) => {
    const u = await employee(req.body?.user);
    const month = str(req.body?.month, 7);
    if (!isMonth(month)) throw fail(400, 'Choose the month');
    const list = items(req.body?.items);
    const files = await fileRefs(req.body?.files, u._id);
    if (!list.length && !files.length) throw fail(400, 'Add at least one target point or a file');
    res.status(201).json(await Target.create({ user: u._id, month, title: str(req.body?.title, 200), items: list, files, note: str(req.body?.note, 2000) }));
  })
);
router.put(
  '/targets/:id',
  ah(async (req, res) => {
    const t = await Target.findById(checkId(req.params.id));
    if (!t) throw fail(404, 'Target not found');
    if (req.body?.title !== undefined) t.title = str(req.body.title, 200);
    if (req.body?.note !== undefined) t.note = str(req.body.note, 2000);
    if (req.body?.items !== undefined) {
      const old = new Map(t.items.map((i) => [String(i._id), i]));
      t.items = items(req.body.items).map((i) => {
        const was = i._id && old.get(String(i._id));
        return was ? { _id: was._id, text: i.text, done: req.body.keepTicks === false ? i.done : was.done, doneAt: was.doneAt } : { text: i.text, done: i.done };
      });
    }
    if (req.body?.files !== undefined) t.files = await fileRefs(req.body.files, t.user);
    await t.save();
    res.json(t);
  })
);
router.delete(
  '/targets/:id',
  ah(async (req, res) => {
    if (!(await Target.findByIdAndDelete(checkId(req.params.id)))) throw fail(404, 'Target not found');
    res.json({ ok: true });
  })
);

/* ---------------- documents ---------------- */
router.get(
  '/documents',
  ah(async (req, res) => {
    const filter = mongoose.isValidObjectId(req.query.user) ? { user: req.query.user } : {};
    res.json(withName(await HrDocument.find(filter).sort({ createdAt: -1 }).limit(500).lean(), await names()));
  })
);
router.post(
  '/documents',
  ah(async (req, res) => {
    const u = await employee(req.body?.user);
    const name = str(req.body?.name, 200);
    const link = str(req.body?.link, 1000);
    const [file] = await fileRefs(req.body?.file ? [req.body.file] : [], u._id);
    if (!name) throw fail(400, 'Give the document a name');
    if (!file && !/^https?:\/\//i.test(link)) throw fail(400, 'Attach a file or paste a link');
    res.status(201).json(await HrDocument.create({ user: u._id, name, category: str(req.body?.category, 60) || 'Other', file, link: file ? '' : link, uploadedBy: req.user }));
  })
);
router.delete(
  '/documents/:id',
  ah(async (req, res) => {
    if (!(await HrDocument.findByIdAndDelete(checkId(req.params.id)))) throw fail(404, 'Document not found');
    res.json({ ok: true });
  })
);

/* ---------------- payroll ---------------- */
// company name + address printed on payslips
export const companyInfo = async () => ({ name: 'Geek Creative Agency', address: '', ...((await getSetting('payslipCompany', null)) || {}) });
router.get('/company', ah(async (_req, res) => res.json(await companyInfo())));
router.put(
  '/company',
  ah(async (req, res) => {
    const v = { name: str(req.body?.name, 150) || 'Geek Creative Agency', address: str(req.body?.address, 500) };
    await setSetting('payslipCompany', v);
    res.json(v);
  })
);

// the month for everyone: the saved slip if there is one, else what the CRM works out now
router.get(
  '/payroll',
  ah(async (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : today().slice(0, 7);
    const [people, slips] = await Promise.all([employees(), Payslip.find({ month }).lean()]);
    const saved = new Map(slips.map((s) => [String(s.user), s]));
    const out = [];
    for (const u of people) {
      const s = saved.get(String(u._id));
      if (!s && !u.active) continue;
      const reg = await registerFor(u, month);
      out.push({ _id: u._id, name: u.name, title: u.title, code: u.employee?.code || '', calc: payroll({ month, summary: reg.summary, salary: u.salary || {} }), summary: reg.summary, slip: s || null });
    }
    res.json({ month, people: out });
  })
);

// make / update the slip (a snapshot). Body may change pt / tds / otherDeductions for this month only.
router.post(
  '/payroll/:user/:month',
  ah(async (req, res) => {
    const u = await employee(req.params.user);
    const month = req.params.month;
    if (!isMonth(month)) throw fail(400, 'Choose the month');
    const old = await Payslip.findOne({ user: u._id, month }).lean();
    if (old?.status === 'paid') throw fail(409, 'This slip is already marked paid');
    const reg = await registerFor(u, month);
    const salary = { ...(u.salary || {}) };
    for (const k of ['pt', 'tds', 'otherDeductions']) if (req.body?.[k] !== undefined && req.body[k] !== '') salary[k] = Math.max(0, Number(req.body[k]) || 0);
    const calc = payroll({ month, summary: reg.summary, salary });
    const status = ['draft', 'final'].includes(req.body?.status) ? req.body.status : old?.status || 'draft';
    const e = u.employee || {};
    const slip = await Payslip.findOneAndUpdate(
      { user: u._id, month },
      { $set: { ...calc, status, name: u.name, code: e.code, designation: u.title, department: e.department, bank: [e.bankName, e.bankAccount && `A/c ${e.bankAccount}`, e.ifsc].filter(Boolean).join(' · '), pan: e.pan } },
      { upsert: true, new: true }
    );
    res.json(slip);
  })
);

router.put(
  '/payroll/slip/:id',
  ah(async (req, res) => {
    const s = await Payslip.findById(checkId(req.params.id));
    if (!s) throw fail(404, 'Slip not found');
    const status = str(req.body?.status, 10);
    if (!['draft', 'final', 'paid'].includes(status)) throw fail(400, 'Unknown status');
    s.status = status;
    s.paidOn = status === 'paid' ? (isDay(req.body?.paidOn) ? req.body.paidOn : today()) : '';
    await s.save();
    res.json(s);
  })
);

router.delete(
  '/payroll/slip/:id',
  ah(async (req, res) => {
    const s = await Payslip.findOneAndDelete({ _id: checkId(req.params.id), status: { $ne: 'paid' } });
    if (!s) throw fail(404, 'Slip not found (a paid slip cannot be deleted)');
    res.json({ ok: true });
  })
);

router.get(
  '/payroll/slip/:id',
  ah(async (req, res) => {
    const s = await Payslip.findById(checkId(req.params.id)).lean();
    if (!s) throw fail(404, 'Slip not found');
    res.json({ ...s, company: await companyInfo() });
  })
);

export default router;
