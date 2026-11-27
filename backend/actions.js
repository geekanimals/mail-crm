// "Needs you": the CRM reads every reply (and the calendar), suggests what to do, and waits for a person to decide.
// Nothing changes for a lead until the admin (or the employee who takes the meetings) presses a button. The message
// for any follow-up is chosen at that moment, then the CRM sends it on the chosen date by itself.
//
//   reply           "not interested" / "after March" / "on leave till 5 Dec" / anything else
//   meeting         a meeting was found in a reply, an invite or the calendar -> set it?
//   meeting_outcome a set meeting is over -> how was it?
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Company, Contact, EmailLog, Enrollment, Reply, STAGE_RANK, Suppression, User, getSetting, notify, setSetting, stageChanged } from './models.js';
import { HrTask } from './hr-models.js';
import { buildEmail, sendMail, unsubscribeUrl } from './mail.js';

const { Schema, model } = mongoose;
const id = Schema.Types.ObjectId;
const DAY = 86400000;

/* ---------------- models ---------------- */
export const Action = model(
  'Action',
  new Schema(
    {
      kind: { type: String, enum: ['reply', 'meeting', 'meeting_outcome', 'manual', 'referral', 'estimate'], required: true },
      status: { type: String, enum: ['open', 'done', 'dismissed'], default: 'open', index: true },
      contact: { type: id, ref: 'Contact', index: true },
      company: { type: id, ref: 'Company', index: true },
      reply: { type: id, ref: 'Reply' },
      emailAt: Date, // when the email this card is about was sent / received (shown on the card)
      meeting: { type: id, ref: 'Meeting' },
      quote: { type: String, default: '' }, // what they wrote (new text only)
      suggestion: {
        type: { type: String }, // not_interested | later | ooo | hot | meeting | outcome
        date: Date,
        reason: String, // not interested: budget | agency | not_relevant | other
        sources: [String], // meeting: email | invite | calendar
        check: { type: Boolean, default: false }, // not sure: "check this"
        note: String, // e.g. "Email said 3 PM, calendar says 4 PM"
      },
      assignees: [{ type: id, ref: 'User' }], // employees who may answer (meeting questions); the admin always may
      decision: Schema.Types.Mixed,
      undo: Schema.Types.Mixed,
      decidedBy: String,
      decidedAt: Date,
    },
    { timestamps: true }
  )
);

export const Meeting = model(
  'Meeting',
  new Schema(
    {
      company: { type: id, ref: 'Company', index: true },
      contact: { type: id, ref: 'Contact' },
      at: { type: Date, index: true },
      status: { type: String, enum: ['set', 'done', 'cancelled'], default: 'set', index: true },
      sources: [String],
      calendarUid: { type: String, index: true },
      title: String,
      outcomeAsked: { type: Boolean, default: false },
      outcome: String,
      notes: String,
      by: String,
    },
    { timestamps: true }
  )
);

export const ScheduledEmail = model(
  'ScheduledEmail',
  new Schema(
    {
      contact: { type: id, ref: 'Contact', index: true },
      company: { type: id, ref: 'Company' },
      kind: { type: String, enum: ['later', 'winback', 'after_meeting', 'referral'], default: 'later' },
      sendAt: { type: Date, index: true },
      subject: String, // a first email in a new thread (referral); later ones are "Re:" the thread
      body: String,
      cc: [String], // e.g. the person who referred them
      nextBodies: [String], // the follow-ups chosen at the same time (if there is no reply), in order
      remaining: { type: Number, default: 0 }, // more follow-ups after this one if there is no reply
      status: { type: String, enum: ['scheduled', 'held', 'sending', 'sent', 'cancelled', 'failed'], default: 'scheduled', index: true }, // held = waiting for a decision (emailed by hand)
      error: String,
      action: { type: id, ref: 'Action' },
      sentAt: Date,
      by: String,
    },
    { timestamps: true }
  )
);

/* ---------------- settings: follow-up messages ---------------- */
export const DEFAULT_TEMPLATES = [
  { key: 'checking_in', name: 'Checking in', body: 'Hi {{firstName}},\n\nYou asked us to get back to you around now, so I am checking in. Is this a good time to talk about creator campaigns for {{company}}?\n\nHappy to set up a quick 15-minute call.' },
  { key: 'more_details', name: 'Sharing more details', body: 'Hi {{firstName}},\n\nAs promised, here are more details on how our barter creator campaigns work for brands like {{company}}: creators are paid in product, so each extra creator costs a unit of stock plus our fee.\n\nWould you like a short proposal for {{company}}?' },
  { key: 'referral_intro', name: 'Referral intro', body: 'Hi {{firstName}},\n\n{{referrer}} suggested I get in touch with you about creator campaigns for {{company}}.\n\nWe run influencer campaigns with micro and nano creators who are paid in product, so each extra creator costs a unit of stock plus our fee. We have done this for brands like PepsiCo.\n\nWould you be open to a quick 15-minute call this week?' },
  { key: 'as_discussed', name: 'As discussed in the meeting', body: 'Hi {{firstName}},\n\nThank you for your time in our meeting. Following up as discussed: please let me know how you would like to go ahead with {{company}}, and I will share the next steps.' },
];
export async function actionSettings() {
  const t = await getSetting('followUpTemplates', null);
  return {
    templates: Array.isArray(t) && t.length ? t : DEFAULT_TEMPLATES,
    laterMonths: Number(await getSetting('laterMonths', 3)) || 3,
    winbackMonths: Number(await getSetting('winbackMonths', 6)) || 6,
    moreGapDays: 5, // working days between the extra follow-ups when there is no reply
  };
}

/* ---------------- dates ---------------- */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RX = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, few: 2, couple: 2, ek: 1, do: 2, teen: 3, char: 4, chaar: 4, chhe: 6 };
// festival dates (India): a follow-up goes about a week after
const FESTIVALS = {
  diwali: ['2026-11-08', '2027-10-29', '2028-10-17', '2029-11-05'],
  holi: ['2027-03-22', '2028-03-11', '2029-03-01'],
  'new year': ['2027-01-01', '2028-01-01', '2029-01-01'],
};
const tz = () => config.timezone || 'Asia/Kolkata';
/** a date in the CRM's time zone at hh:mm (default 11:00) */
function zoned(y, m, d, hh = 11, mm = 0) {
  const guess = Date.UTC(y, m, d, hh, mm);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (shown - guess));
}
function parts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month - 1, d: +p.day, wd: p.weekday };
}
const addMonths = (base, n) => {
  const b = parts(base);
  return zoned(b.y, b.m + n, Math.min(b.d, 28));
};
const monthIndex = (s) => MONTHS.indexOf(String(s).slice(0, 3).toLowerCase());
/** the next time this month/day comes (this year, or next year if it has passed) */
function nextOf(m, d, base) {
  const b = parts(base);
  let y = b.y;
  if (m < b.m || (m === b.m && d < b.d)) y++;
  return zoned(y, m, d);
}

