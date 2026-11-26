// Meetings from calendars and from invites in emails.
// CALENDAR_ICS_URLS in .env = one or more "Secret address in iCal format" links (Google Calendar → Settings →
// the calendar → Integrate calendar), separated by commas. Read-only: the CRM never changes a calendar.
// Every event with a lead (their email, or their company's own email domain) becomes a meeting suggestion in
// Needs you, or confirms / moves / cancels one that is there (see suggestMeeting in actions.js).
import { config } from './config.js';
import { Contact, getSetting, setSetting } from './models.js';
import { suggestMeeting } from './actions.js';

const DAY = 86400000;
export const calendarUrls = () => String(process.env.CALENDAR_ICS_URLS || '').split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^https:\/\//i.test(s));

/* ---------------- a tiny iCalendar reader ---------------- */
const unfold = (text) => String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
const unescape = (v) => String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** "20261127T153000Z", "20261127T153000" with TZID=Asia/Kolkata, or "20261127" (all day) -> Date */
function icsDate(value, params = '') {
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh = '09', mi = '00', ss = '00', z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss));
  const zone = (params.match(/TZID=([^;:]+)/i) || [])[1] || config.timezone || 'Asia/Kolkata';
  const guess = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return new Date(guess - (shown - guess));
  } catch {
    return new Date(guess);
  }
}

/** every VEVENT: { uid, start, title, cancelled, emails[], method } */
export function parseIcs(text) {
  const lines = unfold(text).split('\n');
  const method = (lines.find((l) => /^METHOD:/i.test(l)) || '').split(':')[1]?.trim().toUpperCase() || '';
  const out = [];
  let ev = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^BEGIN:VEVENT/i.test(line)) ev = { emails: [], method };
    else if (/^END:VEVENT/i.test(line)) {
      if (ev?.start) out.push({ ...ev, cancelled: ev.cancelled || method === 'CANCEL' });
      ev = null;
    } else if (ev) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const head = line.slice(0, i);
      const value = line.slice(i + 1);
      const name = head.split(';')[0].toUpperCase();
      const params = head.slice(name.length);
      if (name === 'UID') ev.uid = value.trim();
      else if (name === 'DTSTART') ev.start = icsDate(value.trim(), params);
      else if (name === 'SUMMARY') ev.title = unescape(value).slice(0, 300);
      else if (name === 'STATUS' && /CANCELLED/i.test(value)) ev.cancelled = true;
      else if (name === 'ATTENDEE' || name === 'ORGANIZER') {
        const mail = (value.match(/mailto:([^\s;]+)/i) || [])[1];
        if (mail) ev.emails.push(mail.toLowerCase());
      }
    }
  }
  return out;
}

/** calendar invites attached to an email (mailparser result) */
export function invitesIn(parsed) {
  const parts = [...(parsed?.attachments || [])].filter((a) => /text\/calendar|application\/ics/i.test(a.contentType || '') || /\.ics$/i.test(a.filename || ''));
  const events = [];
  for (const a of parts) {
    try {
      events.push(...parseIcs(Buffer.isBuffer(a.content) ? a.content.toString('utf8') : String(a.content || '')));
    } catch {
      /* a broken invite is ignored */
    }
  }
  return events.filter((e) => e.start);
}

/* ---------------- the calendars ---------------- */
const GENERIC = /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|rediffmail|protonmail|zoho|aol)\./i;
const domainOf = (e) => String(e || '').split('@')[1]?.toLowerCase() || '';

let syncing = false;
export async function syncCalendars({ texts } = {}) {
  const urls = texts ? [] : calendarUrls();
  if ((!urls.length && !texts) || syncing) return { calendars: 0 };
  syncing = true;
  const out = { calendars: urls.length, events: 0, matched: 0, errors: [] };
  try {
    const ours = new Set([domainOf(config.fromEmail), 'geekcreativeagency.com'].filter(Boolean));
    const now = Date.now();
    const events = [];
    for (const t of texts || []) events.push(...parseIcs(t)); // given directly (tests)
    for (const url of urls) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        events.push(...parseIcs(await r.text()));
      } catch (e) {
        out.errors.push(`${url.slice(0, 40)}…: ${e.message}`);
      }
    }
    // only meetings from 2 days ago to 60 days ahead
    const soon = events.filter((e) => e.start && e.start.getTime() > now - 2 * DAY && e.start.getTime() < now + 60 * DAY);
    out.events = soon.length;
    const seen = (await getSetting('calendarSeen', {})) || {};
    for (const ev of soon) {
      const outside = [...new Set(ev.emails)].filter((m) => !ours.has(domainOf(m)));
      if (!outside.length) continue;
      // a lead: their exact email first, else someone from the same (non-Gmail) company domain
      let contact = await Contact.findOne({ email: { $in: outside } }).lean();
      if (!contact) {
        const doms = [...new Set(outside.map(domainOf))].filter((d) => d && !GENERIC.test(d));
        if (doms.length) contact = await Contact.findOne({ email: { $regex: `@(${doms.map((d) => d.replace(/\./g, '\\.')).join('|')})$`, $options: 'i' }, companyId: { $ne: null } }).lean();
      }
      if (!contact?.companyId) continue;
      // nothing new about this event since last time: skip
      const key = `${ev.uid}|${ev.start.toISOString()}|${ev.cancelled ? 1 : 0}`;
      if (ev.uid && seen[ev.uid] === key) continue;
      await suggestMeeting({ contact, at: ev.start, source: 'calendar', quote: ev.title || '', calendarUid: ev.uid, title: ev.title, cancelled: ev.cancelled });
      if (ev.uid) seen[ev.uid] = key;
      out.matched++;
    }
    // forget events that are long gone
    for (const k of Object.keys(seen)) if (!soon.some((e) => e.uid === k) && Object.keys(seen).length > 500) delete seen[k];
    await setSetting('calendarSeen', seen);
    await setSetting('calendarLastSync', { at: new Date(), ...out });
  } finally {
    syncing = false;
  }
  return out;
}
