// Employee portal - what a team member does for themselves after logging in.
// Only their own data. Everything about others, salaries and approvals stays with the admin.
import { Router } from 'express';
import { Attendance, HrDocument, HrTask, Leave, Payslip, Target, WeeklyReport } from '../hr-models.js';
import { isDay, isMonth, weekOf } from '../hr-calc.js';
import { balanceFor, holidayMap, leaveDays, publicEmployee, registerFor, timeField, today } from '../hr-util.js';
import { fileRefs, photoFor, removeFile } from './files.js';
import { User } from '../models.js';
import { companyInfo } from './hr.js';
import { ah, checkId, fail, str } from '../utils.js';

const router = Router();
router.use((req, _res, next) => {
  if (req.role !== 'team') return next(fail(403, 'This is for employees'));
  if (req.account.mustChangePassword) return next(fail(403, 'Please change your password first'));
  next();
});
const me = (req) => req.account;

// first screen: today, open tasks, leave balance, this month's target, this week's report
router.get(
  '/home',
  ah(async (req, res) => {
    const u = me(req);
    const day = today();
    const [att, openTasks, balance, target, report, pendingLeaves] = await Promise.all([
      Attendance.findOne({ user: u._id, day }).lean(),
      HrTask.countDocuments({ user: u._id, status: { $ne: 'done' } }),
      balanceFor(u),
      Target.findOne({ user: u._id, month: day.slice(0, 7) }).lean(),
      WeeklyReport.findOne({ user: u._id, week: weekOf(day) }).select('updatedAt').lean(),
      Leave.countDocuments({ user: u._id, status: 'pending' }),
    ]);
    res.json({
      me: publicEmployee(u),
      today: day,
      attendance: att ? { checkIn: att.checkIn, checkOut: att.checkOut } : null,
      openTasks,
      balance,
      pendingLeaves,
      target: target ? { title: target.title, done: target.items.filter((i) => i.done).length, total: target.items.length } : null,
      reportThisWeek: report ? report.updatedAt : null,
      week: weekOf(day),
    });
  })
);

router.get('/profile', ah(async (req, res) => res.json({ ...publicEmployee(me(req)), photo: me(req).photo || '', history: me(req).history || [] })));

