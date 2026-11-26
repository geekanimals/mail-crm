// The automation: sends due emails every minute and checks the inbox for replies.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import cron from 'node-cron';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config, imapReady, smtpReady } from './config.js';
import { Campaign, Company, Contact, EmailLog, Enrollment, Reply, STAGE_RANK, Suppression, bumpStage, companyFromSheet, getSetting, setSetting, remember, notify, upsertCompany } from './models.js';
import { bounceReason, buildEmail, sendMail, isBadAddress, parseCc, unsubscribeUrl } from './mail.js';
import { FOLLOW_UPS, SIGNATURE, SIGNATURE_KEY } from './templates.js';
import { joinNewsletter, runNewsletters } from './newsletter.js';

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
/** when an email due at `at` actually goes: the first moment inside sending hours (weekends skipped) */
export function expectedSendAt(at) {
  let t = Math.max(new Date(at).getTime(), Date.now());
  const Q = 15 * 60000; // check every 15 minutes (works for half-hour time zones like India)
  if (!inSendWindow(new Date(t))) t = Math.ceil(t / Q) * Q;
  for (let i = 0; i < 4 * 24 * 15 && !inSendWindow(new Date(t)); i++) t += Q;
  return new Date(t);
}
/** start of the next sending day after `t` (skips the rest of today's sending hours, weekends too) */
function nextSendDay(t) {
  const Q = 15 * 60000;
  let x = Math.ceil(new Date(t).getTime() / Q) * Q;
  for (let i = 0; i < 4 * 24 && inSendWindow(new Date(x)); i++) x += Q; // to the end of today's window
  return expectedSendAt(new Date(x)).getTime();
}
const dayKey = (t) => { const n = tzNow(new Date(t)); return `${n.y}-${n.m}-${n.d}`; };

/**
 * The real date each running email goes out, like the queue sends them:
 * oldest due first, at most DAILY_SEND_LIMIT a day and HOURLY_SEND_LIMIT an hour, inside sending hours, no weekends.
 * Returns Map(enrollmentId -> Date). Paused people / campaigns are left out.
 */
let projected = { at: 0, map: null };
export const forgetProjection = () => (projected = { at: 0, map: null });
export async function projectQueue() {
  if (projected.map && Date.now() - projected.at < 60000) return projected.map; // same answer for a minute (fast paging)
  projected = { at: Date.now(), map: await buildProjection() };
  return projected.map;
}
async function buildProjection() {
  const campaigns = await Campaign.find({ status: 'active' }).select('_id').lean();
  const list = (await Enrollment.find({ status: 'active', paused: { $ne: true }, campaign: { $in: campaigns.map((c) => c._id) } })
    .select('nextSendAt step').lean())
    .map((e) => ({ id: String(e._id), first: e.step === 0, due: new Date(e.nextSendAt || Date.now()).getTime(), ready: expectedSendAt(e.nextSendAt || new Date()).getTime() }));
  const out = new Map();
  if (!list.length) return out;
  // same order as the queue: of the emails that are due, first emails go first, then the longest-waiting follow-up
  const before = (a, b) => (a.first !== b.first ? (a.first ? -1 : 1) : a.due - b.due);
  let cursor = expectedSendAt(new Date()).getTime();
  const today = dayKey(Date.now());
  let dayLeft = config.dailyLimit - (dayKey(cursor) === today ? await sentToday() : 0);
  let hourLeft = config.hourlyLimit - (dayKey(cursor) === today ? await sentLastHour() : 0);
  let hourStart = cursor;
  let left = list;
  for (let guard = 0; left.length && guard < 20000; guard++) {
    if (dayLeft <= 0) { cursor = nextSendDay(cursor); dayLeft = config.dailyLimit; hourLeft = config.hourlyLimit; hourStart = cursor; continue; }
    if (hourLeft <= 0) {
      const t = expectedSendAt(new Date(hourStart + 3600000)).getTime();
      if (dayKey(t) !== dayKey(cursor)) dayLeft = config.dailyLimit;
      cursor = t; hourStart = t; hourLeft = config.hourlyLimit;
      continue;
    }
    let pick = null;
    for (const e of left) if (e.ready <= cursor && (!pick || before(e, pick) < 0)) pick = e;
    if (!pick) {
      // nothing due yet: jump to the next moment something is
      const t = Math.min(...left.map((e) => e.ready));
      if (dayKey(t) !== dayKey(cursor)) { dayLeft = config.dailyLimit; hourLeft = config.hourlyLimit; hourStart = t; }
      cursor = t;
      continue;
    }
    if (cursor - hourStart >= 3600000) { hourStart = cursor; hourLeft = config.hourlyLimit; }
    out.set(pick.id, new Date(cursor));
    left = left.filter((e) => e !== pick);
    dayLeft--;
    hourLeft--;
  }
  return out;
}
export function inSendWindow(at = new Date()) {
  const n = tzNow(at);
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
  try {
    await Reply.create({ contact: contact._id, campaign: enr?.campaign, afterStep: enr?.step, from: from || contact.email, subject, snippet, messageId, receivedAt: at });
  } catch (e) {
    if (e?.code === 11000) return; // the same email was already saved (e.g. by another server) - no second copy, no second alert
    throw e;
  }
  await notify('replied', contact, { campaign: enr?.campaign, step: enr?.step, text: snippet || subject || '' });
  await movePipeline(contact).catch((e) => console.error('[pipeline]', e.message));
}

