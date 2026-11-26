// Needs you: decisions waiting for a person. Admin: everything. Employees: the meeting questions given to them.
import { Router } from 'express';
import { Company, Contact, Reply, getSetting, setSetting } from '../models.js';
import { Action, ManualEmail, Meeting, ScheduledEmail, KIND_LABEL, actionSettings, decide, mayAnswer, suggestMeeting, undoDecision } from '../actions.js';
import { calendarUrls, syncCalendars } from '../calendar.js';
import { ah, checkId, fail, str } from '../utils.js';

const router = Router();
const admin = (req) => {
  if (req.role !== 'admin') throw fail(403, 'Only the admin can do this');
};
const who = (req) => req.user || req.account?.name || 'admin';

async function shape(list) {
  const contacts = new Map((await Contact.find({ _id: { $in: list.map((a) => a.contact).filter(Boolean) } }).select('name email title status outcome companyId').lean()).map((c) => [String(c._id), c]));
  const companies = new Map((await Company.find({ _id: { $in: list.map((a) => a.company).filter(Boolean) } }).select('name stage').lean()).map((c) => [String(c._id), c]));
  const meetings = new Map((await Meeting.find({ _id: { $in: list.map((a) => a.meeting).filter(Boolean) } }).lean()).map((m) => [String(m._id), m]));
  const replies = new Map((await Reply.find({ _id: { $in: list.map((a) => a.reply).filter(Boolean) } }).select('subject from receivedAt').lean()).map((r) => [String(r._id), r]));
  return list.map((a) => ({
    ...a,
    contact: contacts.get(String(a.contact)) || null,
    company: companies.get(String(a.company)) || null,
    meeting: meetings.get(String(a.meeting)) || null,
    reply: replies.get(String(a.reply)) || null,
    undo: undefined,
    canUndo: Boolean(a.undo),
  }));
}

// open decisions (?status=done for the last decided ones)
router.get(
  '/',
  ah(async (req, res) => {
    const done = req.query.status === 'done';
    const filter = { status: done ? { $in: ['done', 'dismissed'] } : 'open' };
    if (req.role !== 'admin') Object.assign(filter, { kind: { $ne: 'reply' }, assignees: req.account?._id });
    const list = await Action.find(filter).sort(done ? { decidedAt: -1 } : { createdAt: 1 }).limit(done ? 50 : 300).lean();
    res.json({ items: await shape(list), settings: await actionSettings() });
  })
);

router.get(
  '/count',
  ah(async (req, res) => {
    const filter = { status: 'open' };
    if (req.role !== 'admin') Object.assign(filter, { kind: { $ne: 'reply' }, assignees: req.account?._id });
    const items = await Action.find(filter).select('createdAt').lean();
    res.json({ open: items.length, late: items.filter((a) => Date.now() - new Date(a.createdAt) > 2 * 86400000).length });
  })
);

router.post(
  '/:id/decide',
  ah(async (req, res) => {
    const a = await Action.findById(checkId(req.params.id));
    if (!a || !mayAnswer(req, a)) throw fail(404, 'Not found');
    const b = req.body || {};
    const body = {
      choice: str(b.choice, 30),
      date: b.date || undefined,
      at: b.at || undefined,
      reason: str(b.reason, 40) || undefined,
      body: str(b.body, 20000) || undefined,
      more: b.more === true,
      winback: b.winback === true,
      winbackBody: str(b.winbackBody, 20000) || undefined,
      winbackDate: b.winbackDate || undefined,
      notes: str(b.notes, 5000) || undefined,
      template: str(b.template, 40) || undefined,
      subject: str(b.subject, 300) || undefined,
      cc: b.cc === true,
      nextBodies: Array.isArray(b.nextBodies) ? b.nextBodies.slice(0, 3).map((x) => str(x, 20000)) : undefined,
    };
    const out = await decide(a, body, who(req));
    res.json((await shape([out.toObject()]))[0]);
  })
);

router.post(
  '/:id/undo',
  ah(async (req, res) => {
    const a = await Action.findById(checkId(req.params.id));
    if (!a || !mayAnswer(req, a)) throw fail(404, 'Not found');
    res.json((await shape([(await undoDecision(a, who(req))).toObject()]))[0]);
  })
);

// "Meeting on ..." set by hand from the lead page (admin)
router.post(
  '/meeting',
  ah(async (req, res) => {
    admin(req);
    const company = await Company.findById(checkId(req.body?.company)).lean();
    if (!company) throw fail(404, 'Company not found');
    const at = new Date(req.body?.at);
    if (Number.isNaN(at.getTime())) throw fail(400, 'Choose the meeting time');
    const contact = req.body?.contact ? await Contact.findById(checkId(req.body.contact)).lean() : await Contact.findOne({ companyId: company._id }).lean();
    const m = await Meeting.create({ company: company._id, contact: contact?._id, at, sources: ['manual'], title: str(req.body?.title, 200), by: who(req) });
    const { meetingTaskFor } = await import('../actions.js');
    await meetingTaskFor(company._id, at);
    res.status(201).json(m);
  })
);

