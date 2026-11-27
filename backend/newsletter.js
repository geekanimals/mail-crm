// Newsletter: leads that got their whole email sequence with no reply join the newsletter list.
// The admin builds each issue in the fixed "This Week at Geek" design (photos, videos, text and links change),
// approves it and schedules it. It goes out from the sending mailbox, or the newsletter mailbox (NEWSLETTER_SMTP_* in .env)
// when that is set and chosen on the Newsletter page. Its own hourly / daily limits keep it slow and safe.
// Nobody from a company that is talking to us (anyone replied, or the company left "Cold") gets it.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { Company, Contact, Enrollment, getSetting, setSetting } from './models.js';
import { escapeHtml, unsubscribeUrl } from './mail.js';
import { BOX_V, ensureBox } from './newsletter-media.js';

const { Schema, model } = mongoose;
const id = Schema.Types.ObjectId;
const env = (k, d = '') => String(process.env[k] ?? d).trim();
const num = (k, d) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);
const DAY = 86400000;

/* ---------------- models ---------------- */
const slot = new Schema({ media: { type: id, ref: 'NewsletterMedia', default: null }, link: { type: String, default: '' } }, { _id: false });
const story = new Schema({ media: { type: id, ref: 'NewsletterMedia', default: null }, link: { type: String, default: '' }, title: { type: String, default: '' }, text: { type: String, default: '' } }, { _id: false });