/** "after 3 months", "next quarter", "in March", "after Diwali", "5 Dec", "next year" -> { date, label } */
export function findLaterDate(text, base = new Date()) {
  const t = ` ${String(text || '').toLowerCase()} `;
  let m;
  if ((m = t.match(/\b(?:after|in|within|post|baad)\s+(\d+|a|an|one|two|three|four|five|six|few|couple(?: of)?|ek|do|teen|chaar?|chhe)\s+(day|week|month|year|din|hafte|mahine|mahina|saal)s?\b/))) {
    const n = Number(m[1]) || NUM[m[1].replace(' of', '')] || 1;
    const unit = m[2];
    if (/day|din/.test(unit)) return { date: new Date(base.getTime() + n * DAY), label: m[0].trim() };
    if (/week|hafte/.test(unit)) return { date: new Date(base.getTime() + n * 7 * DAY), label: m[0].trim() };
    if (/month|mahin/.test(unit)) return { date: addMonths(base, n), label: m[0].trim() };
    return { date: addMonths(base, 12 * n), label: m[0].trim() };
  }
  if ((m = t.match(/(\d+)\s+(din|hafte|mahine|mahina|saal|days?|weeks?|months?|years?)\s+(?:baad|later|ke baad|after)/))) {
    const n = Number(m[1]);
    const u = m[2];
    const date = /din|day/.test(u) ? new Date(base.getTime() + n * DAY) : /hafte|week/.test(u) ? new Date(base.getTime() + n * 7 * DAY) : /mahin|month/.test(u) ? addMonths(base, n) : addMonths(base, 12 * n);
    return { date, label: m[0].trim() };
  }
  for (const [name, dates] of Object.entries(FESTIVALS)) {
    if (new RegExp(`\\b(after|post|once|baad|till|until|before)?\\s*(the\\s+)?${name}\\b`).test(t) && (name !== 'new year' || /\b(after|post|in|baad|till|until)\s+(the\s+)?new year/.test(t))) {
      const next = dates.map((s) => new Date(`${s}T06:00:00Z`)).find((d) => d.getTime() > base.getTime());
      if (next) return { date: new Date(next.getTime() + (name === 'new year' ? 4 : 7) * DAY), label: name === 'new year' ? 'after New Year' : `after ${name[0].toUpperCase()}${name.slice(1)}` };
    }
  }
  const b = parts(base);
  if (/\bnext\s+(financial\s+year|fy)\b/.test(t)) return { date: nextOf(3, 1, base), label: 'next financial year' };
  if (/\bnext\s+quarter\b|\bq[1-4]\b.*\bnext\b/.test(t)) {
    const q = Math.floor(b.m / 3) + 1;
    return { date: zoned(b.y + (q === 4 ? 1 : 0), (q * 3) % 12, 1), label: 'next quarter' };
  }
  if (/\bnext\s+year\b|\bagle\s+saal\b/.test(t)) return { date: zoned(b.y + 1, 0, 5), label: 'next year' };
  if (/\bnext\s+month\b|\bagle\s+mahine\b/.test(t)) return { date: zoned(b.y, b.m + 1, 1), label: 'next month' };
  if (/\bnext\s+week\b|\bagle\s+hafte\b/.test(t)) return { date: new Date(base.getTime() + 7 * DAY), label: 'next week' };
  // "5 Dec", "5th December", "Dec 5"
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RX}\\b`))) || (m = t.match(new RegExp(`\\b${MONTH_RX}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
    const day = Number(/^\d/.test(m[1]) ? m[1] : m[2]);
    const mon = monthIndex(/^\d/.test(m[1]) ? m[2] : m[1]);
    if (day >= 1 && day <= 31 && mon >= 0) return { date: nextOf(mon, day, base), label: m[0].trim() };
  }
  // "in March", "March mein", "after March", "end of March", "mid March", "by March"
  if ((m = t.match(new RegExp(`\\b(after|post|in|by|from|early|mid|end of|till|until)?\\s*${MONTH_RX}\\b(\\s+(?:mein|me|ke baad|tak))?`)))) {
    const mon = monthIndex(m[2]);
    if (mon >= 0 && !/^may$/.test(m[2]) || /\b(in|by|after|from|till|until|early|mid|end of)\s+may\b|\bmay\s+(mein|me|ke baad)\b/.test(t)) {
      const after = /after|post/.test(m[1] || '') || /ke baad/.test(m[3] || '');
      const day = /mid/.test(m[1] || '') ? 15 : /end of/.test(m[1] || '') ? 25 : 1;
      let date = nextOf(after ? (mon + 1) % 12 : mon, day, base);
      if (!after && parts(date).m === b.m && parts(date).y === b.y) date = nextOf(mon, day, new Date(base.getTime() + 32 * DAY)); // "in November" said in November -> next year
      return { date, label: m[0].trim() };
    }
  }
  return null;
}

