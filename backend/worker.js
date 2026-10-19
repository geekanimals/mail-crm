// The automation: sends due emails every minute and checks the inbox for replies.
import crypto from 'node:crypto';
import cron from 'node-cron';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config, imapReady, smtpReady } from './config.js';
import { Campaign, Contact, EmailLog, Enrollment, Reply, Suppression, getSetting, setSetting, remember, notify } from './models.js';
import { buildEmail, sendMail, isBadAddress, parseCc, unsubscribeUrl } from './mail.js';
import { FOLLOW_UPS, SIGNATURE } from './templates.js';

const DAY = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const status = { lastRun: null, lastResult: null, lastReplyCheck: null, imapError: null };

/* ---------------- time helpers (TIMEZONE from .env) ---------------- */
function tzNow(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, wd: p.weekday };
}
export function startOfToday() {
  const n = tzNow();
  const guess = Date.UTC(n.y, n.m - 1, n.d);
  const g = tzNow(new Date(guess));
  const offset = Date.UTC(g.y, g.m - 1, g.d, g.h) - guess;
  return new Date(guess - offset);
}
export function inSendWindow() {
  const n = tzNow();
  if (config.skipWeekends && (n.wd === 'Sat' || n.wd === 'Sun')) return false;
  const { windowStart: a, windowEnd: b } = config;
  return a === b || (a < b ? n.h >= a && n.h < b : n.h >= a || n.h < b);
}
const isWeekend = (d) => ['Sat', 'Sun'].includes(tzNow(d).wd);
/** Thursday + 2 working days = Monday (Sat/Sun are not counted). Same time of day. */
export function addWorkingDays(from, n) {
  let t = new Date(from).getTime();
  if (!config.skipWeekends) return new Date(t + n * DAY);
  for (let left = Math.max(1, n); left > 0; ) {
    t += DAY;
    if (!isWeekend(new Date(t))) left--;
  }
  return new Date(t);
}

/* ---------------- CC ---------------- */
// CC from the frontend (Settings) wins over MAIL_CC in .env; a campaign can have its own.
export const globalCc = async () => (await getSetting('cc', null)) ?? config.cc;
const campaignCc = async (campaign) => parseCc(campaign.cc ?? (await globalCc()));
// Our own CC people must never count as "the lead replied"
async function isCcAddress(email) {
  const all = [await globalCc(), config.cc, ...(await Campaign.distinct('cc'))].join(',');
  return parseCc(all).includes(email);
}

export const sentLastHour = () => EmailLog.countDocuments({ status: 'sent', sentAt: { $gte: new Date(Date.now() - 3600000) } });
export const sentToday = () => EmailLog.countDocuments({ status: 'sent', sentAt: { $gte: startOfToday() } });

/* ---------------- contact state changes ---------------- */
export const stopAll = (contactId, status) => Enrollment.updateMany({ contact: contactId, status: 'active' }, { $set: { status } });

export async function markReplied(contact, { enrollment, from, subject, snippet, messageId, at = new Date() } = {}) {
  const enr = enrollment || (await Enrollment.findOne({ contact: contact._id, step: { $gt: 0 } }).sort({ lastSentAt: -1 }));
  if (enr && enr.status !== 'replied') {
    enr.status = 'replied';
    enr.repliedAfterStep = enr.step;
    await enr.save();
  }
  await stopAll(contact._id, 'replied');
  await Contact.updateOne({ _id: contact._id, status: { $nin: ['unsubscribed', 'bounced'] } }, { $set: { status: 'replied', repliedAt: at } });
  await Reply.create({ contact: contact._id, campaign: enr?.campaign, afterStep: enr?.step, from: from || contact.email, subject, snippet, messageId, receivedAt: at });
  await notify('replied', contact, { campaign: enr?.campaign, step: enr?.step, text: snippet || subject || '' });
}

export async function markUnsubscribed(contact) {
  await Contact.updateOne({ _id: contact._id }, { $set: { status: 'unsubscribed' } });
  await stopAll(contact._id, 'unsubscribed');
  await remember(contact.email, 'unsubscribed');
  await notify('unsubscribed', contact);
}

async function markBounced(contact) {
  await Contact.updateOne({ _id: contact._id, status: { $ne: 'unsubscribed' } }, { $set: { status: 'bounced' } });
  await stopAll(contact._id, 'bounced');
  await remember(contact.email, 'bounced');
  await notify('bounced', contact);
}