export const Newsletter = model(
  'Newsletter',
  new Schema(
    {
      subject: { type: String, required: true },
      format: { type: String, enum: ['text', 'design'], default: 'text' }, // older newsletters are plain text
      body: { type: String, default: '' }, // text format: blank lines = paragraphs, http links become links
      design: {
        preheader: { type: String, default: '' }, // the grey line after the subject in the inbox
        intro: { type: String, default: '' },
        highlightsTitle: { type: String, default: 'Featured Highlights' },
        highlights: { type: [slot], default: [] },
        stories: { type: [story], default: [] },
        newsTitle: { type: String, default: "What's New" },
        news: { type: [String], default: [] },
      },
      status: { type: String, enum: ['draft', 'scheduled', 'sending', 'sent', 'stopped'], default: 'draft', index: true },
      sendAt: Date, // scheduled: when it starts
      approvedBy: String,
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      opened: { type: Number, default: 0 },
      clicked: { type: Number, default: 0 },
      note: String,
      startedAt: Date,
      finishedAt: Date,
    },
    { timestamps: true }
  )
);
export const NewsletterSend = model(
  'NewsletterSend',
  new Schema(
    {
      newsletter: { type: id, ref: 'Newsletter', index: true },
      contact: { type: id, ref: 'Contact', index: true },
      status: { type: String, enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued', index: true },
      error: String,
      sentAt: Date,
      openedAt: Date,
      clickedAt: Date,
      clicks: { type: Number, default: 0 },
    },
    { timestamps: true }
  ).index({ newsletter: 1, contact: 1 }, { unique: true })
);
// photos and videos uploaded once and used in any issue (served publicly so email apps can load them)
export const NewsletterMedia = model(
  'NewsletterMedia',
  new Schema(
    {
      name: { type: String, default: '' },
      kind: { type: String, enum: ['image', 'video'], required: true },
      file: { type: String, required: true }, // what the email shows: a photo, or the moving GIF of a video
      video: String, // the video file itself (opened when a video has no link)
      poster: String, // a still frame of the video (shown in the library)
      variants: { h: String, s: String, v: Number }, // copies filled to the boxes: h = Featured Highlights 4:5, s = Stories 2:3
      width: Number,
      height: Number,
      bytes: Number,
      hidden: { type: Boolean, default: false }, // removed from the library but kept for emails already sent
      sentOnce: { type: Boolean, default: false }, // was in an email that went out: its files are never deleted
    },
    { timestamps: true }
  )
);

/* ---------------- settings (Newsletter page) ---------------- */
export const DEFAULTS = {
  gapDays: 7, // one issue every N days
  sendHour: 11, // the time a scheduled issue starts (IST)
  waitDays: 5, // a lead gets the first issue at least N days after their last sequence email
  maxIssues: 0, // stop after N issues per person (0 = until they unsubscribe)
  mailbox: 'sequence', // 'sequence' = the normal sending mailbox, 'newsletter' = NEWSLETTER_SMTP_* in .env
  fromName: '',
  replyTo: '',
  ctaLink: 'https://geekcreativeagency.com/build-my-brand', // "Talk to Geek." opens the brand form on the website
  hourly: 0, // 0 = NEWSLETTER_HOURLY_LIMIT from .env
  daily: 0,
};
export async function nlSettings() {
  return { ...DEFAULTS, ...((await getSetting('newsletterSettings', {})) || {}) };
}
export const saveNlSettings = (s) => setSetting('newsletterSettings', s);

const own = () => Boolean(env('NEWSLETTER_SMTP_HOST') && env('NEWSLETTER_SMTP_USER'));
export async function sender() {
  const st = await nlSettings();
  const sep = own() && st.mailbox === 'newsletter';
  return {
    separate: sep,
    newsletterMailbox: own(), // the newsletter mailbox is set in .env (can be chosen)
    host: sep ? env('NEWSLETTER_SMTP_HOST') : config.smtp.host,
    user: sep ? env('NEWSLETTER_SMTP_USER') : config.smtp.user,
    fromEmail: sep ? env('NEWSLETTER_FROM_EMAIL') || env('NEWSLETTER_SMTP_USER') : config.fromEmail,
    fromName: st.fromName || (sep ? env('NEWSLETTER_FROM_NAME') : '') || config.fromName,
    replyTo: st.replyTo || env('NEWSLETTER_REPLY_TO') || config.replyTo || '',
    hourly: st.hourly > 0 ? st.hourly : num('NEWSLETTER_HOURLY_LIMIT', 30),
    daily: st.daily > 0 ? st.daily : num('NEWSLETTER_DAILY_LIMIT', 200),
  };
}
const transports = {};
const transport = (sep) =>
  (transports[sep ? 'n' : 's'] ||= sep
    ? nodemailer.createTransport({
        host: env('NEWSLETTER_SMTP_HOST'),
        port: num('NEWSLETTER_SMTP_PORT', 465),
        secure: env('NEWSLETTER_SMTP_SECURE', 'true') !== 'false',
        auth: { user: env('NEWSLETTER_SMTP_USER'), pass: env('NEWSLETTER_SMTP_PASS') },
        pool: true,
        maxConnections: 1,
      })
    : nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, auth: { user: config.smtp.user, pass: config.smtp.pass }, pool: true, maxConnections: 1 }));

/** the whole newsletter is off until the admin switches it on (Newsletter page): nobody joins, nothing is sent */
export const newsletterOn = async () => (await getSetting('newsletterOn', false)) === true;
export const setNewsletterOn = (on) => setSetting('newsletterOn', on === true);

/* ---------------- who gets it ---------------- */
/** everyone on the list (joined after their sequence, not unsubscribed / bounced / replied) */
export const listFilter = () => ({ newsletter: true, status: { $nin: ['unsubscribed', 'bounced', 'replied'] }, email: { $type: 'string' } });

/** companies that are talking to us: someone there replied, or the company is past "Cold" (hot, opportunity, account, later, not interested) */
async function busyCompanies() {
  const [replied, moved] = await Promise.all([
    Contact.distinct('companyId', { status: 'replied', companyId: { $ne: null } }),
    Company.distinct('_id', { stage: { $ne: 'cold' } }),
  ]);
  return [...new Map([...replied, ...moved].filter(Boolean).map((x) => [String(x), x])).values()];
}