// a company's meetings, planned follow-ups and decisions (the lead page timeline)
router.get(
  '/company/:id',
  ah(async (req, res) => {
    admin(req);
    const id = checkId(req.params.id);
    const [meetings, scheduled, actions, manual] = await Promise.all([
      Meeting.find({ company: id }).sort({ at: -1 }).lean(),
      ScheduledEmail.find({ company: id }).sort({ sendAt: -1 }).lean(),
      Action.find({ company: id }).sort({ createdAt: -1 }).limit(100).lean(),
      ManualEmail.find({ company: id }).sort({ sentAt: -1 }).limit(100).lean(),
    ]);
    res.json({ meetings, manual, scheduled: scheduled.map((s) => ({ ...s, label: KIND_LABEL[s.kind] })), actions: await shape(actions) });
  })
);

/* ---------------- planned follow-ups ---------------- */
router.get(
  '/scheduled',
  ah(async (req, res) => {
    admin(req);
    const list = await ScheduledEmail.find({ status: { $in: ['scheduled', 'held', 'failed'] } }).sort({ sendAt: 1 }).limit(500).lean();
    const contacts = new Map((await Contact.find({ _id: { $in: list.map((s) => s.contact) } }).select('name email companyId company').lean()).map((c) => [String(c._id), c]));
    const week = Date.now() + 7 * 86400000;
    res.json({ items: list.map((s) => ({ ...s, label: KIND_LABEL[s.kind], contact: contacts.get(String(s.contact)) || null })), thisWeek: list.filter((s) => s.status === 'scheduled' && new Date(s.sendAt) <= week).length });
  })
);
router.put(
  '/scheduled/:id',
  ah(async (req, res) => {
    admin(req);
    const s = await ScheduledEmail.findById(checkId(req.params.id));
    if (!s || !['scheduled', 'held', 'failed'].includes(s.status)) throw fail(404, 'Not found');
    if (req.body?.sendAt) {
      const d = new Date(req.body.sendAt);
      if (Number.isNaN(d.getTime())) throw fail(400, 'Choose a date');
      s.sendAt = d;
    }
    if (typeof req.body?.body === 'string') {
      if (!req.body.body.trim()) throw fail(400, 'The message is empty');
      s.body = req.body.body.slice(0, 20000);
    }
    if (s.status === 'failed') s.status = 'scheduled';
    await s.save();
    res.json(s);
  })
);
router.delete(
  '/scheduled/:id',
  ah(async (req, res) => {
    admin(req);
    await ScheduledEmail.updateOne({ _id: checkId(req.params.id), status: { $in: ['scheduled', 'held', 'failed'] } }, { $set: { status: 'cancelled', error: `Cancelled by ${who(req)}` } });
    res.json({ ok: true });
  })
);

/* ---------------- settings: messages, default months, calendars ---------------- */
router.get(
  '/settings',
  ah(async (req, res) => {
    admin(req);
    res.json({ ...(await actionSettings()), calendars: calendarUrls().length, calendarLastSync: await getSetting('calendarLastSync', null) });
  })
);
router.put(
  '/settings',
  ah(async (req, res) => {
    admin(req);
    const b = req.body || {};
    if (Array.isArray(b.templates)) {
      const t = b.templates
        .map((x, i) => ({ key: str(x?.key, 40) || `t${Date.now()}${i}`, name: str(x?.name, 60), body: str(x?.body, 20000) }))
        .filter((x) => x.name && x.body.trim())
        .slice(0, 20);
      if (!t.length) throw fail(400, 'Keep at least one message');
      await setSetting('followUpTemplates', t);
    }
    if (b.laterMonths !== undefined) {
      const n = Math.floor(Number(b.laterMonths));
      if (!(n >= 1 && n <= 24)) throw fail(400, 'Choose 1 to 24 months');
      await setSetting('laterMonths', n);
    }
    if (b.winbackMonths !== undefined) {
      const n = Math.floor(Number(b.winbackMonths));
      if (!(n >= 1 && n <= 24)) throw fail(400, 'Choose 1 to 24 months');
      await setSetting('winbackMonths', n);
    }
    res.json(await actionSettings());
  })
);
router.post(
  '/calendar/sync',
  ah(async (req, res) => {
    admin(req);
    if (!calendarUrls().length) throw fail(400, 'No calendar yet: add CALENDAR_ICS_URLS to the server .env');
    res.json(await syncCalendars());
  })
);

export { suggestMeeting };
export default router;