/** A reply moves the company forward: first reply -> Hot lead, replies again (conversation going) -> Opportunity */
async function movePipeline(contact) {
  let companyId = contact.companyId;
  if (!companyId && contact.company) {
    const c = await upsertCompany(contact.company, {});
    companyId = c?._id;
    if (companyId) await Contact.updateOne({ _id: contact._id }, { $set: { companyId } });
  }
  if (!companyId) return;
  await bumpStage(companyId, await stageFromReplies(companyId));
}

// real replies (not out-of-office, not "unsubscribe") from people of this company
async function stageFromReplies(companyId) {
  const people = await Contact.find({ companyId, status: 'replied' }).select('_id').lean();
  if (!people.length) return null;
  const replies = await Reply.countDocuments({ contact: { $in: people.map((p) => p._id) }, isAutoReply: false });
  return Math.max(replies, 1) >= 2 ? 'opportunity' : 'hot';
}

/**
 * Run at start: companies whose people already replied before this feature existed get their stage too.
 * Same rule as stageFromReplies (1 real reply -> Hot lead, 2 or more -> Opportunity; only ever forward),
 * but in 4 queries for all companies together instead of 5 per company.
 */
export async function syncPipeline() {
  const people = await Contact.find({ status: 'replied', companyId: { $exists: true, $ne: null } }).select('_id companyId').lean();
  if (!people.length) return 0;
  const ids = [...new Set(people.map((p) => String(p.companyId)))];
  const [counts, companies] = await Promise.all([
    Reply.aggregate([{ $match: { contact: { $in: people.map((p) => p._id) }, isAutoReply: false } }, { $group: { _id: '$contact', n: { $sum: 1 } } }]),
    mongoose.connection.collection('companies').find({ _id: { $in: ids.map((i) => new mongoose.Types.ObjectId(i)) } }, { projection: { stage: 1 } }).toArray(),
  ]);
  const repliesOf = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  const replies = {}; // company -> real replies from its people
  for (const p of people) replies[String(p.companyId)] = (replies[String(p.companyId)] || 0) + (repliesOf[String(p._id)] || 0);
  let moved = 0;
  for (const c of companies) {
    const target = Math.max(replies[String(c._id)] || 0, 1) >= 2 ? 'opportunity' : 'hot';
    if (STAGE_RANK[target] > (STAGE_RANK[c.stage] ?? 0)) {
      await bumpStage(c._id, target); // only the few that really move are touched (and get their lifecycle tasks)
      moved++;
    }
  }
  return moved;
}

export async function markUnsubscribed(contact) {
  await Contact.updateOne({ _id: contact._id }, { $set: { status: 'unsubscribed' } });
  await stopAll(contact._id, 'unsubscribed');
  await remember(contact.email, 'unsubscribed');
  await notify('unsubscribed', contact);
}