/* ---------------- add contacts to a campaign ---------------- */
export async function enroll(campaign, { contactIds, batch, onlyNew = true } = {}) {
  const filter = { status: onlyNew ? 'new' : { $in: ['new', 'contacted'] } };
  if (contactIds?.length) filter._id = { $in: contactIds };
  if (batch) filter.batch = batch;
  const ids = (await Contact.find(filter).select('_id').lean()).map((c) => c._id);
  // skip people already in this campaign or in another running sequence
  const busy = new Set(
    (await Enrollment.find({ contact: { $in: ids }, $or: [{ campaign: campaign._id }, { status: 'active' }] }).select('contact').lean()).map((e) => String(e.contact))
  );
  const docs = ids.filter((i) => !busy.has(String(i))).map((contact) => ({ campaign: campaign._id, contact }));
  let added = 0;
  try {
    added = (await Enrollment.insertMany(docs, { ordered: false })).length;
  } catch (e) {
    added = e.insertedDocs?.length || 0;
  }
  if (added && campaign.status !== 'paused') await Campaign.updateOne({ _id: campaign._id }, { $set: { status: 'active' } });
  return { added, skipped: ids.length - added };
}

/* ---------------- sending ---------------- */
// signature at the end of every email (not twice if the text already has it)
const sigFirstLine = SIGNATURE.trim().split('\n')[0].trim().toLowerCase();
export const hasSignature = (body) => !SIGNATURE.trim() || String(body || '').toLowerCase().includes(sigFirstLine);
// text version (for previews in the app)
export const withSignature = (body) => (hasSignature(body) ? body : `${String(body || '').trimEnd()}\n\n${SIGNATURE.trim()}`);

/**
 * The email for a step: { subject?, body } or null when the sequence is over.
 *  step 0  = first email -> from your file (subject_1/body_1 or subject/body)
 *  step 1+ = follow-ups  -> your own from the file if written, else the fixed ones in templates.js
 */
export function pickEmail(campaign, contact, step) {
  const own = contact.messages || [];
  if (own[step]?.body) return { subject: own[step].subject, body: own[step].body };
  if (step === 0) {
    if (contact.customBody) return { subject: contact.customSubject || campaign.subject, body: contact.customBody };
    return campaign.body ? { subject: campaign.subject, body: campaign.body } : null;
  }
  const list = !campaign.fromFile && campaign.followUps?.length ? campaign.followUps.map((f) => f.body) : FOLLOW_UPS;
  return list[step - 1] ? { body: list[step - 1] } : null;
}