/** a meeting time in a message: "tomorrow at 3 pm", "Monday 11am", "27 Nov at 3:30 PM", "today 4pm" -> Date */
export function findMeetingTime(text, base = new Date()) {
  const t = ` ${String(text || '').toLowerCase()} `;
  let day = null;
  const b = parts(base);
  if (/\btomorrow\b|\bkal\b/.test(t)) day = parts(new Date(base.getTime() + DAY));
  else if (/\btoday\b|\baaj\b|\bthis (afternoon|evening)\b/.test(t)) day = b;
  else {
    const wds = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const w = t.match(/\b(?:on\s+|this\s+|next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*day\b/);
    if (w) {
      const now = wds.indexOf(b.wd.slice(0, 3).toLowerCase());
      let add = (wds.indexOf(w[1]) - now + 7) % 7 || 7;
      if (/next\s+/.test(w[0]) && add < 7) add += 7;
      day = parts(new Date(base.getTime() + add * DAY));
    }
    const dm = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RX}\\b`)) || t.match(new RegExp(`\\b${MONTH_RX}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
    if (!day && dm) {
      const dd = Number(/^\d/.test(dm[1]) ? dm[1] : dm[2]);
      const mon = monthIndex(/^\d/.test(dm[1]) ? dm[2] : dm[1]);
      if (mon >= 0) day = parts(nextOf(mon, dd, base));
    }
  }
  const tm = t.match(/\b(?:at|@|around|by)?\s*(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b/) || t.match(/\b(?:at|@)\s*(\d{1,2})[:.](\d{2})\b/);
  let hh = null;
  let mm = 0;
  if (tm) {
    hh = Number(tm[1]);
    mm = Number(tm[2] || 0);
    if (/p/.test(tm[3] || '') && hh < 12) hh += 12;
    if (/a/.test(tm[3] || '') && hh === 12) hh = 0;
    if (!tm[3] && hh < 8) hh += 12; // "at 3:30" in office talk = afternoon
  }
  if (!day && hh === null) return null;
  if (!day) day = b; // a time alone: today (or tomorrow if it has passed)
  let at = zoned(day.y, day.m, day.d, hh ?? 11, mm);
  if (at.getTime() < base.getTime() - 3600000) at = new Date(at.getTime() + DAY);
  return { at, timeKnown: hh !== null };
}

/* ---------------- reading a reply ---------------- */
const OOO_RX = /\b(out of (the )?office|on (annual |sick )?leave|on vacation|on holiday|travell?ing (till|until)|away (till|until|from)|back (on|by)|returning on|will be back|limited access to (my )?email|chhutti)\b/;
const NOT_RX = [
  /\bnot\s+interested\b/, /\bno\s+thanks?\b/, /\bno,?\s+thank\s+you\b/, /\bnot\s+(required|needed|looking|a priority)\b/, /\b(don'?t|do not)\s+(have\s+)?(any\s+)?(need|requirement)/,
  /\bno\s+(requirement|need)\b/, /\b(already|currently)\s+(have|work(ing)?\s+with|using|partnered)\b.*\b(agency|partner|team|vendor)\b/, /\bin-?house\s+(team|marketing)\b/,
  /\bno\s+budget\b/, /\bbudget\s+(is\s+)?(not|nahi|nahin|exhausted|frozen)\b/, /\bnot\s+a\s+(good\s+)?fit\b/, /\bnot\s+relevant\b/, /\b(nahi|nahin)\s+chahiye\b/,
  /\b(zarurat|zaroorat|requirement)\s+(nahi|nahin)\b/, /\binterested\s+(nahi|nahin)\b/, /\bpass\s+on\s+this\b/, /\bplease\s+(don'?t|do not)\s+follow\s+up\b/, /\bwe\s+will\s+pass\b/,
];
const LATER_RX = /\b(later|after|next|baad|abhi\s+(nahi|nahin)|not\s+(right\s+)?now|at\s+the\s+moment|currently|this\s+time|revisit|circle\s+back|reconnect|touch\s+base|get\s+back|reach\s+out|connect)\b/;
const HOT_RX = /\b(yes|interested|let'?s\s+(connect|talk|discuss|meet|do it)|share\s+(more\s+)?(details|deck|proposal|info)|send\s+(me\s+)?(more\s+)?(details|deck|proposal|info)|sounds\s+good|happy\s+to|call\s+me|available|schedule|book|meeting|set up a call|go ahead|quote|pricing|rate card)\b/;

/** what a reply most likely means. Mixed "not now, maybe March" takes the safer path: later. */
export function classifyReply(text, at = new Date()) {
  const t = ` ${String(text || '').toLowerCase().replace(/\s+/g, ' ')} `;
  if (!t.trim()) return { type: 'hot', check: true };
  if (OOO_RX.test(t)) {
    const d = findLaterDate(t.replace(/\b(till|until|back on|back by|returning on|from)\b/g, ' '), at) || findLaterDate(t, at);
    return { type: 'ooo', date: d?.date || new Date(at.getTime() + 7 * DAY), check: !d, label: d?.label };
  }
  const no = NOT_RX.some((r) => r.test(t));
  const when = findLaterDate(t, at);
  const laterWords = LATER_RX.test(t);
  if (when && (no || laterWords)) return { type: 'later', date: when.date, label: when.label };
  if (no) {
    const reason = /agency|partner|in-?house|vendor|team/.test(t) ? 'agency' : /budget/.test(t) ? 'budget' : /relevant|fit|need|requirement|zarurat|zaroorat/.test(t) ? 'not_relevant' : 'other';
    if (laterWords && /\b(later|future|in touch|keep (us|me) posted|down the line|baad)\b/.test(t)) return { type: 'later', date: null, label: 'later (no date)' };
    return { type: 'not_interested', reason };
  }
  if (/\b(connect|talk|reach out|get back|touch base|circle back|follow up)\b.{0,30}\b(later|after|next|baad)\b|\babhi\s+(nahi|nahin)\b|\bbaad\s+(mein|me)\b|\bnot\s+(right\s+)?now\b|\bmaybe\s+later\b|\bsome\s*time\s+later\b|\bkeep\s+in\s+touch\b|\bdown\s+the\s+line\b/.test(t)) {
    return { type: 'later', date: when?.date || null, label: when?.label || 'later (no date)' };
  }
  const meet = findMeetingTime(t, at);
  return { type: 'hot', meeting: meet && /\b(meet|meeting|call|zoom|google meet|teams|catch up|discuss|connect|talk|baat|available)\b/.test(t) ? meet : null, check: !HOT_RX.test(t) };
}

/* ---------------- helpers ---------------- */
const w = () => import('./worker.js'); // the worker imports this file too: load it when needed
const lc = () => import('./lifecycle.js');
const first = (s) => String(s || '').trim().split(/\s+/)[0] || '';

async function meetingOwner() {
  const owners = await (await lc()).stepOwners();
  return owners.meeting?._id || null;
}

/** every person at the company is "later" / "not interested" (or can't be emailed) -> the company moves there too */
export async function settleCompany(companyId) {
  if (!companyId) return null;
  const c = await Company.findById(companyId);
  if (!c || ['account', 'old_client'].includes(c.stage)) return null;
  const people = await Contact.find({ companyId }).select('status outcome email').lean();
  const live = people.filter((p) => !['unsubscribed', 'bounced'].includes(p.status));
  if (!live.length) return null;
  const decided = live.every((p) => ['later', 'not_interested'].includes(p.outcome));
  let to = null;
  if (decided) to = live.some((p) => p.outcome === 'later') ? 'later' : 'not_interested';
  else if (['later', 'not_interested'].includes(c.stage)) to = live.some((p) => p.status === 'replied' && !p.outcome) ? 'hot' : 'cold';
  if (!to || to === c.stage) return null;
  const from = c.stage;
  c.stage = to;
  await c.save();
  if (['later', 'not_interested'].includes(to)) await HrTask.updateMany({ company: c._id, step: { $in: ['meeting', 'contract'] }, status: { $ne: 'done' } }, { $set: { status: 'done', doneAt: new Date() } });
  await stageChanged(c, from, to);
  return { from, to };
}

export async function cancelScheduled(contactId, why) {
  return ScheduledEmail.updateMany({ contact: contactId, status: { $in: ['scheduled', 'held'] } }, { $set: { status: 'cancelled', error: why } });
}

async function schedule({ contact, kind, sendAt, body, remaining = 0, action, by, subject, cc, nextBodies }) {
  if (!body?.trim()) throw Object.assign(new Error('Write or choose the message'), { status: 400 });
  if (!sendAt || Number.isNaN(new Date(sendAt).getTime())) throw Object.assign(new Error('Choose a date'), { status: 400 });
  return ScheduledEmail.create({ contact: contact._id, company: contact.companyId, kind, sendAt: new Date(sendAt), subject: subject?.slice(0, 300) || undefined, body: body.slice(0, 20000), cc: cc || [], nextBodies: (nextBodies || []).map((b) => String(b).slice(0, 20000)), remaining, action, by });
}

/* ---------------- a reply came in (called by the worker) ---------------- */
// The reply is already saved and the person's follow-ups are stopped. Only "hot" replies move the company now;
// everything else becomes a suggestion that waits for a person.
export async function onReply(contact, verdict, { reply, quote, at }) {
  await cancelScheduled(contact._id, 'They replied');
  await Action.updateMany({ contact: contact._id, kind: { $in: ['reply', 'manual'] }, status: 'open' }, { $set: { status: 'dismissed', decidedBy: 'CRM', decidedAt: new Date(), decision: { note: 'A newer reply came in' } } });
  const fresh = await Contact.findById(contact._id).lean();
  if (verdict.type === 'hot') {
    if (verdict.meeting) await suggestMeeting({ contact: fresh, at: verdict.meeting.at, timeKnown: verdict.meeting.timeKnown, source: 'email', quote, reply });
    // ask only when it would move the company (Hot lead / Opportunity, or back from Future follow-up / Not interested)
    const c = fresh?.companyId ? await Company.findById(fresh.companyId).select('stage').lean() : null;
    const target = fresh?.companyId ? await (await w()).stageFromReplies(fresh.companyId) : 'hot';
    const parked = Boolean(fresh?.outcome) || ['later', 'not_interested', 'cold'].includes(c?.stage);
    const moves = !c || parked || (STAGE_RANK[target] ?? 1) > (STAGE_RANK[c.stage] ?? 0);
    if (!moves) return null;
    const a = await Action.create({
      kind: 'reply',
      contact: contact._id,
      company: fresh?.companyId,
      reply: reply?._id,
      quote: String(quote || '').slice(0, 2000),
      suggestion: { type: 'hot', check: Boolean(verdict.check), note: target === 'opportunity' && !parked ? 'Replied again: suggested Opportunity' : 'Suggested: Hot lead (the meeting task goes to its owner)' },
    });
    await notify('action', fresh, { text: `Replied: ${String(quote || '').slice(0, 140)}` });
    return a;
  }
  const a = await Action.create({
    kind: 'reply',
    contact: contact._id,
    company: fresh?.companyId,
    reply: reply?._id,
    quote: String(quote || '').slice(0, 2000),
    suggestion: { type: verdict.type, date: verdict.date || null, reason: verdict.reason, check: Boolean(verdict.check), note: verdict.label ? `From the reply: "${verdict.label}"` : '' },
  });
  const what = { later: 'Future follow-up', not_interested: 'Not interested', ooo: 'Out of office' }[verdict.type];
  await notify('action', fresh, { text: `Suggested: ${what}. ${String(quote || '').slice(0, 140)}` });
  return a;
}

/** a meeting found in an email (text or invite) or the calendar: suggest it, or update the suggestion / meeting already there */
export async function suggestMeeting({ contact, company, at, timeKnown = true, source, quote = '', reply, calendarUid, title, cancelled = false, emailAt }) {
  const companyId = company || contact?.companyId;
  if (!companyId || !at) return null;
  const near = (a, b) => Math.abs(new Date(a) - new Date(b)) <= 30 * 60000;
  // a meeting that is already set
  const set = await Meeting.findOne({ company: companyId, status: 'set', ...(calendarUid ? { $or: [{ calendarUid }, { at: { $gte: new Date(at - 2 * DAY), $lte: new Date(+at + 2 * DAY) } }] } : { at: { $gte: new Date(at - 2 * DAY), $lte: new Date(+at + 2 * DAY) } }) });
  if (set) {
    // a change to a meeting that is already set is never applied by itself: ask in Needs you
    const change = cancelled && (set.calendarUid === calendarUid || !set.calendarUid) ? 'meeting_cancel' : !cancelled && !near(set.at, at) && source === 'calendar' ? 'meeting_move' : null;
    if (!change) {
      if (!cancelled) {
        set.sources = [...new Set([...(set.sources || []), source])];
        if (calendarUid) set.calendarUid = calendarUid;
        await set.save();
      }
      return set;
    }
    await Action.updateMany({ kind: 'meeting', meeting: set._id, status: 'open' }, { $set: { status: 'dismissed', decidedBy: 'CRM', decidedAt: new Date(), decision: { note: 'A newer calendar change' } } });
    const a = await Action.create({
      kind: 'meeting',
      meeting: set._id,
      contact: contact?._id || set.contact,
      company: companyId,
      quote: String(title || quote || '').slice(0, 500),
      suggestion: { type: change, date: change === 'meeting_move' ? at : set.at, sources: ['calendar'], note: change === 'meeting_move' ? `Set for ${fmt(set.at)}, the calendar now says ${fmt(at)}` : `The calendar says the meeting on ${fmt(set.at)} was cancelled` },
      assignees: (await meetingOwner()) ? [await meetingOwner()] : [],
      decision: { meetingId: String(set._id), calendarUid },
    });
    await notify('action', contact, { text: change === 'meeting_move' ? `Meeting moved in the calendar: ${fmt(set.at)} → ${fmt(at)}. Update it?` : `Meeting on ${fmt(set.at)} cancelled in the calendar. Mark it cancelled?` });
    return a;
  }
  if (cancelled) {
    await Action.updateMany({ kind: 'meeting', company: companyId, status: 'open', 'suggestion.date': { $gte: new Date(at - DAY), $lte: new Date(+at + DAY) } }, { $set: { status: 'dismissed', decidedBy: 'CRM', decidedAt: new Date(), decision: { note: 'Cancelled in the calendar' } } });
    return null;
  }
  // an open suggestion: email + calendar together
  const open = await Action.findOne({ kind: 'meeting', company: companyId, status: 'open' }).sort({ createdAt: -1 });
  if (open) {
    const s = open.suggestion;
    const sources = [...new Set([...(s.sources || []), source])];
    let note = s.note || '';
    if (s.date && !near(s.date, at)) {
      if (source === 'calendar') {
        note = `Email said ${fmt(s.date)}, calendar says ${fmt(at)}. Using the calendar time.`;
        s.date = at;
      } else if (!(s.sources || []).includes('calendar')) {
        note = `Two times found: ${fmt(s.date)} and ${fmt(at)}. Check the time.`;
        s.date = at;
      }
    } else if (s.date && near(s.date, at) && sources.length > 1) note = 'Email and calendar agree.';
    open.suggestion = { ...(s.toObject ? s.toObject() : s), sources, note, check: sources.length === 1 && sources[0] === 'email' && !timeKnown, date: s.date || at };
    if (calendarUid) open.decision = { ...(open.decision || {}), calendarUid };
    if (quote && !open.quote) open.quote = quote;
    await open.save();
    return open;
  }
  const owner = await meetingOwner();
  const a = await Action.create({
    kind: 'meeting',
    contact: contact?._id,
    company: companyId,
    reply: reply?._id,
    emailAt: emailAt || reply?.receivedAt || undefined,
    quote: String(quote || title || '').slice(0, 2000),
    suggestion: { type: 'meeting', date: at, sources: [source], check: source === 'email' && !timeKnown, note: source === 'email' && !timeKnown ? 'No time in the email: check the time.' : '' },
    assignees: owner ? [owner] : [],
    decision: calendarUid ? { calendarUid } : undefined,
  });
  await notify('action', contact, { text: `Meeting found (${source}): ${fmt(at)}. Set it?` });
  return a;
}

const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: tz(), day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/* ---------------- a referral: someone named / CC'd / replied for a new person ---------------- */
// The new person is never emailed on their own. The admin sees who referred them and decides: email them now
// (first email + follow-ups chosen and previewed right there), on a date, or by hand.
export async function suggestReferral(person, referrer, { how = '', quote = '' } = {}) {
  if (!person?._id || (await Action.exists({ kind: 'referral', contact: person._id }))) return null;
  const a = await Action.create({
    kind: 'referral',
    contact: person._id,
    company: person.companyId || referrer?.companyId,
    quote: String(quote || '').slice(0, 2000),
    suggestion: { type: 'referral', note: `${referrer?.name || referrer?.email || 'Someone'} ${how ? `(${how})` : 'referred them'}` },
    decision: { referrer: referrer?._id || null, referrerName: referrer?.name || referrer?.email || '' },
  });
  await notify('action', person, { text: `${referrer?.name || 'Someone'} referred ${person.name || person.email}. Email them?` });
  return a;
}

/** once: the referrals already in the CRM that were never emailed get their question too */
export async function backfillReferrals() {
  // a referral that was already in the CRM before it was referred may miss the mark: never auto-email them either
  await Contact.updateMany({ source: /^Referral/i, fromReply: { $ne: true } }, { $set: { fromReply: true } });
  const people = await Contact.find({ fromReply: true, email: { $type: 'string' }, status: 'new' }).lean();
  let made = 0;
  for (const p of people) {
    if (await Action.exists({ kind: 'referral', contact: p._id })) continue;
    if (await EmailLog.exists({ contact: p._id })) continue;
    const name = String(p.referredBy || '').replace(/\s*\(.*\)\s*$/, '').trim();
    const referrer = p.companyId && name ? await Contact.findOne({ companyId: p.companyId, name, _id: { $ne: p._id } }).lean() : null;
    const how = (String(p.referredBy || '').match(/\(([^)]+)\)/) || [])[1] || '';
    const reply = referrer ? await Reply.findOne({ contact: referrer._id }).sort({ receivedAt: -1 }).select('snippet').lean() : null;
    if (await suggestReferral(p, referrer || { name }, { how, quote: reply?.snippet || '' })) made++;
  }
  return made;
}

/* ---------------- deciding ---------------- */
// body: { choice, date, reason, body (message), more (bool), winback (bool), winbackBody, notes, at }
export async function decide(action, body = {}, by = 'admin') {
  if (action.status !== 'open') throw Object.assign(new Error('This was already decided'), { status: 409 });
  const choice = String(body.choice || '');
  const contact = action.contact ? await Contact.findById(action.contact) : null;
  const s = await actionSettings();
  const undo = { contact: contact ? { outcome: contact.outcome || null, outcomeReason: contact.outcomeReason || null, laterAt: contact.laterAt || null, status: contact.status } : null, scheduled: [], meetings: [], stage: null, enrollments: [] };
  const company = action.company ? await Company.findById(action.company).select('stage').lean() : null;
  undo.stage = company?.stage || null;
  const result = { choice };
  const setOutcome = async (outcome, extra = {}) => {
    await Contact.updateOne({ _id: contact._id }, { $set: { outcome, outcomeAt: new Date(), ...extra } });
    result.company = await settleCompany(contact.companyId);
  };
  const plan = async (kind, date, msg, remaining) => {
    const x = await schedule({ contact, kind, sendAt: date, body: msg, remaining, action: action._id, by });
    undo.scheduled.push(String(x._id));
    return x;
  };

  if (action.kind === 'reply' || (action.kind === 'meeting_outcome' && ['later', 'get_back', 'details', 'not_interested'].includes(choice))) {
    if (!contact) throw Object.assign(new Error('The person was deleted'), { status: 404 });
    if (choice === 'later' || choice === 'get_back' || choice === 'details') {
      const date = body.date ? new Date(body.date) : choice === 'details' && !body.date ? null : addMonths(new Date(), s.laterMonths);
      if (choice === 'details') {
        // they want more details: the company is an Opportunity; a follow-up only if one was chosen
        const c = await Company.findById(contact.companyId);
        if (c && !['opportunity', 'account', 'old_client'].includes(c.stage)) {
          const from = c.stage;
          c.stage = 'opportunity';
          await c.save();
          await stageChanged(c, from, 'opportunity');
          result.company = { from, to: 'opportunity' };
        }
        if (date && body.body) await plan('after_meeting', date, body.body, body.more ? 2 : 0);
      } else {
        await plan(action.kind === 'meeting_outcome' ? 'after_meeting' : 'later', date, body.body, body.more ? 2 : 0);
        if (choice === 'later') await setOutcome('later', { laterAt: date });
      }
    } else if (choice === 'not_interested') {
      await setOutcome('not_interested', { outcomeReason: String(body.reason || action.suggestion?.reason || 'other').slice(0, 40) });
      if (body.winback) await plan('winback', body.winbackDate ? new Date(body.winbackDate) : addMonths(new Date(), s.winbackMonths), body.winbackBody || body.body, 0);
    } else if (choice === 'ooo') {
      // out of office: the follow-ups start again on the return date
      const date = body.date ? new Date(body.date) : action.suggestion?.date || new Date(Date.now() + 7 * DAY);
      const enr = await Enrollment.find({ contact: contact._id, status: 'replied' }).sort({ updatedAt: -1 }).limit(1);
      for (const e of enr) {
        undo.enrollments.push({ id: String(e._id), status: e.status, nextSendAt: e.nextSendAt });
        e.status = 'active';
        e.nextSendAt = date;
        await e.save();
      }
      await Contact.updateOne({ _id: contact._id }, { $set: { status: 'contacted' } });
      if (action.reply) await Reply.updateOne({ _id: action.reply }, { $set: { isAutoReply: true, handled: true } });
      result.resumed = enr.length;
    } else if (choice === 'hot') {
      // a real interest after all: into the main flow (Hot lead + the meeting task)
      if (contact.outcome) await Contact.updateOne({ _id: contact._id }, { $set: { outcome: null } });
      const c = await Company.findById(contact.companyId);
      if (c && ['later', 'not_interested', 'cold'].includes(c.stage)) {
        const from = c.stage;
        c.stage = 'hot';
        await c.save();
        await stageChanged(c, from, 'hot');
        result.company = { from, to: 'hot' };
      } else await (await w()).movePipeline(contact);
    } else if (choice !== 'nothing') throw Object.assign(new Error('Choose what to do'), { status: 400 });
  }

  if (action.kind === 'estimate') {
    if (choice === 'opportunity') {
      const c = await Company.findById(action.company);
      if (c && !['opportunity', 'account', 'old_client'].includes(c.stage)) {
        const from = c.stage;
        c.stage = 'opportunity';
        await c.save();
        await stageChanged(c, from, 'opportunity');
        result.company = { from, to: 'opportunity' };
      }
    } else if (choice !== 'nothing') throw Object.assign(new Error('Choose what to do'), { status: 400 });
  }

  if (action.kind === 'referral') {
    if (!contact?.email) throw Object.assign(new Error('This person has no email'), { status: 400 });
    if (choice === 'email' || choice === 'email_later') {
      if (!String(body.subject || '').trim()) throw Object.assign(new Error('Write the subject'), { status: 400 });
      const date = choice === 'email_later' ? (body.date ? new Date(body.date) : null) : new Date();
      if (!date || Number.isNaN(date.getTime())) throw Object.assign(new Error('Choose the date'), { status: 400 });
      const referrer = action.decision?.referrer ? await Contact.findById(action.decision.referrer).select('email').lean() : null;
      const nextBodies = (Array.isArray(body.nextBodies) ? body.nextBodies : []).map((b) => String(b || '')).filter((b) => b.trim()).slice(0, 3);
      const x = await schedule({ contact, kind: 'referral', sendAt: date, subject: String(body.subject).trim(), body: body.body, cc: body.cc && referrer?.email ? [referrer.email] : [], nextBodies, remaining: nextBodies.length, action: action._id, by });
      undo.scheduled.push(String(x._id));
      if (choice === 'email') setImmediate(() => runScheduled().catch(() => {}));
    } else if (choice !== 'by_hand') throw Object.assign(new Error('Choose what to do'), { status: 400 });
  }

  if (action.kind === 'manual') {
    const held = action.decision?.held || {};
    undo.held = held;
    if (choice === 'continue' || choice === 'as_planned') {
      const date = choice === 'continue' ? (body.date ? new Date(body.date) : action.suggestion?.date) : null;
      if (choice === 'continue' && (!date || Number.isNaN(date.getTime()))) throw Object.assign(new Error('Choose the date'), { status: 400 });
      for (const eid of held.enrollments || []) await Enrollment.updateOne({ _id: eid, status: 'active' }, { $set: { paused: false, ...(date ? { nextSendAt: date } : {}) } });
      for (const sid of held.scheduled || []) {
        const x = await ScheduledEmail.findById(sid);
        if (x?.status !== 'held') continue;
        x.status = 'scheduled';
        if (date && date > x.sendAt) x.sendAt = date;
        await x.save();
      }
    } else if (choice === 'stop') {
      await Enrollment.updateMany({ _id: { $in: held.enrollments || [] }, status: 'active' }, { $set: { status: 'stopped', paused: false } });
      await ScheduledEmail.updateMany({ _id: { $in: held.scheduled || [] }, status: 'held' }, { $set: { status: 'cancelled', error: 'Stopped after an email by hand' } });
    } else throw Object.assign(new Error('Choose what to do'), { status: 400 });
  }

  if (action.kind === 'meeting' && action.decision?.meetingId) {
    // a calendar change to a meeting that was already set
    const m = await Meeting.findById(action.decision.meetingId);
    if (!m) throw Object.assign(new Error('The meeting was deleted'), { status: 404 });
    undo.meeting = { id: String(m._id), status: m.status, outcome: m.outcome || null, notes: m.notes || null, at: m.at };
    if (choice === 'set') {
      const at = body.at ? new Date(body.at) : action.suggestion?.date;
      if (!at || Number.isNaN(at.getTime())) throw Object.assign(new Error('Choose the meeting time'), { status: 400 });
      m.at = at;
      m.outcomeAsked = false;
      await m.save();
      await meetingTask(m.company, at);
    } else if (choice === 'cancel') {
      m.status = 'cancelled';
      await m.save();
    } else if (choice !== 'nothing') throw Object.assign(new Error('Choose what to do'), { status: 400 });
  } else if (action.kind === 'meeting') {
    if (choice === 'set') {
      const at = body.at ? new Date(body.at) : action.suggestion?.date;
      if (!at || Number.isNaN(at.getTime())) throw Object.assign(new Error('Choose the meeting time'), { status: 400 });
      const m = await Meeting.create({ company: action.company, contact: action.contact, at, sources: action.suggestion?.sources || [], calendarUid: action.decision?.calendarUid, title: action.quote?.slice(0, 200), by });
      undo.meetings.push(String(m._id));
      await meetingTask(action.company, at);
      result.meeting = String(m._id);
    } else if (choice !== 'nothing') throw Object.assign(new Error('Choose what to do'), { status: 400 });
  }

  if (action.kind === 'meeting_outcome') {
    const m = action.meeting ? await Meeting.findById(action.meeting) : null;
    if (m) {
      undo.meeting = { id: String(m._id), status: m.status, outcome: m.outcome || null, notes: m.notes || null, at: m.at };
      m.status = choice === 'didnt_happen' ? 'set' : 'done';
      m.outcome = choice;
      if (body.notes) m.notes = String(body.notes).slice(0, 5000);
      if (choice === 'didnt_happen') {
        if (body.at) {
          m.at = new Date(body.at);
          m.outcomeAsked = false;
          await meetingTask(m.company, m.at);
        } else m.status = 'cancelled';
      }
      await m.save();
    }
    if (choice === 'deal') {
      result.convert = `/lead?company=${action.company}&convert=1`;
      const c = await Company.findById(action.company).select('name').lean();
      await notify('action', contact, { text: `${by}: the meeting with ${c?.name || 'the lead'} went well, deal done. Convert it to an account (checklist).` });
    }
    if (!['deal', 'didnt_happen', 'later', 'get_back', 'details', 'not_interested'].includes(choice)) throw Object.assign(new Error('Choose how the meeting went'), { status: 400 });
  }

  action.status = 'done';
  action.decision = { ...(action.decision || {}), ...body, ...result };
  action.undo = undo;
  action.decidedBy = by;
  action.decidedAt = new Date();
  await action.save();
  return action;
}

/** the open "Reply and book a meeting" task gets the meeting date (or a new task is made) */
async function meetingTask(companyId, at) {
  const c = await Company.findById(companyId).lean();
  if (!c) return;
  const due = new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(at);
  const t = await HrTask.findOne({ company: c._id, step: 'meeting', status: { $ne: 'done' } });
  if (t) {
    t.details = `Meeting on ${fmt(at)}. After it, answer "How was the meeting?" in Needs you.`;
    t.due = due;
    await t.save();
  } else {
    const owner = await meetingOwner();
    if (owner) await HrTask.create({ user: owner, title: `Meeting – ${c.name}`, details: `Meeting on ${fmt(at)}. After it, answer "How was the meeting?" in Needs you.`, due, priority: 'high', step: 'meeting', company: c._id });
  }
}

export const meetingTaskFor = meetingTask;

/** put back what a decision changed (only while no email from it has gone out) */
export async function undoDecision(action, by = 'admin') {
  if (action.status !== 'done' || !action.undo) throw Object.assign(new Error('Nothing to undo'), { status: 400 });
  const u = action.undo;
  if (u.scheduled?.length && (await ScheduledEmail.exists({ _id: { $in: u.scheduled }, status: { $in: ['sending', 'sent'] } }))) {
    throw Object.assign(new Error('An email from this decision was already sent, so it cannot be undone'), { status: 409 });
  }
  if (u.scheduled?.length) await ScheduledEmail.updateMany({ _id: { $in: u.scheduled } }, { $set: { status: 'cancelled', error: `Undone by ${by}` } });
  if (u.meetings?.length) await Meeting.deleteMany({ _id: { $in: u.meetings } });
  if (u.meeting?.id) await Meeting.updateOne({ _id: u.meeting.id }, { $set: { status: u.meeting.status, outcome: u.meeting.outcome, notes: u.meeting.notes, at: u.meeting.at } });
  for (const e of u.enrollments || []) await Enrollment.updateOne({ _id: e.id }, { $set: { status: e.status, nextSendAt: e.nextSendAt } });
  if (u.held) {
    // emailed by hand: hold the system emails again (dates stay as they are now)
    await Enrollment.updateMany({ _id: { $in: u.held.enrollments || [] }, status: { $in: ['active', 'stopped'] } }, { $set: { status: 'active', paused: true } });
    await ScheduledEmail.updateMany({ _id: { $in: u.held.scheduled || [] }, status: { $in: ['scheduled', 'cancelled'] } }, { $set: { status: 'held' } });
  }
  if (u.contact && action.contact) await Contact.updateOne({ _id: action.contact }, { $set: u.contact });
  if (u.stage && action.company) {
    const c = await Company.findById(action.company);
    if (c && c.stage !== u.stage) {
      const from = c.stage;
      c.stage = u.stage;
      await c.save();
      await stageChanged(c, from, u.stage);
    }
  }
  action.status = 'open';
  action.decision = { ...(action.decision || {}), undoneBy: by, undoneAt: new Date() };
  action.undo = null;
  await action.save();
  return action;
}

/* ---------------- sending the planned follow-ups ---------------- */
let running = false;
export async function runScheduled() {
  if (running) return { reason: 'already running' };
  running = true;
  const out = { sent: 0, failed: 0 };
  try {
    const W = await w();
    const { smtpReady } = await import('./config.js');
    if (!smtpReady() || (await getSetting('paused', false))) return out;
    if (!W.inSendWindow()) return out;
    let left = config.dailyLimit - (await W.sentToday());
    if (left <= 0) return out;
    // planned follow-ups are "older" emails (from PENDING_START_HOUR); a referral's approved emails go like a fresh upload
    const due = await ScheduledEmail.find({ status: 'scheduled', sendAt: { $lte: new Date() }, ...(W.olderEmailsOpen() ? {} : { kind: 'referral' }) }).sort({ sendAt: 1 }).limit(Math.min(left, 50));
    for (const s of due) {
      if (left <= 0) break;
      const claimed = await ScheduledEmail.findOneAndUpdate({ _id: s._id, status: 'scheduled' }, { $set: { status: 'sending' } });
      if (!claimed) continue;
      const r = await sendPlanned(s);
      if (r === 'sent') {
        out.sent++;
        left--;
        await new Promise((ok) => setTimeout(ok, config.sendDelaySec * 1000));
      } else if (r === 'failed') out.failed++;
    }
    await closeNoReply();
  } catch (e) {
    console.error('[scheduled]', e.message);
  } finally {
    running = false;
  }
  return out;
}

async function sendPlanned(s) {
  const contact = await Contact.findById(s.contact);
  const stop = async (why) => ScheduledEmail.updateOne({ _id: s._id }, { $set: { status: 'cancelled', error: why } }).then(() => 'skipped');
  if (!contact?.email) return stop('No email');
  if (['unsubscribed', 'bounced'].includes(contact.status) || (await Suppression.exists({ email: contact.email, reason: { $in: ['unsubscribed', 'bounced'] } }))) return stop(`Contact is ${contact.status}`);
  // same thread: the last email we sent them, and their last reply
  const logs = await EmailLog.find({ contact: contact._id, status: 'sent' }).sort({ sentAt: 1 }).select('messageId subject html text sentAt').lean();
  const prev = logs.at(-1) || null;
  const replies = await Reply.find({ contact: contact._id, messageId: { $type: 'string' } }).sort({ receivedAt: 1 }).select('messageId receivedAt').lean();
  const threadIds = [...logs, ...replies].sort((a, b) => new Date(a.sentAt || a.receivedAt) - new Date(b.sentAt || b.receivedAt)).map((x) => x.messageId).filter(Boolean);
  const root = (logs[0]?.subject || s.subject || `${contact.company || 'Geek Creative Agency'}`).replace(/^(re:\s*)+/i, '');
  const subject = logs.length ? `Re: ${root}` : s.subject || root; // a first email (referral) starts its own thread
  const W = await w();
  const trackingId = crypto.randomBytes(16).toString('hex');
  const email = buildEmail(contact, subject, s.body, trackingId, prev, { signature: !W.hasSignature(s.body) });
  let messageId;
  try {
    messageId = await sendMail({ to: contact.email, name: contact.name, email, threadIds, unsub: unsubscribeUrl(contact), cc: (s.cc || []).filter((x) => x && x !== contact.email) });
  } catch (e) {
    const msg = String(e.response || e.message).slice(0, 300);
    await ScheduledEmail.updateOne({ _id: s._id }, { $set: { status: e.transient ? 'scheduled' : 'failed', error: msg, ...(e.transient ? { sendAt: new Date(Date.now() + 30 * 60000) } : {}) } });
    await EmailLog.create({ contact: contact._id, kind: s.kind, subject, status: 'failed', error: msg }).catch(() => {});
    await notify('failed', contact, { text: msg });
    return 'failed';
  }
  const now = new Date();
  await ScheduledEmail.updateOne({ _id: s._id }, { $set: { status: 'sent', sentAt: now } });
  await EmailLog.create({ contact: contact._id, kind: s.kind, subject: email.subject, html: email.core.html, text: email.core.text, messageId, trackingId, sentAt: now });
  await notify('sent', contact, { text: `${KIND_LABEL[s.kind]}: ${email.subject}` });
  await Contact.updateOne({ _id: contact._id }, { $set: { lastContactedAt: now } });
  if (s.remaining > 0) {
    const { templates, moreGapDays } = await actionSettings();
    const chosen = (s.nextBodies || []).filter((b) => b?.trim());
    const next = chosen[0] || (templates.find((t) => t.key === 'checking_in') || templates[0]).body; // the follow-up chosen when it was approved
    await ScheduledEmail.create({ contact: contact._id, company: contact.companyId, kind: s.kind, sendAt: W.addWorkingDays(now, moreGapDays), body: next, nextBodies: chosen.slice(1), remaining: s.remaining - 1, action: s.action, by: 'CRM' });
  }
  return 'sent';
}
export const KIND_LABEL = { later: 'Future follow-up', winback: 'Win-back email', after_meeting: 'Follow-up after the meeting', referral: 'Referral email' };

/** the last planned follow-up went 7 days ago and they never replied: "later" people go back to Cold */
async function closeNoReply() {
  const parked = await Contact.find({ outcome: 'later', laterAt: { $lte: new Date(Date.now() - 7 * DAY) } }).select('_id companyId repliedAt').lean();
  for (const p of parked) {
    if (await ScheduledEmail.exists({ contact: p._id, status: { $in: ['scheduled', 'sending'] } })) continue;
    const last = await ScheduledEmail.findOne({ contact: p._id, status: 'sent' }).sort({ sentAt: -1 }).lean();
    if (!last || Date.now() - new Date(last.sentAt) < 7 * DAY) continue;
    await Contact.updateOne({ _id: p._id }, { $set: { outcome: 'no_reply', outcomeAt: new Date() } });
    const c = await Company.findById(p.companyId);
    if (c?.stage === 'later' && !(await Contact.exists({ companyId: c._id, outcome: 'later' }))) {
      c.stage = 'cold';
      await c.save();
      await stageChanged(c, 'later', 'cold');
    }
  }
}

/* ---------------- after a meeting: "How was the meeting?" ---------------- */
export async function askMeetingOutcomes() {
  const over = await Meeting.find({ status: 'set', outcomeAsked: false, at: { $lte: new Date(Date.now() - 2 * 3600000) } }).limit(50);
  for (const m of over) {
    m.outcomeAsked = true;
    await m.save();
    if (await Action.exists({ kind: 'meeting_outcome', meeting: m._id, status: 'open' })) continue;
    const owner = await meetingOwner();
    const contact = m.contact ? await Contact.findById(m.contact).lean() : null;
    await Action.create({ kind: 'meeting_outcome', meeting: m._id, company: m.company, contact: m.contact, quote: m.title || '', suggestion: { type: 'outcome', date: m.at }, assignees: owner ? [owner] : [] });
    const c = await Company.findById(m.company).select('name').lean();
    await notify('action', contact, { text: `How was the meeting with ${c?.name || 'the lead'} (${fmt(m.at)})?` });
  }
}


/* ---------------- emails sent by hand from the mailbox (Sent folder) ---------------- */
// Someone (e.g. Aanchal) wrote to a lead from Gmail. If the CRM was about to email them too, it holds that email
// and asks in Needs you: continue after the hand-written one / send as planned / stop.
export const ManualEmail = model(
  'ManualEmail',
  new Schema(
    {
      contact: { type: id, ref: 'Contact', index: true },
      company: { type: id, ref: 'Company' },
      messageId: String,
      subject: String,
      snippet: String,
      to: String,
      sentAt: { type: Date, index: true },
    },
    { timestamps: true }
  ).index({ messageId: 1, contact: 1 }, { unique: true })
);

const OWN_ID = /^<(geekcrm|geeknews)\./i;
/** read the Sent folder since last time (client = a connected ImapFlow client) */
export async function checkSentFolder(client) {
  const boxes = await client.list();
  const sent = boxes.find((b) => b.specialUse === '\\Sent') || boxes.find((b) => /(^|\/)sent( mail| items)?$/i.test(b.path));
  if (!sent) return { skipped: 'No Sent folder' };
  const { simpleParser } = await import('mailparser');
  const W = await w();
  const lock = await client.getMailboxLock(sent.path);
  let found = 0;
  try {
    const state = (await getSetting('imapSent', null)) || {};
    const validity = String(client.mailbox.uidValidity);
    const known = state.validity === validity && state.lastUid;
    if (!known) {
      // first time: start from now (older hand-written emails are not looked at, so nothing running is held by surprise)
      await setSetting('imapSent', { validity, lastUid: Math.max(0, (client.mailbox.uidNext || 1) - 1) });
      return { started: true };
    }
    const uids = ((await client.search({ uid: `${state.lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > state.lastUid);
    let lastUid = known ? state.lastUid : 0;
    const msgs = [];
    if (uids.length) for await (const m of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) msgs.push(m);
    for (const m of msgs.sort((a, b) => a.uid - b.uid)) {
      lastUid = Math.max(lastUid, m.uid);
      const env = m.envelope || {};
      const messageId = env.messageId || '';
      if (OWN_ID.test(messageId) || (messageId && (await EmailLog.exists({ messageId })))) continue; // the CRM's own email
      const rcpt = [...(env.to || []), ...(env.cc || [])].map((a) => String(a.address || '').toLowerCase()).filter(Boolean);
      if (!rcpt.length) continue;
      const people = await Contact.find({ email: { $in: rcpt } }).lean();
      if (!people.length) continue;
      const at = env.date ? new Date(env.date) : new Date();
      // a copy of a CRM email with a changed Message-ID: same person, same subject, within 10 minutes
      let snippet = '';
      let files = [];
      try {
        const src = (await client.fetchOne(String(m.uid), { source: true }, { uid: true }))?.source;
        const parsed = await simpleParser(src);
        snippet = W.newText(parsed.text || '').slice(0, 600);
        files = (parsed.attachments || []).map((x) => x.filename || '').filter(Boolean);
      } catch {
        /* no text: the subject is enough */
      }
      for (const p of people) {
        const twin = await EmailLog.exists({ contact: p._id, subject: env.subject || '', sentAt: { $gte: new Date(at - 10 * 60000), $lte: new Date(+at + 10 * 60000) } });
        if (twin) continue;
        try {
          const me = await ManualEmail.create({ contact: p._id, company: p.companyId, messageId: messageId || `uid-${m.uid}`, subject: env.subject || '', snippet, to: p.email, sentAt: at });
          await onManualEmail(p, me);
          await readManualEmail(p, me, files);
          found++;
        } catch (e) {
          if (e?.code !== 11000) console.error('[sent]', e.message);
        }
      }
    }
    await setSetting('imapSent', { validity, lastUid });
  } finally {
    lock.release();
  }
  return { found };
}

/** what a hand-written email says: a meeting (time / link) or an estimate / proposal -> a question in Needs you */
const ESTIMATE_RX = /\b(estimates?|quotations?|quotes?|proposals?|pricing|rate ?cards?|commercials|costing|invoice)\b/i;
const MEET_LINK = /(meet\.google\.com|zoom\.us\/j|teams\.microsoft\.com|teams\.live\.com)/i;
export async function readManualEmail(contact, me, files = []) {
  const text = `${me.subject || ''}\n${me.snippet || ''}`;
  const t = findMeetingTime(text, new Date(me.sentAt));
  if (t && (MEET_LINK.test(text) || /\b(meeting|call|meet|zoom|discuss|connect|catch up)\b/i.test(text))) {
    await suggestMeeting({ contact, at: t.at, timeKnown: t.timeKnown, source: 'email', quote: `Sent by hand: ${text}`.slice(0, 1500), emailAt: me.sentAt });
  }
  const estimateFile = files.find((f) => ESTIMATE_RX.test(f));
  if ((ESTIMATE_RX.test(me.subject || '') || estimateFile) && contact.companyId) {
    const c = await Company.findById(contact.companyId).select('stage name').lean();
    if (c && !['opportunity', 'account', 'old_client'].includes(c.stage) && !(await Action.exists({ kind: 'estimate', company: c._id, status: 'open' }))) {
      await Action.create({
        kind: 'estimate',
        contact: contact._id,
        company: c._id,
        emailAt: me.sentAt,
        quote: `Subject: ${me.subject || ''}${files.length ? `\nAttached: ${files.join(', ')}` : ''}\n\n${me.snippet || ''}`.slice(0, 2000),
        suggestion: { type: 'estimate', date: me.sentAt, note: `An estimate / proposal seems to have been sent by hand on ${fmt(me.sentAt)}` },
      });
      await notify('action', contact, { text: `Estimate / proposal sent by hand to ${c.name}. Move it to Opportunity?` });
    }
  }
}

/** a hand-written email to a lead: hold the CRM's next email to them and ask what to do */
export async function onManualEmail(contact, me) {
  const lastCrm = await EmailLog.findOne({ contact: contact._id, status: 'sent', kind: { $ne: 'manual' } }).sort({ sentAt: -1 }).select('sentAt').lean();
  if (lastCrm && new Date(lastCrm.sentAt) > new Date(me.sentAt)) return null; // the CRM wrote after it: nothing to hold
  const enr = await Enrollment.find({ contact: contact._id, status: 'active', paused: { $ne: true } }).lean();
  const sch = await ScheduledEmail.find({ contact: contact._id, status: 'scheduled' }).lean();
  if (!enr.length && !sch.length) return null; // no system email coming: it is only shown on the timeline
  const W = await w();
  const next = [...enr.map((e) => e.nextSendAt), ...sch.map((s) => s.sendAt)].filter(Boolean).map((d) => new Date(d)).sort((a, b) => a - b)[0];
  const after = W.addWorkingDays(new Date(me.sentAt), config.intervalDays || 3);
  // the planned email is already on (or after) that day: keep it as it is; else move it to 3 working days after the email by hand
  const dayIst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(d);
  const date = next && dayIst(next) >= dayIst(after) ? next : after;
  // hold now, so nothing goes twice while waiting for a decision
  await Enrollment.updateMany({ _id: { $in: enr.map((e) => e._id) } }, { $set: { paused: true } });
  await ScheduledEmail.updateMany({ _id: { $in: sch.map((s) => s._id) } }, { $set: { status: 'held' } });
  const open = await Action.findOne({ kind: 'manual', contact: contact._id, status: 'open' });
  const held = { enrollments: [...new Set([...(open?.decision?.held?.enrollments || []), ...enr.map((e) => String(e._id))])], scheduled: [...new Set([...(open?.decision?.held?.scheduled || []), ...sch.map((s) => String(s._id))])], next: next || null };
  const quote = [me.subject ? `Subject: ${me.subject}` : '', me.snippet].filter(Boolean).join('\n\n');
  if (open) {
    open.quote = quote;
    open.emailAt = me.sentAt;
    open.suggestion = { type: 'manual', date, note: `Emailed by hand on ${fmt(me.sentAt)}` };
    open.decision = { ...(open.decision || {}), held };
    open.markModified('decision');
    await open.save();
    return open;
  }
  const a = await Action.create({ kind: 'manual', contact: contact._id, company: contact.companyId, emailAt: me.sentAt, quote, suggestion: { type: 'manual', date, note: `Emailed by hand on ${fmt(me.sentAt)}${next ? ` · the next system email was due ${fmt(next)}` : ''}` }, decision: { held } });
  await notify('action', contact, { text: `Emailed by hand: the next system email is on hold until you decide` });
  return a;
}

/* ---------------- what one person may see ---------------- */
export const mayAnswer = (req, a) => req.role === 'admin' || (req.role === 'team' && !['reply', 'manual', 'referral', 'estimate'].includes(a.kind) && (a.assignees || []).some((u) => String(u) === String(req.account?._id)));
export { User };