async function markBounced(contact, why = null) {
  const bounce = why ? { ...why, at: new Date() } : undefined;
  await Contact.updateOne({ _id: contact._id, status: { $ne: 'unsubscribed' } }, { $set: { status: 'bounced', ...(bounce ? { bounce } : {}) } });
  await stopAll(contact._id, 'bounced');
  await remember(contact.email, 'bounced');
  await notify('bounced', contact, bounce ? { text: bounce.reason } : {});
}

/* ---------------- add contacts to a campaign ---------------- */
export async function enroll(campaign, { contactIds, batch, onlyNew = true } = {}) {
  const filter = { status: onlyNew ? 'new' : { $in: ['new', 'contacted'] }, email: { $type: 'string' }, fromReply: { $ne: true } }; // people named in a reply are a warm handover, never auto-emailed
  if (contactIds?.length) filter._id = { $in: contactIds };
  if (batch) filter.batch = batch;
  // a campaign without its own first email (made from a file) can only start people whose file row had one
  let noFirstEmail = 0;
  if (!campaign.body) {
    // $gt '' = "has some text". (Not $nin [null, '']: MongoDB also reads "messages.0.body" as a field named "0"
    // inside each message, finds nothing there, and then wrongly says the person has no first email.)
    const hasOwn = { $or: [{ 'messages.0.body': { $gt: '' } }, { customBody: { $gt: '' } }] };
    noFirstEmail = await Contact.countDocuments({ ...filter, $nor: [hasOwn] });
    Object.assign(filter, hasOwn);
  }
  const ids = (await Contact.find(filter).select('_id').lean()).map((c) => c._id);
  // skip people already in this campaign or in another running sequence
  const busy = new Set(
    (await Enrollment.find({ contact: { $in: ids }, $or: [{ campaign: campaign._id }, { status: 'active' }] }).select('contact').lean()).map((e) => String(e.contact))
  );
  const docs = ids.filter((i) => !busy.has(String(i))).map((contact) => ({ campaign: campaign._id, contact }));
  let added = 0;
  let error = null;
  try {
    added = (await Enrollment.insertMany(docs, { ordered: false })).length;
  } catch (e) {
    added = e.insertedDocs?.length ?? e.result?.insertedCount ?? 0;
    error = e.message;
    console.error('[enroll] could not add people to the campaign:', e.message);
  }
  if (added && campaign.status !== 'paused') await Campaign.updateOne({ _id: campaign._id }, { $set: { status: 'active' } });
  return { added, skipped: ids.length - added, noFirstEmail, error: added < docs.length ? error : null };
}

/* ---------------- sending ---------------- */
// signature at the end of every email (not twice if the text already has it)
export const hasSignature = (body) => !SIGNATURE.trim() || String(body || '').toLowerCase().includes(SIGNATURE_KEY.toLowerCase());
// text version (for previews in the app)
export const withSignature = (body) => (hasSignature(body) ? body : `${String(body || '').trimEnd()}\n\n${SIGNATURE.trim()}`);

/**
 * The email for a step: { subject?, body } or null when the sequence is over.
 *  step 0  = first email -> from your file (subject_1/body_1 or subject/body)
 *  step 1+ = follow-ups  -> your own from the file if written, else the fixed ones in templates.js
 */
/** working days to wait after email number `stepNo` (this person's own gap wins, then the campaign's) */
export function gapFor(enr, campaign, stepNo) {
  if (enr?.gapDays) return enr.gapDays;
  const custom = !campaign?.fromFile && campaign?.followUps?.[stepNo - 1];
  return custom ? custom.delayDays : campaign?.gapDays || config.intervalDays;
}

