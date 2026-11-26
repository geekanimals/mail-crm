// Dashboard analytics, replies inbox and settings
import { Router } from 'express';
import { config, imapReady, smtpReady } from '../config.js';
import { Campaign, Contact, EmailLog, Enrollment, Notification, Reply, Suppression, getSetting, setSetting } from '../models.js';
import { parseCc, sendMail, verifySmtp } from '../mail.js';
import { applyFollowUpGap, checkReplies, globalCc, newText, inSendWindow, sentLastHour, runQueue, sentToday, startOfToday, status } from '../worker.js';
import { campaignStats } from './campaigns.js';
import { ah, checkId, fail, pct, validEmail } from '../utils.js';

const router = Router();

/* ---------- every email sent: the dashboard boxes open this list (sent / opened / clicked, one day, one step) ---------- */
router.get(
  '/emails',
  ah(async (req, res) => {
    const show = ['sent', 'opened', 'clicked'].includes(req.query.show) ? req.query.show : 'sent';
    const filter = { status: 'sent' };
    if (show === 'opened') filter.openedAt = { $exists: true };
    if (show === 'clicked') filter.clickedAt = { $exists: true };
    const field = show === 'opened' ? 'openedAt' : show === 'clicked' ? 'clickedAt' : 'sentAt';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || ''))) {
      // that calendar day in the CRM's time zone
      const fmt = { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: config.timezone } };
      filter.$expr = { $eq: [fmt, req.query.day] };
    }
    const step = Number(req.query.step);
    if (Number.isInteger(step) && step >= 1 && step <= 50) filter.step = step;
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const ids = await Contact.find({ $or: [{ name: rx }, { email: rx }, { company: rx }] }).select('_id').limit(2000).lean();
      filter.$or = [{ contact: { $in: ids.map((c) => c._id) } }, { subject: rx }];
    }
    const limit = 25;
    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const [list, total] = await Promise.all([
      EmailLog.find(filter).select('-html -text').sort({ [field]: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('contact', 'name email company status').populate('campaign', 'name').lean(),
      EmailLog.countDocuments(filter),
    ]);
    res.json({
      show,
      list: list.map((e) => ({ _id: e._id, step: e.step, subject: e.subject, sentAt: e.sentAt, openedAt: e.openedAt, clickedAt: e.clickedAt, contact: e.contact, campaign: e.campaign })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  })
);

/* ---------- analytics ---------- */
router.get(
  '/dashboard',
  ah(async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const since = new Date(startOfToday().getTime() - (days - 1) * 86400000);
    const day = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: config.timezone } });

    const [contacts, sent, opened, clicked, byStatus, active, sentDays, replyDays, stepSent, stepReplies, recent, todaySent, unhandled, openDays] = await Promise.all([
      Contact.countDocuments(),
      EmailLog.countDocuments({ status: 'sent' }),
      EmailLog.countDocuments({ status: 'sent', openedAt: { $exists: true } }),
      EmailLog.countDocuments({ status: 'sent', clickedAt: { $exists: true } }),
      Contact.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Enrollment.countDocuments({ status: 'active' }),
      EmailLog.aggregate([{ $match: { status: 'sent', sentAt: { $gte: since } } }, { $group: { _id: day('sentAt'), n: { $sum: 1 } } }]),
      Reply.aggregate([{ $match: { isAutoReply: false, receivedAt: { $gte: since } } }, { $group: { _id: day('receivedAt'), n: { $sum: 1 } } }]),
      EmailLog.aggregate([{ $match: { status: 'sent' } }, { $group: { _id: '$step', n: { $sum: 1 } } }]),
      Reply.aggregate([{ $match: { isAutoReply: false, afterStep: { $gte: 1 }, contact: { $ne: null } } }, { $group: { _id: '$afterStep', n: { $sum: 1 } } }]), // reply emails per email of the sequence (= what the Replies list shows)
      Campaign.find().sort({ updatedAt: -1 }).limit(5).lean(),
      sentToday(),
      Reply.countDocuments({ handled: false, isAutoReply: false }),
      EmailLog.aggregate([{ $match: { status: 'sent', openedAt: { $gte: since } } }, { $group: { _id: day('openedAt'), n: { $sum: 1 } } }]), // opens per day (chart labels)
    ]);

    const s = Object.fromEntries(byStatus.map((x) => [x._id, x.n]));
    const reached = (s.contacted || 0) + (s.replied || 0) + (s.unsubscribed || 0) + (s.bounced || 0);
    const toMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
    const sentMap = toMap(sentDays);
    const replyMap = toMap(replyDays);
    const openMap = toMap(openDays);
    const chart = [];
    for (let i = 0; i < days; i++) {
      const key = new Date(since.getTime() + i * 86400000 + 12 * 3600000).toLocaleDateString('en-CA', { timeZone: config.timezone });
      chart.push({ date: key, sent: sentMap[key] || 0, opened: openMap[key] || 0, replied: replyMap[key] || 0 });
    }
    const sMap = toMap(stepSent);
    const rMap = toMap(stepReplies);
    const maxStep = Math.max(1, ...Object.keys(sMap).map(Number));
    const steps = Array.from({ length: maxStep }, (_, i) => ({
      label: i === 0 ? 'First email' : `Follow-up ${i}`,
      sent: sMap[i + 1] || 0,
      replies: rMap[i + 1] || 0,
      rate: pct(rMap[i + 1] || 0, sMap[i + 1] || 0),
    }));
    const stats = await campaignStats(recent.map((c) => c._id));

    res.json({
      totals: { contacts, sent, opened, clicked, replied: s.replied || 0, unsubscribed: s.unsubscribed || 0, bounced: s.bounced || 0, active, todaySent, dailyLimit: config.dailyLimit, unhandled },
      rates: { open: pct(opened, sent), click: pct(clicked, sent), reply: pct(s.replied || 0, reached), unsubscribe: pct(s.unsubscribed || 0, reached) },
      chart,
      steps,
      recent: recent.map((c) => ({ _id: c._id, name: c.name, status: c.status, stats: stats[c._id] })),
    });
  })
);

