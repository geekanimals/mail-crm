// Newsletter (admin): the list, the settings, the photo / video library, issues (draft -> approved & scheduled -> sending -> sent),
// live preview, test email and the report.
import express, { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { Contact, Enrollment } from '../models.js';
import {
  DEFAULTS,
  Newsletter,
  NewsletterMedia,
  NewsletterSend,
  audienceCounts,
  fillBoxes,
  listFilter,
  mediaUrl,
  newsletterOn,
  nextSlot,
  nlSettings,
  problems,
  refreshCounts,
  render,
  saveNlSettings,
  sendOne,
  sender,
  setNewsletterOn,
  startNewsletter,
  withMedia,
} from '../newsletter.js';
import { MAX_UPLOAD, ffmpegReady, prepare, removeFiles } from '../newsletter-media.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';

const router = Router();
const who = (req) => req.user || req.account?.name || 'admin';
const esc = (q) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** leads whose sequence ended with no reply but who are not on the list (finished before the newsletter existed) */
async function finishedNotAdded() {
  const done = await Enrollment.distinct('contact', { status: 'completed' });
  const busy = new Set((await Enrollment.distinct('contact', { status: 'active' })).map(String));
  return { status: 'contacted', newsletter: { $ne: true }, email: { $type: 'string' }, _id: { $in: done.filter((x) => !busy.has(String(x))) } };
}

const mediaOut = (m) => (m ? { ...m, url: mediaUrl(m.file), boxUrl: mediaUrl(m.variants?.h || m.file), storyUrl: mediaUrl(m.variants?.s || m.file), videoUrl: m.video ? mediaUrl(m.video) : '', posterUrl: m.poster ? mediaUrl(m.poster) : '' } : null);
const issueOut = (n) => ({
  ...n,
  design: n.design ? { ...n.design, highlights: (n.design.highlights || []).map((x) => ({ ...x, media: mediaOut(x.media) })), stories: (n.design.stories || []).map((x) => ({ ...x, media: mediaOut(x.media) })) } : n.design,
});

router.get(
  '/',
  ah(async (_req, res) => {
    const [list, counts, finished, st, s, ready, slot] = await Promise.all([
      Newsletter.find().sort({ createdAt: -1 }).limit(100).select('-design -body').lean(),
      audienceCounts(),
      finishedNotAdded().then((f) => Contact.countDocuments(f)),
      nlSettings(),
      sender(),
      ffmpegReady(),
      nextSlot(),
    ]);
    res.json({
      on: await newsletterOn(),
      list,
      audience: counts.next,
      counts,
      settings: st,
      defaults: DEFAULTS,
      sender: { separate: s.separate, newsletterMailbox: s.newsletterMailbox, fromEmail: s.fromEmail, fromName: s.fromName, replyTo: s.replyTo, hourly: s.hourly, daily: s.daily },
      window: { start: config.windowStart, end: config.windowEnd },
      notYetAdded: finished,
      ffmpeg: ready,
      publicLinks: config.publicLinks, // false on localhost: photos in test emails cannot load from outside
      nextSlot: slot,
    });
  })
);

router.get(
  '/people',
  ah(async (req, res) => {
    const q = str(req.query.q, 100);
    const filter = listFilter();
    if (q) filter.$or = [{ email: new RegExp(esc(q), 'i') }, { company: new RegExp(esc(q), 'i') }, { name: new RegExp(esc(q), 'i') }];
    res.json(await Contact.find(filter).sort({ newsletterAt: -1 }).limit(300).select('email name company companyId newsletterAt newsletterCount newsletterLastAt').lean());
  })
);

// switch on / off ({ on }) and the settings
router.put(
  '/settings',
  ah(async (req, res) => {
    const b = req.body || {};
    if (typeof b.on === 'boolean') {
      await setNewsletterOn(b.on);
      return res.json({ on: await newsletterOn() });
    }
    const st = await nlSettings();
    const int = (v, lo, hi, msg) => {
      const n = Math.floor(Number(v));
      if (!(n >= lo && n <= hi)) throw fail(400, msg);
      return n;
    };
    if (b.gapDays !== undefined) st.gapDays = int(b.gapDays, 1, 90, 'Choose a gap of 1 to 90 days');
    if (b.sendHour !== undefined) st.sendHour = int(b.sendHour, config.windowStart, config.windowEnd - 1, `Choose a time between ${config.windowStart}:00 and ${config.windowEnd - 1}:00`);
    if (b.waitDays !== undefined) st.waitDays = int(b.waitDays, 0, 60, 'Choose 0 to 60 days');
    if (b.maxIssues !== undefined) st.maxIssues = int(b.maxIssues, 0, 520, 'Choose 0 (until they unsubscribe) or a number of issues');
    if (b.hourly !== undefined) st.hourly = int(b.hourly, 0, 500, 'Choose 0 to 500 an hour');
    if (b.daily !== undefined) st.daily = int(b.daily, 0, 2000, 'Choose 0 to 2,000 a day');
    if (b.mailbox !== undefined) {
      if (!['sequence', 'newsletter'].includes(b.mailbox)) throw fail(400, 'Choose a mailbox');
      if (b.mailbox === 'newsletter' && !(await sender()).newsletterMailbox) throw fail(400, 'The newsletter mailbox is not set in the server .env yet (NEWSLETTER_SMTP_*)');
      st.mailbox = b.mailbox;
    }
    if (b.fromName !== undefined) st.fromName = str(b.fromName, 80);
    if (b.replyTo !== undefined) {
      const r = str(b.replyTo, 200);
      if (r && !validEmail(r)) throw fail(400, 'The reply-to email is not valid');
      st.replyTo = r ? validEmail(r) : '';
    }
    if (b.ctaLink !== undefined) {
      const l = str(b.ctaLink, 1000);
      if (l && !/^https?:\/\/\S+$/i.test(l)) throw fail(400, 'The "Talk to Geek" link must be a full web address (https://…)');
      st.ctaLink = l || DEFAULTS.ctaLink;
    }
    await saveNlSettings(st);
    res.json(st);
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

/* ---------------- photo / video library ---------------- */
async function usage() {
  const all = await Newsletter.find({ format: 'design' }).select('subject status design.highlights.media design.stories.media').lean();
  const map = new Map();
  for (const n of all)
    for (const x of [...(n.design?.highlights || []), ...(n.design?.stories || [])])
      if (x.media) {
        const k = String(x.media);
        if (!map.has(k)) map.set(k, []);
        if (!map.get(k).some((u) => String(u._id) === String(n._id))) map.get(k).push({ _id: n._id, subject: n.subject, status: n.status });
      }
  return map;
}
router.get(
  '/media',
  ah(async (_req, res) => {
    const [list, used] = await Promise.all([NewsletterMedia.find({ hidden: { $ne: true } }).sort({ createdAt: -1 }).limit(500).lean(), usage()]);
    await fillBoxes(list);
    res.json(list.map((m) => ({ ...mediaOut(m), usedIn: used.get(String(m._id)) || [] })));
  })
);
// upload: the file itself is the request body; ?name=photo.jpg&start=3 (a video: the second the moving GIF starts from)
router.post(
  '/media',
  express.raw({ type: () => true, limit: MAX_UPLOAD }),
  ah(async (req, res) => {
    const name = str(req.query.name, 200) || 'upload';
    const made = await prepare(Buffer.isBuffer(req.body) ? req.body : null, name, { start: Number(req.query.start) || 0 });
    const m = await NewsletterMedia.create({ ...made, name: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120) });
    res.status(201).json({ ...mediaOut(m.toObject()), usedIn: [] });
  })
);
router.patch(
  '/media/:id',
  ah(async (req, res) => {
    const m = await NewsletterMedia.findByIdAndUpdate(checkId(req.params.id), { $set: { name: str(req.body?.name, 120) } }, { new: true }).lean();
    if (!m) throw fail(404, 'Not found');
    res.json(mediaOut(m));
  })
);
// remove: deleted when no issue uses it; hidden from the library (files kept) when a sent / scheduled issue uses it,
// so emails already in people's inboxes keep their photos
router.delete(
  '/media/:id',
  ah(async (req, res) => {
    const m = await NewsletterMedia.findById(checkId(req.params.id));
    if (!m) throw fail(404, 'Not found');
    const used = (await usage()).get(String(m._id)) || [];
    const drafts = used.filter((u) => u.status === 'draft');
    if (drafts.length) throw fail(400, `It is used in the draft "${drafts[0].subject}". Remove it from there first.`);
    if (used.length || m.sentOnce) {
      m.hidden = true;
      await m.save();
      return res.json({ hidden: true });
    }
    await removeFiles(m);
    await m.deleteOne();
    res.json({ deleted: true });
  })
);

/* ---------------- issues ---------------- */
const oid = (v) => {
  const x = v && typeof v === 'object' ? v._id : v;
  return x && mongoose.isValidObjectId(x) ? String(x) : null;
};
const arr = (v) => (Array.isArray(v) ? v : []);
const cleanDesign = (d = {}) => ({
  preheader: str(d.preheader, 200),
  intro: str(d.intro, 2000),
  highlightsTitle: str(d.highlightsTitle, 80) || 'Featured Highlights',
  highlights: arr(d.highlights).slice(0, 4).map((x) => ({ media: oid(x?.media), link: str(x?.link, 1000) })),
  stories: arr(d.stories).slice(0, 4).map((x) => ({ media: oid(x?.media), link: str(x?.link, 1000), title: str(x?.title, 150), text: str(x?.text, 3000) })),
  newsTitle: str(d.newsTitle, 80) || "What's New",
  news: arr(d.news).slice(0, 12).map((x) => str(x, 300)).filter(Boolean),
});
const fields = (b = {}) => {
  const subject = str(b.subject, 200);
  if (!subject) throw fail(400, 'Write the subject');
  if (b.format === 'design') return { subject, format: 'design', design: cleanDesign(b.design) };
  const body = str(b.body, 50000);
  if (!body) throw fail(400, 'Write the newsletter');
  return { subject, format: 'text', body };
};
const full = async (n) => issueOut(n.format === 'design' ? await withMedia(n) : n);

router.post('/', ah(async (req, res) => res.status(201).json(await full((await Newsletter.create(fields(req.body))).toObject()))));

// live preview while editing (nothing is saved)
router.post(
  '/preview',
  ah(async (req, res) => {
    const b = req.body || {};
    const n = b.format === 'design' ? await withMedia({ subject: str(b.subject, 200), format: 'design', design: cleanDesign(b.design) }) : { subject: str(b.subject, 200), format: 'text', body: str(b.body, 50000) };
    const { html, text } = await render(n, null);
    res.json({ html, text, problems: problems(n) });
  })
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const n = await Newsletter.findById(checkId(req.params.id)).lean();
    if (!n) throw fail(404, 'Newsletter not found');
    res.json(await full(n));
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const n = await Newsletter.findOneAndUpdate({ _id: checkId(req.params.id), status: 'draft' }, { $set: fields(req.body) }, { new: true }).lean();
    if (!n) throw fail(400, 'Only a draft can be changed. Move a scheduled issue back to draft first.');
    res.json(await full(n));
  })
);

// a new draft from an earlier issue (same layout, change what you need)
router.post(
  '/:id/copy',
  ah(async (req, res) => {
    const n = await Newsletter.findById(checkId(req.params.id)).lean();
    if (!n) throw fail(404, 'Newsletter not found');
    const copy = await Newsletter.create({ subject: n.subject, format: n.format, body: n.body, design: n.design });
    res.status(201).json(await full(copy.toObject()));
  })
);

router.post(
  '/:id/test',
  ah(async (req, res) => {
    const n = await Newsletter.findById(checkId(req.params.id)).lean();
    if (!n) throw fail(404, 'Newsletter not found');
    const to = validEmail(req.body?.email);
    if (!to) throw fail(400, 'Enter the email to send the test to');
    const filled = n.format === 'design' ? await withMedia(n) : n;
    await sendOne({ ...filled, subject: `[Test] ${n.subject}` }, { email: to, name: '' });
    res.json({ ok: true });
  })
);

// approve: it goes out on its own at sendAt (default: the next date after the gap, at the send time)
router.post(
  '/:id/schedule',
  ah(async (req, res) => {
    await mustBeOn();
    const n = await Newsletter.findOne({ _id: checkId(req.params.id), status: 'draft' });
    if (!n) throw fail(400, 'Only a draft can be approved');
    const p = problems(n.format === 'design' ? await withMedia(n.toObject()) : n);
    if (p.length) throw fail(400, p.join(' '));
    let at = req.body?.sendAt ? new Date(req.body.sendAt) : await nextSlot(n._id);
    if (Number.isNaN(at.getTime())) throw fail(400, 'Choose the date and time');
    if (at.getTime() < Date.now() - 60000) throw fail(400, 'Choose a time in the future (or use "Send now")');
    const clash = await Newsletter.findOne({ _id: { $ne: n._id }, status: 'scheduled', sendAt: { $gt: new Date(at.getTime() - 86400000), $lt: new Date(at.getTime() + 86400000) } }).lean();
    if (clash) throw fail(400, `"${clash.subject}" is already scheduled that day. Choose another date.`);
    n.status = 'scheduled';
    n.sendAt = at;
    n.approvedBy = who(req);
    await n.save();
    res.json(await full(n.toObject()));
  })
);
router.post(
  '/:id/unschedule',
  ah(async (req, res) => {
    const n = await Newsletter.findOneAndUpdate({ _id: checkId(req.params.id), status: 'scheduled' }, { $set: { status: 'draft' }, $unset: { sendAt: 1, approvedBy: 1 } }, { new: true }).lean();
    if (!n) throw fail(400, 'It is not scheduled');
    res.json(await full(n));
  })
);

// send now (approved by this click)
router.post(
  '/:id/send',
  ah(async (req, res) => {
    await mustBeOn();
    const n = await Newsletter.findOne({ _id: checkId(req.params.id), status: { $in: ['draft', 'scheduled'] } });
    if (!n) throw fail(400, 'This newsletter was already sent');
    const p = problems(n.format === 'design' ? await withMedia(n.toObject()) : n);
    if (p.length) throw fail(400, p.join(' '));
    if (await Newsletter.exists({ status: 'sending' })) throw fail(400, 'Another newsletter is still sending. Wait for it to finish or stop it.');
    if (!(await audienceCounts()).next) throw fail(400, 'Nobody is due to get the newsletter right now');
    n.approvedBy = who(req);
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

// who got it, who opened, who clicked
router.get(
  '/:id/report',
  ah(async (req, res) => {
    const n = await Newsletter.findById(checkId(req.params.id));
    if (!n) throw fail(404, 'Newsletter not found');
    if (['sending', 'sent', 'stopped'].includes(n.status)) await refreshCounts(n);
    const sends = await NewsletterSend.find({ newsletter: n._id, status: { $ne: 'queued' } }).sort({ clicks: -1, openedAt: -1, sentAt: -1 }).limit(500).lean();
    const people = new Map((await Contact.find({ _id: { $in: sends.map((s) => s.contact) } }).select('name email company companyId').lean()).map((c) => [String(c._id), c]));
    res.json({ newsletter: n, sends: sends.map((s) => ({ ...s, contact: people.get(String(s.contact)) || null })) });
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