/** how many emails this person gets in total (first email + follow-ups) */
export function totalSteps(campaign, contact) {
  let n = 1;
  while (n < 30 && pickEmail(campaign, contact, n)) n++;
  return n;
}

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
    { _id: enr._id, status: 'active', paused: { $ne: true }, step: enr.step, nextSendAt: { $lte: new Date() } },
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
      await markBounced(contact, { ...bounceReason(msg), via: 'send' });
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
  const gap = gapFor(enr, campaign, stepNo);
  const progress = { step: stepNo, lastSentAt: now, attempts: 0, lastError: null, ...(stepNo === 1 ? { rootSubject: email.subject } : {}) };
  try {
    const r = await Enrollment.updateOne(
      { _id: enr._id, status: 'active' }, // a reply may have arrived meanwhile - don't overwrite it
      { $set: { ...progress, status: next ? 'active' : 'completed', nextSendAt: next ? addWorkingDays(now, gap) : null }, $push: { messageIds: messageId } }
    );
    if (!r.matchedCount) await Enrollment.updateOne({ _id: enr._id }, { $set: progress, $push: { messageIds: messageId } });
    else if (!next) await joinNewsletter(contact._id); // whole sequence sent, no reply: the newsletter takes over
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
    // Order: first emails of new leads go first (today's upload never waits behind old follow-ups),
    // then follow-ups - the one waiting longest first.
    const dueQ = { status: 'active', paused: { $ne: true }, campaign: { $in: [...campaigns.keys()] }, nextSendAt: { $lte: new Date() } };
    const max = Math.min(left, 200);
    const firsts = await Enrollment.find({ ...dueQ, step: 0 }).sort({ nextSendAt: 1 }).limit(max);
    const followUps = firsts.length < max ? await Enrollment.find({ ...dueQ, step: { $gt: 0 } }).sort({ nextSendAt: 1 }).limit(max - firsts.length) : [];
    const due = [...firsts, ...followUps];
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
      if (fresh?.status !== 'active' || fresh.paused || (await Campaign.findById(campaign._id).select('status').lean())?.status !== 'active') continue;
      const r = await sendStep(fresh, campaign);
      if (r === 'sent') {
        result.sent++;
        left--;
        await sleep(config.sendDelaySec * 1000 * (1 + Math.random() * 0.25)); // at least SEND_DELAY_SECONDS, plus a little random extra (looks human)
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

/** Only the new part of a reply - the quoted earlier emails (Gmail, Outlook, Apple Mail) are cut off. */
export function newText(text = '') {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /^\s*>/.test(line) || // > quoted
      (/^\s*On\b/i.test(line) && /\bwrote:\s*$/i.test(lines.slice(i, i + 3).join(' '))) || // Gmail "On ... wrote:" (may wrap over 2-3 lines)
      /^\s*-{2,}\s*(Original|Forwarded) Message/i.test(line) ||
      /^\s*_{8,}\s*$/.test(line) || // Outlook ________
      (/^\s*From:\s/i.test(line) && /\b(Sent|Date):\s/i.test(`${lines[i + 1] || ''} ${lines[i + 2] || ''}`)) || // Outlook header block
      /^\s*Sent from my (iPhone|iPad|Android|Samsung|mobile)/i.test(line)
    ) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2000);
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
  // a dropped / timed-out mail connection must never crash the server - just log it, the next check retries
  client.on('error', (e) => {
    status.imapError = e?.message || String(e);
    console.warn('[imap] connection error:', e?.code || e?.message);
  });
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
    if (contact) await markBounced(contact, { ...bounceReason(raw), via: 'inbox' });
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
    await Reply.create({ contact: contact._id, campaign: log?.campaign, from, subject, snippet: newText(parsed.text), messageId: env.messageId, isAutoReply: true, handled: true, receivedAt: at }).catch((e) => { if (e?.code !== 11000) throw e; });
    return false;
  }
  // "unsubscribe" / "not interested" / Gmail's Unsubscribe button -> never email again
  const said = newText(parsed.text);
  if (/^\s*unsubscribe\b/i.test(cleanSubject(subject)) || UNSUB_RE.test(said)) {
    await Reply.create({ contact: contact._id, campaign: log?.campaign, from, subject, snippet: said || 'Unsubscribe', messageId: env.messageId, handled: true, receivedAt: at }).catch((e) => { if (e?.code !== 11000) throw e; });
    await markUnsubscribed(contact);
    return true;
  }
  const enrollment = log?.enrollment ? await Enrollment.findById(log.enrollment) : null;
  await markReplied(contact, { enrollment, from, subject, snippet: newText(parsed.text), messageId: env.messageId, at });
  // someone else named, CC'd or replying for them -> that person joins the same company
  await saveReferrals(contact, referralCandidates(contact, { from, fromName: env.from?.[0]?.name, cc: env.cc || [], text: said }), { ccCheck: isCcAddress })
    .catch((e) => console.error('[referrals]', e.message));
  return true;
}