async function sendStep(enr, campaign) {
  const contact = await Contact.findById(enr.contact);
  const blocked = !contact || ['replied', 'unsubscribed', 'bounced'].includes(contact.status) ||
    (await Suppression.exists({ email: contact.email, reason: { $in: ['unsubscribed', 'bounced'] } }));
  if (blocked) {
    await Enrollment.updateOne({ _id: enr._id }, { $set: { status: contact?.status === 'replied' ? 'replied' : 'stopped' } });
    return 'skipped';
  }

  // Which email? step 0 = first email (from your file), then follow-ups in the same thread.
  const m = pickEmail(campaign, contact, enr.step);
  if (!m && enr.step === 0) {
    await Enrollment.updateOne({ _id: enr._id }, { $set: { status: 'failed', lastError: 'No first email (subject/body) in the file for this person' } });
    return 'skipped';
  }
  if (!m) return Enrollment.updateOne({ _id: enr._id }, { $set: { status: 'completed' } }).then(() => 'skipped');
  const first = pickEmail(campaign, contact, 0);
  const root = enr.rootSubject || first?.subject || '';
  let subject = m.subject?.trim() || (enr.step === 0 ? root : /^re:/i.test(root) ? root : `Re: ${root}`);
  const body = m.body;
  if (!String(m.body || '').trim()) {
    await Enrollment.updateOne({ _id: enr._id }, { $set: { status: 'failed', lastError: 'No message written for this email' } });
    return 'skipped';
  }
  subject = subject || '(no subject)';

  // claim the job so it can never be sent twice
  const claimed = await Enrollment.findOneAndUpdate(
    { _id: enr._id, status: 'active', step: enr.step, nextSendAt: { $lte: new Date() } },
    { $set: { nextSendAt: new Date(Date.now() + DAY) } }
  );
  if (!claimed) return 'skipped';

  const trackingId = crypto.randomBytes(16).toString('hex');
  // the last email in this thread is quoted below the new one (like Gmail)
  const prev = enr.step > 0 ? await EmailLog.findOne({ enrollment: enr._id, status: 'sent' }).sort({ step: -1 }).lean() : null;
  const email = buildEmail(contact, subject, body, trackingId, prev, { signature: !hasSignature(body) });
  const stepNo = enr.step + 1;

  let messageId;
  try {
    const cc = (await campaignCc(campaign)).filter((x) => x !== contact.email);
    messageId = await sendMail({ to: contact.email, name: contact.name, email, cc, threadIds: enr.messageIds, unsub: unsubscribeUrl(contact) });
  } catch (e) {
    const msg = String(e.response || e.message).slice(0, 300);
    await EmailLog.create({ campaign: campaign._id, contact: contact._id, enrollment: enr._id, step: stepNo, subject: email.subject, status: 'failed', error: msg }).catch(() => {});
    await notify('failed', contact, { campaign: campaign._id, step: stepNo, text: msg });
    if (isBadAddress(e)) {
      await markBounced(contact);
    } else {
      const attempts = enr.attempts + 1;
      await Enrollment.updateOne(
        { _id: enr._id, status: 'active' },
        { $set: { attempts, lastError: msg, status: attempts >= 3 ? 'failed' : 'active', nextSendAt: new Date(Date.now() + 30 * 60000) } }
      );
    }
    if (e.transient) throw e;
    return 'failed';
  }

  // sent - save progress (errors here never cause a re-send)
  const now = new Date();
  // next follow-up: after N working days (Sat/Sun not counted). null = this was the last email.
  const next = Boolean(pickEmail(campaign, contact, stepNo)?.body);
  const custom = !campaign.fromFile && campaign.followUps?.[stepNo - 1];
  const gap = custom ? custom.delayDays : campaign.gapDays || config.intervalDays;
  const progress = { step: stepNo, lastSentAt: now, attempts: 0, lastError: null, ...(stepNo === 1 ? { rootSubject: email.subject } : {}) };
  try {
    const r = await Enrollment.updateOne(
      { _id: enr._id, status: 'active' }, // a reply may have arrived meanwhile - don't overwrite it
      { $set: { ...progress, status: next ? 'active' : 'completed', nextSendAt: next ? addWorkingDays(now, gap) : null }, $push: { messageIds: messageId } }
    );
    if (!r.matchedCount) await Enrollment.updateOne({ _id: enr._id }, { $set: progress, $push: { messageIds: messageId } });
    await EmailLog.create({ campaign: campaign._id, contact: contact._id, enrollment: enr._id, step: stepNo, subject: email.subject, html: email.core.html, text: email.core.text, messageId, trackingId, sentAt: now });
    await notify('sent', contact, { campaign: campaign._id, step: stepNo, text: email.subject });
    await Contact.updateOne({ _id: contact._id, status: 'new' }, { $set: { status: 'contacted' } });
    await Contact.updateOne({ _id: contact._id }, { $set: { lastContactedAt: now } });
  } catch (e) {
    console.error('[worker] sent but could not save:', e.message);
  }
  return 'sent';
}