/** who the next issue goes to (and why the rest are held back) */
export async function audience(st) {
  st ||= await nlSettings();
  const [busy, active] = await Promise.all([busyCompanies(), Enrollment.distinct('contact', { status: 'active' })]);
  const base = listFilter();
  const rules = {
    company: { companyId: { $nin: busy } },
    outcome: { outcome: { $in: [null, 'no_reply'] } },
    sequence: { _id: { $nin: active } },
    wait: { newsletterAt: { $lte: new Date(Date.now() - st.waitDays * DAY) } },
    ...(st.maxIssues > 0 ? { max: { $or: [{ newsletterCount: { $exists: false } }, { newsletterCount: { $lt: st.maxIssues } }] } } : {}),
  };
  return { filter: { $and: [base, ...Object.values(rules)] }, base, rules };
}

/** counts for the page: on the list, getting the next issue, held back (and why) */
export async function audienceCounts() {
  const st = await nlSettings();
  const { filter, base, rules } = await audience(st);
  const notRule = async (r) => Contact.countDocuments({ $and: [base, { $nor: [r] }] });
  const [list, next, company, outcome, sequence, wait, max] = await Promise.all([
    Contact.countDocuments(base),
    Contact.countDocuments(filter),
    notRule(rules.company),
    notRule(rules.outcome),
    notRule(rules.sequence),
    notRule(rules.wait),
    rules.max ? notRule(rules.max) : 0,
  ]);
  return { list, next, held: { company, outcome, sequence, wait, max } };
}

/** a lead finished its sequence without a reply: join the newsletter (their cold emails are over) */
export async function joinNewsletter(contactId) {
  if (!(await newsletterOn())) return; // off: the lead just finishes (can be added later with "Add them")
  await Contact.updateOne({ _id: contactId, status: { $nin: ['replied', 'unsubscribed', 'bounced'] }, newsletter: { $ne: true } }, { $set: { newsletter: true, newsletterAt: new Date() } });
}