/* ---------------- start the timers ---------------- */
/**
 * Bounces from before the reason was kept: find each one's reason once.
 * First from the failed send (the server's answer is saved with it), then from the bounce emails still in the inbox
 * (read only - nothing in the mailbox is changed). Safe to run again; only contacts with no reason yet are touched.
 */
export async function fillBounceReasons({ redo = false } = {}) {
  const todo = await Contact.find({ status: 'bounced', ...(redo ? {} : { 'bounce.reason': { $exists: false } }) }).select('_id email').lean();
  if (!todo.length) return { filled: 0, left: 0 };
  let filled = 0;
  const left = new Set(todo.map((c) => String(c._id)));
  const save = async (id, why, at) => {
    await Contact.updateOne({ _id: id, ...(redo ? {} : { 'bounce.reason': { $exists: false } }) }, { $set: { bounce: { ...why, at } } });
    left.delete(String(id));
    filled++;
  };
  // 1. bounced while sending: the server's answer is on the failed email
  for (const log of await EmailLog.find({ contact: { $in: todo.map((c) => c._id) }, status: 'failed', error: { $exists: true } }).sort({ sentAt: -1 }).lean()) {
    if (left.has(String(log.contact))) await save(log.contact, { ...bounceReason(log.error), via: 'send' }, log.sentAt);
  }
  // 2. bounced later: the bounce email in the inbox names the email it is about (<geekcrm....> message id)
  if (left.size && imapReady()) {
    const { host, port, secure, user, pass } = config.imap;
    const client = new ImapFlow({ host, port, secure, auth: { user, pass }, logger: false });
    client.on('error', (e) => console.warn('[bounces] imap:', e?.code || e?.message));
    try {
      await client.connect();
      const lock = await client.getMailboxLock(config.imap.mailbox);
      try {
        const since = new Date(Date.now() - 120 * DAY);
        const queries = ['mailer-daemon', 'postmaster'].map((f) => ({ from: f, since }))
          .concat(['Undeliverable', 'Delivery Status Notification', 'failure notice', 'Returned mail', 'Delivery failed', 'Mail delivery failed'].map((sub) => ({ subject: sub, since })));
        const uids = new Set();
        for (const q of queries) for (const u of (await client.search(q, { uid: true })) || []) uids.add(u);
        for (const uid of [...uids].sort((a, b) => b - a)) {
          if (!left.size) break;
          const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
          const raw = msg?.source?.toString() || '';
          const log = await EmailLog.findOne({ messageId: { $in: raw.match(/<geekcrm\.[^<>\s]+>/g) || [] } }).select('contact').lean();
          // no message id in it: the bounce email names the address it is about (Final-Recipient / Original-Recipient)
          const named = (raw.match(/(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)/gi) || []).map((x) => x.replace(/.*rfc822;\s*<?/i, '').replace(/>$/, '').toLowerCase());
          const who = log ? String(log.contact) : String(todo.find((c) => c.email && named.includes(c.email.toLowerCase()))?._id || '');
          if (who && left.has(who)) await save(who, { ...bounceReason(raw), via: 'inbox' }, msg.envelope?.date || new Date());
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (e) {
      console.warn('[bounces] could not read the inbox:', e.message);
      client.close();
    }
  }
  console.log(`[bounces] reasons found for ${filled} bounced contact(s)${left.size ? `, ${left.size} without a bounce email` : ''}`);
  return { filled, left: left.size };
}

/* ---------------- referrals: people named in a reply join the same company ---------------- */
const GENERIC = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce|calendar|reply)$/i;
// a shared inbox or a ticket / help-desk system is not a person to work with
const SHARED = /^(support|care|customer\.?care|help|helpdesk|team|info|hello|contact|sales|seo|admin|office|hr|marketing\d*|design\d*|enquir(y|ies)|connect|feedback)/i;
const HELPDESK = /(freshdesk|zendesk|limechat|intercom|hubspot|helpscout|freshworks|zohodesk|kayako|gorgias)\.|(^|\.)mg\./i;
const nameFromEmail = (e) => {
  const local = e.split('@')[0];
  if (/^(support|info|hello|contact|sales|marketing|team|admin|office|hr|care)$/i.test(local)) return '';
  return local.split(/[._-]+/).map((w) => w.replace(/\d+$/, '')).filter((w) => /^[a-z]+$/i.test(w)).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
};
/** the reply without the sender's signature (their own other addresses live there, e.g. "E. marketing2@brand.com") */
const withoutSignature = (text = '') => {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const i = lines.findIndex((l, n) => n > 0 && /^\s*(thanks|thank you|regards|regds|best|warm regards|kind regards|cheers|sincerely|--\s*$)/i.test(l));
  return (i > 0 ? lines.slice(0, i) : lines).join('\n');
};
/** who else this reply brings in: whoever replied for them, people CC'd, and addresses written in the reply */
export function referralCandidates(contact, { from = '', fromName = '', cc = [], text = '' } = {}) {
  const own = [config.fromEmail, config.imap.user].map((e) => String(e || '').toLowerCase().split('@')[1]).filter(Boolean);
  const me = String(contact.email || '').toLowerCase();
  const out = new Map();
  const add = (email, name, how) => {
    const e = String(email || '').trim().toLowerCase().replace(/^mailto:/, '');
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) || e === me || out.has(e)) return;
    const [local, domain] = e.split('@');
    if (own.includes(domain) || GENERIC.test(local) || SHARED.test(local) || HELPDESK.test(domain)) return;
    // the same person on another address (their first name is in it, e.g. garima -> imgarimasingh41@gmail.com)
    const first = String(contact.name || '').trim().split(/\s+/)[0].toLowerCase();
    if (first.length >= 3 && local.toLowerCase().includes(first)) return;
    out.set(e, { email: e, name: String(name || '').replace(/["']/g, '').trim() || nameFromEmail(e), how });
  };
  if (from) add(from, fromName, 'replied for them');
  for (const c of cc) add(c?.address || c, c?.name, 'copied into their reply');
  for (const e of withoutSignature(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) add(e, '', 'named in their reply');
  return [...out.values()];
}
/** add them to the referrer's company (or link an existing contact to it); never put in automatic emails */
export async function saveReferrals(contact, people, { ccCheck } = {}) {
  let added = 0;
  for (const p of people) {
    if (ccCheck && (await ccCheck(p.email))) continue; // our own CC people
    const by = `${contact.name || contact.email} (${p.how})`;
    const existing = await Contact.findOne({ email: p.email });
    if (existing) {
      const set = {};
      if (!existing.companyId && contact.companyId) Object.assign(set, { companyId: contact.companyId, company: contact.company || existing.company });
      if (!existing.referredBy) set.referredBy = by;
      if (Object.keys(set).length) await Contact.updateOne({ _id: existing._id }, { $set: set });
      continue;
    }
    const c = await Contact.create({
      email: p.email, name: p.name, company: contact.company || '', companyId: contact.companyId || undefined,
      referredBy: by, source: 'Referral (from a reply)', fromReply: true, status: 'new',
    });
    await notify('referral', c, { text: `${contact.name || contact.email} brought in ${p.name || p.email}${contact.company ? ` · ${contact.company}` : ''}` }).catch(() => {});
    added++;
  }
  return added;
}

/* ---------------- follow-up gap from Settings ---------------- */
/** change the working days between follow-ups everywhere: the default, every running campaign, and the next follow-up
 *  already scheduled for each person (people with their own gap keep it; first emails still waiting are not moved) */
export async function applyFollowUpGap(days, { preview = false } = {}) {
  const running = { status: { $in: ['draft', 'active', 'paused'] } };
  const campaigns = await Campaign.find(running).select('_id followUps').lean();
  if (!preview) {
    config.intervalDays = days;
    await setSetting('intervalDays', days);
    await Campaign.updateMany(running, { $set: { gapDays: days } });
    for (const c of campaigns.filter((x) => x.followUps?.length)) {
      await Campaign.updateOne({ _id: c._id }, { $set: { followUps: c.followUps.map((f) => ({ ...f, delayDays: days })) } });
    }
  }
  const now = new Date();
  let moved = 0;
  const enrs = await Enrollment.find({ campaign: { $in: campaigns.map((c) => c._id) }, status: 'active', step: { $gte: 1 }, lastSentAt: { $exists: true }, $or: [{ gapDays: null }, { gapDays: { $exists: false } }] }).select('lastSentAt nextSendAt').lean();
  for (const e of enrs) {
    let next = addWorkingDays(e.lastSentAt, days);
    const cur = e.nextSendAt ? new Date(e.nextSendAt) : null;
    if (next <= now) {
      if (cur && cur <= now) continue; // already due and waiting in the queue: keep its place
      next = now; // a shorter gap makes it due now
    }
    if (!cur || Math.abs(cur - next) > 60000) {
      if (!preview) await Enrollment.updateOne({ _id: e._id, status: 'active' }, { $set: { nextSendAt: next } });
      moved++;
    }
  }
  return { campaigns: campaigns.length, rescheduled: moved, ownGap: await Enrollment.countDocuments({ status: 'active', gapDays: { $gte: 1 } }) };
}

/** once: companies get their empty industry / location / LinkedIn / website from their people's uploaded sheet rows */
export async function fillCompaniesFromSheets() {
  const KEYS = ['website', 'industry', 'location', 'linkedin'];
  const companies = await Company.find({ $or: KEYS.map((k) => ({ $or: [{ [k]: { $exists: false } }, { [k]: '' }, { [k]: null }] })) }).select(KEYS.join(' ')).lean();
  const people = await Contact.find({ companyId: { $in: companies.map((c) => c._id) }, 'fields.0': { $exists: true } }).select('companyId fields').sort({ createdAt: 1 }).lean();
  const byCo = new Map();
  for (const p of people) (byCo.get(String(p.companyId)) || byCo.set(String(p.companyId), []).get(String(p.companyId))).push(...p.fields);
  const ops = [];
  const count = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const c of companies) {
    const sheet = companyFromSheet(byCo.get(String(c._id)) || []);
    const set = {};
    for (const k of KEYS) if (!c[k] && sheet[k]) (set[k] = sheet[k]), count[k]++;
    if (Object.keys(set).length) ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: set } } });
  }
  if (ops.length) await Company.bulkWrite(ops, { ordered: false });
  console.log(`[companies] filled from sheets: ${ops.length} companies`, count);
  return { companies: ops.length, ...count };
}

export function startWorker() {
  setTimeout(async () => {
    try {
      if ((await getSetting('company_sheet_fill_v', 0)) < 1) {
        await fillCompaniesFromSheets();
        await setSetting('company_sheet_fill_v', 1);
      }
    } catch (e) {
      console.error('[companies]', e.message);
    }
  }, 20000);
  cron.schedule('* * * * *', () => runQueue());
  cron.schedule('* * * * *', () => runNewsletters());
  if (imapReady()) {
    cron.schedule(`*/${config.replyCheckMinutes} * * * *`, () => checkReplies().catch((e) => console.error('[replies]', e.message)));
    setTimeout(() => checkReplies().catch((e) => console.error('[replies]', e.message)), 5000);
    // older bounces: find their reason once (version 2 = read every bounce again with the better reason reader)
    setTimeout(async () => {
      try {
        const v = await getSetting('bounce_reasons_v', 0);
        await fillBounceReasons({ redo: v < 2 });
        if (v < 2) await setSetting('bounce_reasons_v', 2);
      } catch (e) {
        console.error('[bounces]', e.message);
      }
    }, 60000);
  }
}
