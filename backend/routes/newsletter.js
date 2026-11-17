// Newsletter (admin): the list, drafts, test email, send, progress.
import { Router } from 'express';
import { Contact, Enrollment } from '../models.js';
import { Newsletter, NewsletterSend, audienceFilter, newsletterOn, sendOne, sender, setNewsletterOn, startNewsletter } from '../newsletter.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';

const router = Router();

/** leads whose sequence ended with no reply but who are not on the list (finished before the newsletter existed) */
async function finishedNotAdded() {
  const done = await Enrollment.distinct('contact', { status: 'completed' });
  const busy = new Set((await Enrollment.distinct('contact', { status: 'active' })).map(String));
  return { status: 'contacted', newsletter: { $ne: true }, email: { $type: 'string' }, _id: { $in: done.filter((x) => !busy.has(String(x))) } };
}

router.get(
  '/',
  ah(async (_req, res) => {
    const [list, audience, finished] = await Promise.all([
      Newsletter.find().sort({ createdAt: -1 }).limit(100).lean(),
      Contact.countDocuments(audienceFilter()),
      finishedNotAdded().then((f) => Contact.countDocuments(f)),
    ]);
    const s = sender();
    res.json({ on: await newsletterOn(), list, audience, sender: { separate: s.separate, fromEmail: s.fromEmail, fromName: s.fromName, hourly: s.hourly, daily: s.daily }, notYetAdded: finished });
  })
);

router.get(
  '/people',
  ah(async (req, res) => {
    const q = str(req.query.q, 100);
    const filter = audienceFilter();
    if (q) filter.$or = [{ email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { company: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
    res.json(await Contact.find(filter).sort({ newsletterAt: -1 }).limit(300).select('email name company newsletterAt').lean());
  })
);

// switch the whole newsletter on / off
router.put(
  '/settings',
  ah(async (req, res) => {
    await setNewsletterOn(req.body?.on === true);
    res.json({ on: await newsletterOn() });
  })
);
const mustBeOn = async () => {
  if (!(await newsletterOn())) throw fail(400, 'The newsletter is switched off. Switch it on at the top of the page first.');
};

// leads whose sequence already ended with no reply (before this feature): add them to the list once
router.post(
  '/add-finished',
  ah(async (_req, res) => {
    await mustBeOn();
    const r = await Contact.updateMany(await finishedNotAdded(), { $set: { newsletter: true, newsletterAt: new Date() } });
    res.json({ added: r.modifiedCount });
  })
);

router.delete(
  '/people/:id',
  ah(async (req, res) => {
    await Contact.updateOne({ _id: checkId(req.params.id) }, { $set: { newsletter: false } });
    res.json({ ok: true });
  })
);

const fields = (b = {}) => {
  const subject = str(b.subject, 200);
  const body = str(b.body, 50000);
  if (!subject) throw fail(400, 'Write the subject');
  if (!body) throw fail(400, 'Write the newsletter');
  return { subject, body };
};

router.post('/', ah(async (req, res) => res.status(201).json(await Newsletter.create(fields(req.body)))));

router.put(
  '/:id',
  ah(async (req, res) => {
    const n = await Newsletter.findOneAndUpdate({ _id: checkId(req.params.id), status: 'draft' }, { $set: fields(req.body) }, { new: true });
    if (!n) throw fail(400, 'Only a draft can be changed');
    res.json(n);
  })
);

router.post(
  '/:id/test',
  ah(async (req, res) => {
    await mustBeOn();
    const n = await Newsletter.findById(checkId(req.params.id));
    if (!n) throw fail(404, 'Newsletter not found');
    const to = validEmail(req.body?.email);
    if (!to) throw fail(400, 'Enter the email to send the test to');
    await sendOne({ subject: `[Test] ${n.subject}`, body: n.body }, { email: to, name: '' });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/send',
  ah(async (req, res) => {
    await mustBeOn();
    const n = await Newsletter.findOne({ _id: checkId(req.params.id), status: 'draft' });
    if (!n) throw fail(400, 'This newsletter was already sent');
    res.json(await startNewsletter(n));
  })
);

router.post(
  '/:id/stop',
  ah(async (req, res) => {
    const n = await Newsletter.findOneAndUpdate({ _id: checkId(req.params.id), status: 'sending' }, { $set: { status: 'stopped', finishedAt: new Date() } }, { new: true });
    if (!n) throw fail(400, 'It is not sending');
    res.json(n);
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const n = await Newsletter.findOne({ _id: checkId(req.params.id), status: { $ne: 'sending' } });
    if (!n) throw fail(400, 'Stop it first');
    await NewsletterSend.deleteMany({ newsletter: n._id });
    await n.deleteOne();
    res.json({ ok: true });
  })
);

export default router;