/* ---------------- public links (photos, tracking) ---------------- */
export const PUBLIC_BASE = '/api/public/nl';
const pub = (p) => `${config.publicUrl}${PUBLIC_BASE}${p}`;
export const mediaUrl = (file) => (file ? pub(`/m/${encodeURIComponent(file)}`) : '');
export const assetUrl = (file) => pub(`/a/${file}`);
const sign = (v) => crypto.createHmac('sha256', config.jwtSecret).update(`nl|${v}`).digest('base64url').slice(0, 22);
export const verify = (v, s) => {
  const a = Buffer.from(sign(v));
  const b = Buffer.from(String(s || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const tracked = (sendId, url) => (sendId && config.publicLinks ? pub(`/c/${sendId}?u=${encodeURIComponent(url)}&s=${sign(`${sendId}|${url}`)}`) : url);
const okLink = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');

/* ---------------- the email ---------------- */
const NAVY = '#1f2a44';
const CYAN = '#13aee6';
const FONT = "'Outfit', 'Segoe UI', Arial, Helvetica, sans-serif";
const ADDRESS = 'Geek Creative Agency · No 509, 3rd Cross, 9th Main, HAL 2nd Stage, Indiranagar, Bengaluru 560038, India';

const paras = (t, style) =>
  String(t || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;${style}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

/** older uploads get their 4:5 box copy the first time they are used (kept after that) */
export async function fillBoxes(list) {
  for (const m of list)
    if (!m.variants?.h || !m.variants?.s || m.variants?.v !== BOX_V)
      try {
        const v = await ensureBox(m);
        if (v) {
          m.variants = v;
          await NewsletterMedia.updateOne({ _id: m._id }, { $set: { variants: v } });
        }
      } catch (e) {
        console.warn('[newsletter] could not make the box copy of', m.file, e.message);
      }
}

/** fill an issue's media ids with the media documents */
export async function withMedia(n) {
  const d = n.design || {};
  const ids = [...(d.highlights || []), ...(d.stories || [])].map((x) => x.media).filter(Boolean);
  const list = await NewsletterMedia.find({ _id: { $in: ids } }).lean();
  await fillBoxes(list);
  const map = new Map(list.map((m) => [String(m._id), m]));
  const fill = (x) => ({ ...x, media: x.media ? map.get(String(x.media._id || x.media)) || null : null });
  return { ...n, design: { ...d, highlights: (d.highlights || []).map(fill), stories: (d.stories || []).map(fill) } };
}

/** where a photo / video goes when clicked: its own link, or (a video with no link) the video file */
const clickTo = (x) => okLink(x.link) || (x.media?.kind === 'video' && x.media.video ? mediaUrl(x.media.video) : '');

const BOX_RATIO = { h: 675 / 540, s: 810 / 540 };
function img(m, width, alt, extra = '', box = null) {
  if (!m) return '';
  const cut = box && m.variants?.[box];
  const h = cut ? Math.round(width * BOX_RATIO[box]) : m.width && m.height ? Math.round((width * m.height) / m.width) : '';
  return `<img src="${escapeHtml(mediaUrl(cut || m.file))}" width="${width}"${h ? ` height="${h}"` : ''} alt="${escapeHtml(alt || '')}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:8px;${extra}">`;
}
const wrapLink = (href, html) => (href ? `<a href="${escapeHtml(href)}" target="_blank" style="text-decoration:none;display:block">${html}</a>` : html);

const sectionTitle = (text, icon) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${icon ? `<td valign="middle" style="padding-right:12px"><img src="${assetUrl(icon)}" width="34" height="34" alt="" style="display:block;border:0"></td>` : ''}<td class="sec-title" valign="middle" style="font-family:${FONT};font-size:26px;line-height:1.2;font-weight:700;color:${NAVY};letter-spacing:-0.5px">${escapeHtml(text)}</td></tr></table>`;
const rule = `<tr><td class="pad" style="padding:0 40px"><div style="border-top:1px solid #d7dce3;font-size:0;line-height:0">&nbsp;</div></td></tr>`;

/** the "This Week at Geek" email for one person (contact null = preview / test) */
export function renderDesign(n, contact, { sendId, ctaLink } = {}) {
  const d = n.design || {};
  const link = (u) => (u ? tracked(sendId, u) : '');
  const unsub = contact?.unsubscribeToken ? unsubscribeUrl(contact) : null;
  const unsubMail = `mailto:${config.replyTo || config.fromEmail}?subject=Unsubscribe`;
  const rows = [];

  // header (fixed) + the lines under it
  rows.push(`<tr><td style="padding:0">${wrapLink(link('https://geekcreativeagency.com'), `<img src="${assetUrl('header.png')}" width="600" height="160" alt="This Week at Geek" style="display:block;width:100%;max-width:600px;height:auto;border:0">`)}</td></tr>`);
  if (d.intro?.trim()) rows.push(`<tr><td class="pad" style="padding:0 40px 22px;font-family:${FONT};font-size:17px;line-height:1.45;font-weight:300;color:${NAVY}">${paras(d.intro, '')}</td></tr>`);
  rows.push(rule);

  // Featured Highlights: photos two by two, each clickable when it has a link
  const hl = (d.highlights || []).filter((x) => x.media);
  if (hl.length) {
    rows.push(`<tr><td class="pad" style="padding:28px 40px 18px">${sectionTitle(d.highlightsTitle || 'Featured Highlights', 'star.png')}</td></tr>`);
    // one line, every photo in the same 4:5 box (filled; the edges may be cut a little): 4, 3 or 2 boxes share the width
    // equally. The widths are in %, so a phone shows the very same line, just smaller.
    const row = hl.slice(0, 4);
    const n = row.length;
    const cellW = Math.floor(520 / n);
    const imgW = Math.min(250, cellW - 12);
    const pct = n === 1 ? 50 : 100 / n;
    const tds = row
      .map((x) => `<td width="${pct.toFixed(3)}%" valign="top" align="center" style="padding:0 6px">${wrapLink(link(clickTo(x)), img(x.media, imgW, x.media.name, 'margin:0 auto', 'h'))}</td>`)
      .join('');
    rows.push(`<tr><td class="pad" align="center" style="padding:0 34px 18px"><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="width:${n === 1 ? '50%' : '100%'};table-layout:fixed"><tr>${tds}</tr></table></td></tr>`);
    rows.push(rule);
  }

  // stories: two side by side in one line, each a photo / moving video (same 2:3 box) with its heading and text beside it,
  // like the design. A phone shows the very same line, just smaller. A single story uses the whole line.
  const stories = (d.stories || []).filter((x) => x.media || x.title?.trim() || x.text?.trim());
  const storyText = (s, href, small) =>
    `<div style="font-family:${FONT};text-align:left">${s.title?.trim() ? `<div class="${small ? 'st2-title' : 'st-title'}" style="font-size:${small ? 15 : 22}px;line-height:1.25;font-weight:700;color:${NAVY};letter-spacing:-0.2px;margin:0 0 ${small ? 8 : 12}px">${href ? `<a href="${escapeHtml(href)}" target="_blank" style="color:${NAVY};text-decoration:none">${escapeHtml(s.title.trim())}</a>` : escapeHtml(s.title.trim())}</div>` : ''}<div class="${small ? 'st2-text' : 'st-text'}" style="font-size:${small ? 12 : 15}px;line-height:1.45">${paras(s.text, `color:${NAVY};font-weight:300`)}</div>${href ? `<a class="${small ? 'st2-more' : 'st-more'}" href="${escapeHtml(href)}" target="_blank" style="font-size:${small ? 11.5 : 14}px;font-weight:600;color:${CYAN};text-decoration:none">${s.media?.kind === 'video' ? 'Watch the video' : 'Read more'} &rarr;</a>` : ''}</div>`;
  if (stories.length === 1) {
    const s = stories[0];
    const href = link(clickTo(s));
    const media = s.media ? wrapLink(href, img(s.media, 240, s.title || s.media.name, '', 's')) : '';
    rows.push(
      `<tr><td class="pad" style="padding:28px 40px 4px">${
        media ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed"><tr><td width="46%" valign="top">${media}</td><td width="4%">&nbsp;</td><td width="50%" valign="top">${storyText(s, href, false)}</td></tr></table>` : storyText(s, href, false)
      }</td></tr>`
    );
  } else if (stories.length) {
    // each story: photo 27% + text 21% of the line; 4% between the two stories (= 520 px on a computer)
    const pair = (s) => {
      if (!s) return '<td width="27%"></td><td width="21%"></td>';
      const href = link(clickTo(s));
      const media = s.media ? wrapLink(href, img(s.media, 140, s.title || s.media.name, '', 's')) : '';
      return `<td width="27%" valign="top">${media}</td><td width="21%" valign="top" style="padding:0 0 0 2.3%">${storyText(s, href, true)}</td>`;
    };
    const lines = [];
    for (let k = 0; k < stories.length; k += 2) lines.push(`<tr>${pair(stories[k])}<td width="4%">&nbsp;</td>${pair(stories[k + 1])}</tr><tr><td colspan="5" style="height:22px;font-size:0;line-height:0">&nbsp;</td></tr>`);
    rows.push(`<tr><td class="pad" style="padding:28px 40px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed">${lines.join('')}</table></td></tr>`);
  }

  // What's New: points with a tick
  const news = (d.news || []).map((x) => String(x).trim()).filter(Boolean);
  if (news.length) {
    rows.push(`<tr><td class="pad" style="padding:30px 40px 12px">${sectionTitle(d.newsTitle || "What's New")}</td></tr>`);
    rows.push(
      `<tr><td class="pad" style="padding:0 40px 10px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${news
        .map((t) => `<tr><td width="30" valign="top" style="padding:3px 0 10px"><img src="${assetUrl('check.png')}" width="18" height="18" alt="" style="display:block;border:0"></td><td valign="top" style="padding:0 0 10px;font-family:${FONT};font-size:15px;line-height:1.5;color:${NAVY}">${escapeHtml(t)}</td></tr>`)
        .join('')}</table></td></tr>`
    );
  }

  // Talk to Geek (fixed) -> the brand form on the website
  rows.push(`<tr><td style="padding:16px 0 0">${wrapLink(link(okLink(ctaLink) || DEFAULTS.ctaLink), `<img src="${assetUrl('talk-to-geek.png')}" width="600" height="150" alt="Need support on your next campaign? Talk to Geek." style="display:block;width:100%;max-width:600px;height:auto;border:0">`)}</td></tr>`);

  // footer
  const unsubHref = unsub || unsubMail;
  rows.push(`<tr><td class="pad" align="center" style="padding:8px 40px 30px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a94a6;text-align:center">You are receiving this because you were in touch with Geek Creative Agency.<br>Don't want these emails? <a href="${escapeHtml(unsubHref)}" style="color:#8a94a6;text-decoration:underline">Unsubscribe</a><br>${escapeHtml(ADDRESS)}</td></tr>`);

  const pixel = sendId && config.publicLinks ? `<img src="${pub(`/o/${sendId}.gif`)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : '';
  const pre = String(d.preheader || '').trim();
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(n.subject || 'This Week at Geek')}</title>
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet"><!--<![endif]-->
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%;}
a{color:${CYAN};}
@media (max-width:520px){
 .pad{padding-left:18px!important;padding-right:18px!important;}
 .st-title{font-size:16px!important;margin-bottom:6px!important;}
 .st2-title{font-size:11px!important;margin-bottom:4px!important;}
 .st2-text{font-size:9px!important;line-height:1.35!important;}
 .st2-text p{margin-bottom:5px!important;}
 .st2-more{font-size:9px!important;}
 .st-text{font-size:12.5px!important;line-height:1.45!important;}
 .st-text p{margin-bottom:8px!important;}
 .st-more{font-size:12px!important;}
 .sec-title{font-size:21px!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:#eef2f6;">
${pre ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(pre)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f6;"><tr><td align="center" style="padding:24px 10px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
${rows.join('\n')}
</table>
<!--[if mso]></td></tr></table><![endif]-->
${pixel}
</td></tr></table>
</body></html>`;

  // the plain-text copy (for apps that do not show HTML)
  const t = ['This Week at Geek', ''];
  if (d.intro?.trim()) t.push(d.intro.trim(), '');
  if (hl.length) {
    t.push(d.highlightsTitle || 'Featured Highlights');
    hl.forEach((x, i) => t.push(`${i + 1}. ${clickTo(x) || 'See the photo in the email'}`));
    t.push('');
  }
  for (const s of (d.stories || []).filter((x) => x.title?.trim() || x.text?.trim())) t.push(s.title?.trim() || '', s.text?.trim() || '', clickTo(s) || '', '');
  if (news.length) t.push(d.newsTitle || "What's New", ...news.map((x) => `- ${x}`), '');
  t.push(`Need support on your next campaign? Talk to Geek: ${okLink(ctaLink) || DEFAULTS.ctaLink}`, '', '--', `You are receiving this because you were in touch with Geek Creative Agency. Unsubscribe: ${unsub || 'reply "unsubscribe"'}`);
  return { html, text: t.join('\n').replace(/\n{3,}/g, '\n\n'), unsub };
}

const linkify = (t) => escapeHtml(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
/** an older plain-text newsletter */
export function renderText(n, contact) {
  const unsub = contact?.unsubscribeToken ? unsubscribeUrl(contact) : null;
  const ps = String(n.body || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:620px">${ps.map((p) => `<p>${linkify(p).replace(/\n/g, '<br>')}</p>`).join('')}<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:12px;color:#6b7280">You are getting this because you were in touch with us.${unsub ? ` <a href="${unsub}" style="color:#6b7280">Unsubscribe</a>` : ' Reply "unsubscribe" to stop these emails.'}</p></div>`;
  const text = `${ps.join('\n\n')}\n\n--\nYou are getting this because you were in touch with us.${unsub ? ` Unsubscribe: ${unsub}` : ' Reply "unsubscribe" to stop these emails.'}`;
  return { html, text, unsub };
}

/** what one person gets (n must have its media filled for the design format) */
export async function render(n, contact, opts = {}) {
  if (n.format !== 'design') return renderText(n, contact);
  const st = await nlSettings();
  return renderDesign(n, contact, { ctaLink: st.ctaLink, ...opts });
}

export async function sendOne(n, contact, { sendId } = {}) {
  const s = await sender();
  const { html, text, unsub } = await render(n, contact, { sendId });
  const domain = (s.fromEmail.split('@')[1] || 'localhost').toLowerCase();
  const unsubMail = config.replyTo || config.fromEmail; // the inbox the CRM reads, so "unsubscribe" emails are seen
  await transport(s.separate).sendMail({
    from: { name: s.fromName, address: s.fromEmail },
    to: contact.name ? { name: contact.name, address: contact.email } : contact.email,
    replyTo: s.replyTo || undefined,
    subject: n.subject,
    html,
    text,
    messageId: `<geeknews.${crypto.randomUUID()}@${domain}>`,
    headers: {
      'List-Unsubscribe': [`<mailto:${unsubMail}?subject=unsubscribe>`, unsub && `<${unsub}>`].filter(Boolean).join(', '),
      ...(unsub?.startsWith('https://') ? { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
      Precedence: 'bulk',
    },
  });
}

/* ---------------- schedule ---------------- */
/** a date at the send hour, in the CRM's time zone (IST) */
function atHour(day, hour) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(day);
  const guess = new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: config.timezone }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (shown - utc));
}
/** the next free date: the gap after the last issue (sent or scheduled), at the send hour, never in the past */
export async function nextSlot(exceptId) {
  const st = await nlSettings();
  const last = await Newsletter.findOne({ _id: { $ne: exceptId }, status: { $in: ['scheduled', 'sending', 'sent'] } })
    .sort({ sendAt: -1, startedAt: -1 })
    .select('sendAt startedAt')
    .lean();
  const lastAt = last ? new Date(Math.max(+new Date(last.sendAt || 0), +new Date(last.startedAt || 0))) : null;
  let day = lastAt ? new Date(+lastAt + st.gapDays * DAY) : new Date();
  let at = atHour(day, st.sendHour);
  while (at.getTime() < Date.now() + 5 * 60000) {
    day = new Date(+day + DAY);
    at = atHour(day, st.sendHour);
  }
  return at;
}

/** problems that stop an issue being approved */
export function problems(n) {
  const out = [];
  if (!String(n.subject || '').trim()) out.push('Write the subject.');
  if (n.format !== 'design') {
    if (!String(n.body || '').trim()) out.push('Write the newsletter.');
    return out;
  }
  const d = n.design || {};
  const hl = (d.highlights || []).filter((x) => x.media);
  const st = (d.stories || []).filter((x) => x.media || x.title?.trim() || x.text?.trim());
  const news = (d.news || []).filter((x) => String(x).trim());
  if (!hl.length && !st.length && !news.length) out.push('Add at least one photo, story or point.');
  (d.highlights || []).forEach((x, i) => {
    if (x.link && !okLink(x.link)) out.push(`The link of photo ${i + 1} is not a full web address (it must start with https://).`);
  });
  (d.stories || []).forEach((x, i) => {
    if (x.link && !okLink(x.link)) out.push(`The link of story ${i + 1} is not a full web address (it must start with https://).`);
  });
  (d.stories || []).forEach((s, i) => {
    if ((s.media || s.text?.trim()) && !s.title?.trim()) out.push(`Story ${i + 1} needs a heading.`);
  });
  return out;
}

/** start sending: everyone who should get it right now is queued once */
export async function startNewsletter(n) {
  const { filter } = await audience();
  const people = await Contact.find(filter).select('_id').lean();
  const used = [...(n.design?.highlights || []), ...(n.design?.stories || [])].map((x) => x.media?._id || x.media).filter(Boolean);
  if (used.length) await NewsletterMedia.updateMany({ _id: { $in: used } }, { $set: { sentOnce: true } });
  if (people.length) await NewsletterSend.insertMany(people.map((p) => ({ newsletter: n._id, contact: p._id })), { ordered: false }).catch(() => {});
  n.total = await NewsletterSend.countDocuments({ newsletter: n._id });
  n.startedAt = new Date();
  if (!n.total) {
    n.status = 'sent';
    n.finishedAt = new Date();
    n.note = 'Nobody was due to get it on that day.';
  } else n.status = 'sending';
  await n.save();
  return n;
}

const hourIst = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

let busy = false;
/** every minute: start a scheduled issue when its time comes, then send a few, inside the newsletter limits */
export async function runNewsletters() {
  if (busy) return;
  busy = true;
  try {
    if (!(await newsletterOn())) return; // switched off: sending waits
    const due = await Newsletter.findOne({ status: 'scheduled', sendAt: { $lte: new Date() } }).sort({ sendAt: 1 });
    if (due && !(await Newsletter.exists({ status: 'sending' }))) await startNewsletter(due);

    const n = await Newsletter.findOne({ status: 'sending' }).sort({ startedAt: 1 });
    if (!n) return;
    const h = hourIst();
    if (h < config.windowStart || h >= config.windowEnd) return; // only in the sending hours (9 AM to 7 PM)
    const s = await sender();
    const hour = await NewsletterSend.countDocuments({ status: 'sent', sentAt: { $gte: new Date(Date.now() - 3600000) } });
    const day = await NewsletterSend.countDocuments({ status: 'sent', sentAt: { $gte: new Date(Date.now() - DAY) } });
    const room = Math.min(s.hourly - hour, s.daily - day, Math.max(1, Math.ceil(s.hourly / 60)));
    if (room <= 0) return;
    const full = n.format === 'design' ? await withMedia(n.toObject()) : n.toObject();
    const { filter } = await audience();
    const batch = await NewsletterSend.find({ newsletter: n._id, status: 'queued' }).limit(room).lean();
    for (const q of batch) {
      // checked again just before sending: a reply, an unsubscribe or a company moving on since it was queued
      const c = await Contact.findOne({ $and: [{ _id: q.contact }, filter] }).lean();
      if (!c) {
        await NewsletterSend.updateOne({ _id: q._id }, { $set: { status: 'skipped' } });
        continue;
      }
      try {
        await sendOne(full, c, { sendId: String(q._id) });
        await NewsletterSend.updateOne({ _id: q._id }, { $set: { status: 'sent', sentAt: new Date() } });
        await Contact.updateOne({ _id: c._id }, { $inc: { newsletterCount: 1 }, $set: { newsletterLastAt: new Date() } });
      } catch (e) {
        await NewsletterSend.updateOne({ _id: q._id }, { $set: { status: 'failed', error: String(e.message).slice(0, 300) } });
      }
    }
    await refreshCounts(n);
  } catch (e) {
    console.error('[newsletter]', e.message);
  } finally {
    busy = false;
  }
}

export async function refreshCounts(n) {
  const c = (q) => NewsletterSend.countDocuments({ newsletter: n._id, ...q });
  const [sent, failed, left, opened, clicked] = await Promise.all([c({ status: 'sent' }), c({ status: 'failed' }), c({ status: 'queued' }), c({ openedAt: { $ne: null } }), c({ clickedAt: { $ne: null } })]);
  Object.assign(n, { sent, failed, opened, clicked });
  if (!left && n.status === 'sending') {
    n.status = 'sent';
    n.finishedAt = new Date();
  }
  await n.save();
}