/* ---------- replies inbox ---------- */
router.get(
  '/replies',
  ah(async (req, res) => {
    const filter = { isAutoReply: req.query.type === 'auto' };
    if (req.query.type !== 'auto') {
      if (req.query.handled === 'true') filter.handled = true;
      if (req.query.handled === 'false') filter.handled = false;
    }
    const step = Number(req.query.step);
    if (Number.isInteger(step) && step >= 1 && step <= 50) filter.afterStep = step; // replies to one email of the sequence (dashboard)
    const [list, autoCount] = await Promise.all([
      Reply.find(filter).sort({ receivedAt: -1 }).limit(200)
        .populate({ path: 'contact', select: 'name email company title companyId', populate: { path: 'companyId', select: 'name stage' } })
        .populate('campaign', 'name').lean(),
      Reply.countDocuments({ isAutoReply: true }),
    ]);
    res.set('X-Auto-Replies', String(autoCount));
    res.json(list.filter((r) => r.contact).map((r) => ({ ...r, snippet: newText(r.snippet) || r.snippet }))); // only the new text, no quoted thread
  })
);
router.post(
  '/replies/:id/handled',
  ah(async (req, res) => {
    const r = await Reply.updateOne({ _id: checkId(req.params.id) }, { $set: { handled: req.body?.handled !== false } });
    if (!r.matchedCount) throw fail(404, 'Reply not found');
    res.json({ ok: true });
  })
);
router.post(
  '/replies/check',
  ah(async (_req, res) => {
    try {
      res.json(await checkReplies());
    } catch (e) {
      throw fail(502, `Inbox check failed: ${e.message}`);
    }
  })
);