// Employees may correct their own personal details and photo. Job, salary, bank and ID details stay with the admin.
export const SELF_FIELDS = ['phone', 'personalEmail', 'dob', 'gender', 'address', 'emergencyName', 'emergencyPhone'];
const LABEL = { phone: 'phone', personalEmail: 'personal email', dob: 'date of birth', gender: 'gender', address: 'address', emergencyName: 'emergency contact name', emergencyPhone: 'emergency contact phone' };
router.put(
  '/profile',
  ah(async (req, res) => {
    const u = await User.findById(me(req)._id);
    const e = u.toObject().employee || {};
    const changed = [];
    for (const k of SELF_FIELDS) {
      if (req.body?.[k] === undefined) continue;
      const v = str(req.body[k], k === 'address' ? 1000 : 150);
      if (v && (k === 'phone' || k === 'emergencyPhone') && !/^[+\d][\d\s()-]{6,19}$/.test(v)) throw fail(400, `Enter a valid ${LABEL[k]}`);
      if (v && k === 'personalEmail' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw fail(400, 'Enter a valid personal email');
      if (v && k === 'dob' && (!isDay(v) || v > today() || v < '1940-01-01')) throw fail(400, 'Enter a valid date of birth');
      if ((e[k] || '') !== v) {
        e[k] = v;
        changed.push(LABEL[k]);
      }
    }
    if (changed.length) {
      u.employee = e;
      u.history.push({ date: today(), text: `Updated their own ${changed.join(', ')}` });
    }
    if (req.body?.photo !== undefined) {
      const photo = await photoFor(req.body.photo, u._id);
      if (u.photo && u.photo !== photo) await removeFile(u.photo);
      u.photo = photo;
    }
    await u.save();
    res.json({ ...publicEmployee(u.toObject()), photo: u.photo || '', history: u.history || [] });
  })
);

/* ---------------- attendance ---------------- */
router.post(
  '/check-in',
  ah(async (req, res) => {
    const day = today();
    const a = await Attendance.findOneAndUpdate(
      { user: me(req)._id, day },
      { $setOnInsert: { user: me(req)._id, day, checkIn: new Date() } },
      { upsert: true, new: true }
    );
    if (!a.checkIn) await Attendance.updateOne({ _id: a._id }, { $set: { checkIn: new Date() } }); // row made by a request earlier
    res.json(await Attendance.findById(a._id).lean());
  })
);

router.post(
  '/check-out',
  ah(async (req, res) => {
    const a = await Attendance.findOne({ user: me(req)._id, day: today() });
    if (!a?.checkIn) throw fail(400, 'Check in first');
    a.checkOut = new Date(); // checking out again updates the time
    await a.save();
    res.json(a);
  })
);

router.get(
  '/attendance',
  ah(async (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : today().slice(0, 7);
    res.json(await registerFor(me(req), month));
  })
);

// forgot to check out / wrong time / missed a day: ask the admin to fix it
router.post(
  '/attendance/request',
  ah(async (req, res) => {
    const day = str(req.body?.day, 10);
    if (!isDay(day) || day > today()) throw fail(400, 'Choose a day up to today');
    const checkIn = timeField(day, req.body?.checkIn);
    const checkOut = timeField(day, req.body?.checkOut);
    if (!checkIn) throw fail(400, 'Enter the check-in time');
    if (checkOut && checkOut <= checkIn) throw fail(400, 'Check-out must be after check-in');
    const note = str(req.body?.note, 500);
    if (!note) throw fail(400, 'Write why the time needs fixing');
    const a = await Attendance.findOneAndUpdate(
      { user: me(req)._id, day },
      { $set: { request: { checkIn, checkOut: checkOut || null, note, status: 'pending', at: new Date() } }, $setOnInsert: { user: me(req)._id, day } },
      { upsert: true, new: true }
    );
    res.status(201).json(a);
  })
);

/* ---------------- leaves ---------------- */
router.get(
  '/leaves',
  ah(async (req, res) => {
    const year = +today().slice(0, 4);
    const [list, balance, holidays] = await Promise.all([
      Leave.find({ user: me(req)._id }).sort({ from: -1 }).limit(100).lean(),
      balanceFor(me(req), year),
      holidayMap(`${year}-01-01`, `${year}-12-31`),
    ]);
    res.json({ list, balance, holidays: [...holidays].map(([day, name]) => ({ day, name })) });
  })
);

router.post(
  '/leaves',
  ah(async (req, res) => {
    const from = str(req.body?.from, 10);
    const to = str(req.body?.to, 10) || from;
    const half = req.body?.half === true;
    const days = await leaveDays(from, to, half);
    const clash = await Leave.exists({ user: me(req)._id, status: { $in: ['pending', 'approved'] }, from: { $lte: to }, to: { $gte: from } });
    if (clash) throw fail(409, 'You already have a leave on these dates');
    const reason = str(req.body?.reason, 1000);
    if (!reason) throw fail(400, 'Write a reason');
    const l = await Leave.create({ user: me(req)._id, from, to, half, days, reason });
    res.status(201).json(l);
  })
);

router.delete(
  '/leaves/:id',
  ah(async (req, res) => {
    const l = await Leave.findOneAndUpdate({ _id: checkId(req.params.id), user: me(req)._id, status: 'pending' }, { $set: { status: 'cancelled' } }, { new: true });
    if (!l) throw fail(404, 'Only a pending leave can be cancelled');
    res.json(l);
  })
);

/* ---------------- tasks ---------------- */
router.get('/tasks', ah(async (req, res) => res.json(await HrTask.find({ user: me(req)._id }).sort({ status: 1, due: 1, createdAt: -1 }).limit(300).lean())));

router.put(
  '/tasks/:id',
  ah(async (req, res) => {
    const status = str(req.body?.status, 10);
    if (!['todo', 'doing', 'done'].includes(status)) throw fail(400, 'Unknown status');
    const lc = await HrTask.findOne({ _id: checkId(req.params.id), user: me(req)._id }).select('step deal').lean();
    if (lc?.step && status === 'done') throw fail(400, lc.deal ? 'Finish this step from its form (Open deal) - it needs the proof first' : 'This task finishes by itself when the company moves to the next stage');
    const t = await HrTask.findOneAndUpdate({ _id: checkId(req.params.id), user: me(req)._id }, { $set: { status, doneAt: status === 'done' ? new Date() : null } }, { new: true });
    if (!t) throw fail(404, 'Task not found');
    res.json(t);
  })
);

router.post(
  '/tasks/:id/comments',
  ah(async (req, res) => {
    const text = str(req.body?.text, 2000);
    if (!text) throw fail(400, 'Write a comment');
    const t = await HrTask.findOneAndUpdate({ _id: checkId(req.params.id), user: me(req)._id }, { $push: { comments: { author: req.user, text } } }, { new: true });
    if (!t) throw fail(404, 'Task not found');
    res.status(201).json(t);
  })
);

/* ---------------- weekly reports ---------------- */
router.get('/reports', ah(async (req, res) => res.json({ week: weekOf(today()), list: await WeeklyReport.find({ user: me(req)._id }).sort({ week: -1 }).limit(60).lean() })));

// write / update the report of a week (this week or a past one)
router.put(
  '/reports/:week',
  ah(async (req, res) => {
    const week = str(req.params.week, 10);
    if (!isDay(week) || weekOf(week) !== week || week > weekOf(today())) throw fail(400, 'Choose a week up to this week');
    const text = str(req.body?.text, 20000);
    const files = await fileRefs(req.body?.files, me(req)._id);
    if (!text && !files.length) throw fail(400, 'Write the report or attach a file');
    const r = await WeeklyReport.findOneAndUpdate({ user: me(req)._id, week }, { $set: { text, files } }, { upsert: true, new: true });
    res.json(r);
  })
);

/* ---------------- monthly targets (set by the admin, ticked by the employee) ---------------- */
router.get(
  '/targets',
  ah(async (req, res) => {
    const filter = { user: me(req)._id };
    if (isMonth(req.query.month)) filter.month = req.query.month;
    res.json(await Target.find(filter).sort({ month: -1 }).limit(24).lean());
  })
);

router.put(
  '/targets/:id/items/:itemId',
  ah(async (req, res) => {
    const done = req.body?.done === true;
    const t = await Target.findOneAndUpdate(
      { _id: checkId(req.params.id), user: me(req)._id, 'items._id': checkId(req.params.itemId) },
      { $set: { 'items.$.done': done, 'items.$.doneAt': done ? new Date() : null } },
      { new: true }
    );
    if (!t) throw fail(404, 'Target not found');
    res.json(t);
  })
);

// attach proof / achievement files to a target
router.post(
  '/targets/:id/files',
  ah(async (req, res) => {
    const files = await fileRefs(req.body?.files, me(req)._id);
    if (!files.length) throw fail(400, 'Attach a file');
    const t = await Target.findOneAndUpdate({ _id: checkId(req.params.id), user: me(req)._id }, { $push: { files: { $each: files } } }, { new: true });
    if (!t) throw fail(404, 'Target not found');
    res.json(t);
  })
);

/* ---------------- documents ---------------- */
router.get('/documents', ah(async (req, res) => res.json(await HrDocument.find({ user: me(req)._id }).sort({ createdAt: -1 }).lean())));

router.post(
  '/documents',
  ah(async (req, res) => {
    const name = str(req.body?.name, 200);
    const link = str(req.body?.link, 1000);
    const [file] = await fileRefs(req.body?.file ? [req.body.file] : [], me(req)._id);
    if (!name) throw fail(400, 'Give the document a name');
    if (!file && !/^https?:\/\//i.test(link)) throw fail(400, 'Attach a file or paste a link');
    res.status(201).json(await HrDocument.create({ user: me(req)._id, name, category: str(req.body?.category, 60) || 'Other', file, link: file ? '' : link, uploadedBy: req.user }));
  })
);

/* ---------------- payslips (only the ones the admin finalised) ---------------- */
router.get(
  '/payslips',
  ah(async (req, res) => {
    const list = await Payslip.find({ user: me(req)._id, status: { $in: ['final', 'paid'] } }).sort({ month: -1 }).limit(36).lean();
    res.json({ company: await companyInfo(), list });
  })
);

export default router;