let sending = false;
export async function runQueue({ force = false } = {}) {
  if (sending) return { reason: 'already running' };
  sending = true;
  const result = { sent: 0, failed: 0 };
  try {
    if (!smtpReady()) return Object.assign(result, { reason: 'SMTP not configured' });
    if (await getSetting('paused', false)) return Object.assign(result, { reason: 'paused' });
    if (!force && !inSendWindow()) return Object.assign(result, { reason: 'outside sending hours' });
    const dayLeft = config.dailyLimit - (await sentToday());
    if (dayLeft <= 0) return Object.assign(result, { reason: 'daily limit reached' });
    const hourLeft = config.hourlyLimit - (await sentLastHour());
    if (hourLeft <= 0) return Object.assign(result, { reason: 'hourly limit reached - continues next hour' });
    let left = Math.min(dayLeft, hourLeft);

    const campaigns = new Map((await Campaign.find({ status: 'active' })).map((c) => [String(c._id), c]));
    const due = await Enrollment.find({ status: 'active', campaign: { $in: [...campaigns.keys()] }, nextSendAt: { $lte: new Date() } })
      .sort({ nextSendAt: 1 })
      .limit(Math.min(left, 200));
    if (!due.length) return Object.assign(result, { reason: 'nothing due' });

    // Check the inbox before any follow-up. If the check fails, hold follow-ups (never risk mailing someone who replied).
    let holdFollowUps = false;
    if (imapReady() && due.some((e) => e.step > 0)) {
      if (!status.lastReplyCheck || Date.now() - status.lastReplyCheck > 2 * 60000) {
        try {
          await checkReplies();
        } catch {
          holdFollowUps = true;
        }
      }
    }

    for (const e of due) {
      if (left <= 0 || (await getSetting('paused', false))) break;
      if (holdFollowUps && e.step > 0) continue;
      const fresh = await Enrollment.findById(e._id);
      const campaign = campaigns.get(String(e.campaign));
      if (fresh?.status !== 'active' || (await Campaign.findById(campaign._id).select('status').lean())?.status !== 'active') continue;
      const r = await sendStep(fresh, campaign);
      if (r === 'sent') {
        result.sent++;
        left--;
        await sleep(config.sendDelaySec * 1000 * (0.7 + Math.random() * 0.6)); // natural, uneven gaps look less like a bot
      }
      if (r === 'failed') result.failed++;
    }
    // finish campaigns with nobody left in progress
    for (const c of campaigns.values()) {
      if (!(await Enrollment.exists({ campaign: c._id, status: 'active' }))) await Campaign.updateOne({ _id: c._id, status: 'active' }, { $set: { status: 'completed' } });
    }
    return result;
  } catch (e) {
    console.error('[worker]', e.message);
    return Object.assign(result, { reason: e.message });
  } finally {
    sending = false;
    status.lastRun = new Date();
    status.lastResult = result;
  }
}