/* ---------- settings ---------- */
router.get(
  '/settings',
  ah(async (_req, res) => {
    res.json({
      paused: await getSetting('paused', false),
      smtp: { ready: smtpReady(), host: config.smtp.host, from: `${config.fromName} <${config.fromEmail}>` },
      imap: { ready: imapReady(), host: config.imap.host, lastCheck: status.lastReplyCheck, error: status.imapError, every: config.replyCheckMinutes },
      rules: {
        dailyLimit: config.dailyLimit,
        hourlyLimit: config.hourlyLimit,
        sentLastHour: await sentLastHour(),
        sentToday: await sentToday(),
        delay: config.sendDelaySec,
        window: `${config.windowStart}:00 - ${config.windowEnd}:00 (${config.timezone})`,
        openNow: inSendWindow(),
        sequence: `every ${config.intervalDays} ${config.skipWeekends ? 'working ' : ''}days`,
        gapDays: config.intervalDays,
        workingDays: config.skipWeekends,
        weekends: config.skipWeekends ? 'Saturday & Sunday off' : 'Sends every day',
      },
      cc: await globalCc(),
      ccEnv: config.cc,
      lastRun: status.lastRun,
      lastResult: status.lastResult,
      blocked: await Suppression.countDocuments({ reason: { $in: ['unsubscribed', 'bounced'] } }),
      unhandled: await Reply.countDocuments({ handled: false, isAutoReply: false }),
    });
  })
);
router.post(
  '/settings/pause',
  ah(async (req, res) => {
    const paused = req.body?.paused === true;
    await setSetting('paused', paused);
    if (!paused) setImmediate(() => runQueue());
    res.json({ paused });
  })
);
// CC on every email: { cc: "a@x.com, b@y.com" }  (empty = no CC, reset: true = back to .env MAIL_CC)
router.post(
  '/settings/cc',
  ah(async (req, res) => {
    const cc = req.body?.reset ? null : parseCc(req.body?.cc).join(', ');
    await setSetting('cc', cc);
    res.json({ cc: await globalCc() });
  })
);
// working days between follow-ups: the default, every running campaign and the next follow-up already planned
router.put(
  '/settings/follow-up-gap',
  ah(async (req, res) => {
    const days = Math.floor(Number(req.body?.days));
    if (!(days >= 1 && days <= 30)) throw fail(400, 'Choose between 1 and 30 working days');
    res.json({ days, preview: req.query.preview === '1', ...(await applyFollowUpGap(days, { preview: req.query.preview === '1' })) });
  })
);

router.post('/settings/test-smtp', ah(async (_req, res) => res.json(await verifySmtp())));
router.post(
  '/settings/test-email',
  ah(async (req, res) => {
    const to = validEmail(req.body?.to);
    if (!to) throw fail(400, 'Enter a valid email');
    try {
      await sendMail({ to, email: { subject: 'Geek CRM test email', text: 'SMTP is working!', html: '<p>SMTP is working!</p>', bulk: false } });
    } catch (e) {
      throw fail(502, e.message);
    }
    res.json({ ok: true });
  })
);
router.post('/settings/run', ah(async (_req, res) => res.json(await runQueue({ force: true }))));

/* ---------- bell notifications ---------- */
router.get(
  '/notifications',
  ah(async (_req, res) => {
    // first time: fill the feed from past activity (marked as read)
    if (!(await Notification.exists({}))) {
      const [logs, replies, unsubs] = await Promise.all([
        EmailLog.find().sort({ sentAt: -1 }).limit(80).populate('contact', 'name email').lean(),
        Reply.find({ isAutoReply: false }).sort({ receivedAt: -1 }).limit(40).populate('contact', 'name email').lean(),
        Contact.find({ status: 'unsubscribed' }).sort({ updatedAt: -1 }).limit(20).lean(),
      ]);
      const name = (c) => c?.name || c?.email || '';
      const docs = [
        ...logs.map((l) => ({ type: l.status === 'failed' ? 'failed' : 'sent', contact: l.contact?._id, campaign: l.campaign, name: name(l.contact), step: l.step, text: l.status === 'failed' ? l.error : l.subject, read: true, createdAt: l.sentAt })),
        ...replies.map((r) => ({ type: 'replied', contact: r.contact?._id, campaign: r.campaign, name: name(r.contact) || r.from, step: r.afterStep, text: r.snippet || r.subject, read: true, createdAt: r.receivedAt })),
        ...unsubs.map((c) => ({ type: 'unsubscribed', contact: c._id, name: name(c), read: true, createdAt: c.updatedAt })),
      ];
      if (docs.length) await Notification.insertMany(docs).catch(() => {});
    }
    const [items, unread] = await Promise.all([
      Notification.find().sort({ createdAt: -1 }).limit(100).populate('campaign', 'name').lean(),
      Notification.countDocuments({ read: false }),
    ]);
    res.json({ items, unread });
  })
);
router.post(
  '/notifications/read-all',
  ah(async (_req, res) => {
    await Notification.updateMany({ read: false }, { $set: { read: true } });
    res.json({ ok: true });
  })
);
router.post(
  '/notifications/:id/read',
  ah(async (req, res) => {
    await Notification.updateOne({ _id: checkId(req.params.id) }, { $set: { read: true } });
    res.json({ ok: true });
  })
);

export default router;