/* ---------------- reply detection (IMAP) ---------------- */
const header = (buf, name) => {
  const raw = buf ? buf.toString().replace(/\r?\n[ \t]+/g, ' ') : '';
  return (raw.match(new RegExp(`^${name}:\\s*(.*)$`, 'im')) || [])[1]?.trim() || '';
};
const ids = (s) => s.match(/<[^<>\s]+@[^<>\s]+>/g) || [];
const cleanSubject = (s) => String(s || '').replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, '').trim().toLowerCase();
const AUTO_RE = /(out of (the )?office|automatic reply|auto[- ]?reply|away from|on leave|vacation)/i;
const UNSUB_RE = /^\W*(please\s+)?(unsubscribe|remove me|take me off|stop (emailing|sending)|not interested|no thanks|no thank you|do not (email|contact) me|don't (email|contact) me)\b/i;
const BOUNCE_RE = /(mailer-daemon|postmaster|undeliverable|delivery status notification|failure notice|returned mail|delivery failed)/i;

function newText(text = '') {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (/^>/.test(line) || /^On .+wrote:\s*$/i.test(line) || /^-+\s*Original Message/i.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim().slice(0, 1000);
}

let inflight = null;
export function checkReplies() {
  if (!imapReady()) return Promise.resolve({ skipped: 'IMAP not configured' });
  inflight ||= readInbox().finally(() => (inflight = null)); // concurrent callers wait for the same check
  return inflight;
}

async function readInbox() {
  const { host, port, secure, user, pass } = config.imap;
  const client = new ImapFlow({ host, port, secure, auth: { user, pass }, logger: false });
  let found = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(config.imap.mailbox);
    try {
      const state = (await getSetting('imap', null)) || {};
      const validity = String(client.mailbox.uidValidity);
      const known = state.validity === validity && state.lastUid;
      const query = known ? { uid: `${state.lastUid + 1}:*` } : { since: new Date(Date.now() - 14 * DAY) };
      const uids = ((await client.search(query, { uid: true })) || []).filter((u) => !known || u > state.lastUid);
      let lastUid = known ? state.lastUid : 0;

      const msgs = [];
      if (uids.length) {
        for await (const m of client.fetch(uids, { uid: true, envelope: true, headers: ['in-reply-to', 'references', 'auto-submitted', 'precedence', 'x-autoreply'] }, { uid: true })) msgs.push(m);
      }
      const failed = [];
      for (const m of msgs.sort((a, b) => a.uid - b.uid)) {
        try {
          if (await handleMessage(client, m)) found++;
        } catch (e) {
          failed.push(m.uid);
          console.error('[replies] message', m.uid, e.message);
        }
        lastUid = Math.max(lastUid, m.uid);
      }
      if (failed.length) lastUid = Math.min(...failed) - 1; // retry those next time
      await setSetting('imap', { validity, lastUid });
    } finally {
      lock.release();
    }
    await client.logout();
    status.lastReplyCheck = Date.now();
    status.imapError = null;
    return { found };
  } catch (e) {
    status.imapError = e.message;
    client.close();
    throw e;
  }
}

async function handleMessage(client, m) {
  const env = m.envelope || {};
  const from = (env.from?.[0]?.address || '').toLowerCase();
  const subject = env.subject || '';
  if (!from || from === config.fromEmail.toLowerCase() || from === config.imap.user.toLowerCase()) return false;
  if (await isCcAddress(from)) return false; // your CC person replying is not the lead replying
  if (env.messageId && (await Reply.exists({ messageId: env.messageId }))) return false;

  const source = async () => (await client.fetchOne(String(m.uid), { source: true }, { uid: true }))?.source;

  // Bounce -> block that address
  if (BOUNCE_RE.test(from) || BOUNCE_RE.test(subject)) {
    const raw = (await source())?.toString() || '';
    const log = await EmailLog.findOne({ messageId: { $in: raw.match(/<geekcrm\.[^<>\s]+>/g) || [] } });
    const contact = log && (await Contact.findById(log.contact));
    if (contact) await markBounced(contact);
    return false;
  }

  // Reply -> match by thread headers first, then by sender address
  let log = null;
  const refs = [...ids(header(m.headers, 'in-reply-to')), ...ids(header(m.headers, 'references'))];
  if (refs.length) log = await EmailLog.findOne({ messageId: { $in: refs } }).sort({ sentAt: -1 });
  const contact = log ? await Contact.findById(log.contact) : await Contact.findOne({ email: from });
  if (!contact) return false;
  if (!log) {
    log = await EmailLog.findOne({ contact: contact._id, status: 'sent' }).sort({ sentAt: -1 });
    if (!log && contact.status !== 'contacted') return false; // we never emailed them
  }

  const parsed = await simpleParser(await source()).catch(() => ({}));
  const auto = header(m.headers, 'auto-submitted').toLowerCase();
  const isAuto =
    (auto && auto !== 'no') ||
    header(m.headers, 'x-autoreply') ||
    /^(auto_reply|bulk|junk)$/i.test(header(m.headers, 'precedence')) ||
    (cleanSubject(subject) !== cleanSubject(log?.subject) && AUTO_RE.test(subject));
  const at = env.date ? new Date(env.date) : new Date();

  if (isAuto) {
    // out-of-office: keep the sequence going
    await Reply.create({ contact: contact._id, campaign: log?.campaign, from, subject, snippet: newText(parsed.text), messageId: env.messageId, isAutoReply: true, handled: true, receivedAt: at });
    return false;
  }
  // "unsubscribe" / "not interested" / Gmail's Unsubscribe button -> never email again
  const said = newText(parsed.text);
  if (/^\s*unsubscribe\b/i.test(cleanSubject(subject)) || UNSUB_RE.test(said)) {
    await Reply.create({ contact: contact._id, campaign: log?.campaign, from, subject, snippet: said || 'Unsubscribe', messageId: env.messageId, handled: true, receivedAt: at });
    await markUnsubscribed(contact);
    return true;
  }
  const enrollment = log?.enrollment ? await Enrollment.findById(log.enrollment) : null;
  await markReplied(contact, { enrollment, from, subject, snippet: newText(parsed.text), messageId: env.messageId, at });
  return true;
}

/* ---------------- start the timers ---------------- */
export function startWorker() {
  cron.schedule('* * * * *', () => runQueue());
  if (imapReady()) {
    cron.schedule(`*/${config.replyCheckMinutes} * * * *`, () => checkReplies().catch((e) => console.error('[replies]', e.message)));
    setTimeout(() => checkReplies().catch((e) => console.error('[replies]', e.message)), 5000);
  }
}
