// Building and sending emails over SMTP.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNATURE, SIGNATURE_HTML, SIGNATURE_LOGO } from './templates.js';

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', SIGNATURE_LOGO);
import { config, smtpReady } from './config.js';

export const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// {{firstName}} {{name}} {{company}} {{email}} {{location}} {{senderName}} and {{company | fallback}}
export function fill(text, c, escape) {
  const vars = {
    firstname: (c.name || '').trim().split(/\s+/)[0] || 'there',
    name: c.name || '',
    company: c.company || '',
    email: c.email || '',
    location: c.location || '',
    sendername: config.fromName,
  };
  return String(text || '').replace(/\{\{\s*([a-zA-Z]+)\s*(?:\|\s*([^}]*?))?\s*\}\}/g, (_m, k, fb) => {
    const v = vars[k.toLowerCase()] || fb || '';
    return escape ? escapeHtml(v) : v;
  });
}

const sign = (v) => crypto.createHmac('sha256', config.jwtSecret).update(v).digest('base64url').slice(0, 22);
export const verifySign = (v, s) => {
  const a = Buffer.from(sign(v));
  const b = Buffer.from(String(s || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Unsubscribe works in two ways:
//  1. link to our page (only when PUBLIC_BACKEND_URL is a real public address)
//  2. email: "mailto:you?subject=unsubscribe" - Gmail's Unsubscribe button and the footer link send this,
//     the inbox check sees it and the person is never emailed again. Works even on localhost.
export const unsubscribeUrl = (c) => (config.publicLinks ? `${config.publicUrl}/u/${c.unsubscribeToken}` : null);
const unsubMailbox = () => config.replyTo || config.fromEmail;
export const unsubscribeMailto = () => `mailto:${unsubMailbox()}?subject=Unsubscribe&body=Please%20unsubscribe%20me`;

// "On Tue, Sep 29, 2026 at 6:03 PM Geek <you@x.com> wrote:" (like Gmail)
function quoteLine(sentAt) {
  const d = new Date(sentAt);
  const f = (o) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, ...o }).format(d);
  return `On ${f({ weekday: 'short' })}, ${f({ month: 'short', day: 'numeric', year: 'numeric' })} at ${f({ hour: 'numeric', minute: '2-digit' })} ${config.fromName} <${config.fromEmail}> wrote:`;
}

/**
 * Returns { subject, html, text, core } for one contact.
 * prev = the earlier email in this thread ({ html, text, sentAt }) - it is quoted below the new message, like Gmail.
 * core = message + quote without tracking/footer (saved, so the next follow-up can quote it).
 */
export function buildEmail(contact, subject, body, trackingId, prev, { signature = false } = {}) {
  const raw = String(body || '');
  const isHtml = /<\/?(p|br|div|a|b|strong|ul|li)\b/i.test(raw);
  let core = isHtml
    ? fill(raw, contact, true)
    : escapeHtml(fill(raw, contact))
        .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, (u) => `<a href="${u}">${u}</a>`)
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`)
        .join('');
  let text = (isHtml ? core.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '') : fill(raw, contact)).trim();

  // designed footer with the logo (Aanchal Ara ...)
  if (signature) {
    core += SIGNATURE_HTML;
    text += `\n\n${SIGNATURE.trim()}`;
  }

  if (prev?.html) {
    const line = quoteLine(prev.sentAt);
    core += `<br><div class="gmail_quote"><div class="gmail_attr" style="color:#5f6368">${escapeHtml(line)}<br></div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${prev.html}</blockquote></div>`;
    text += `\n\n${line}\n` + String(prev.text || '').split('\n').map((l) => `> ${l}`).join('\n');
  }

  let html = core;
  if (config.trackClicks && trackingId) {
    html = html.replace(/href="(https?:\/\/[^"]+)"/gi, (_m, u) => {
      const url = u.replace(/&amp;/g, '&');
      return `href="${escapeHtml(`${config.publicUrl}/t/c/${trackingId}?u=${encodeURIComponent(url)}&s=${sign(trackingId + '|' + url)}`)}"`;
    });
  }
  const unsub = unsubscribeUrl(contact) || unsubscribeMailto();
  const footer = `<p style="margin:28px 0 0;font-size:12px;color:#8a8f98">${config.footer ? escapeHtml(config.footer) + '<br>' : ''}Not interested? <a href="${escapeHtml(unsub)}" style="color:#8a8f98">Unsubscribe</a> or just reply &quot;unsubscribe&quot; and you won't hear from me again.</p>`;
  const pixel = config.trackOpens && trackingId ? `<img src="${config.publicUrl}/t/o/${trackingId}.gif" width="1" height="1" alt="">` : '';

  return {
    subject: fill(subject, contact).replace(/[\r\n]+/g, ' ').trim(),
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2328;max-width:640px">${html}${footer}${pixel}</div>`,
    text: `${text}\n\n--\nNot interested? Reply "unsubscribe"${unsubscribeUrl(contact) ? ` or open ${unsubscribeUrl(contact)}` : ''} and you won't hear from me again.`,
    core: { html: core, text },
  };
}

let transporter;
const transport = () =>
  (transporter ||= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
    pool: true,
    maxConnections: 2,
  }));

/** Send one email. threadIds = earlier Message-IDs so follow-ups land in the same thread. */
export async function sendMail({ to, name, email, threadIds = [], unsub, cc = [] }) {
  if (!smtpReady()) throw Object.assign(new Error('SMTP is not configured'), { transient: true });
  const domain = (config.fromEmail.split('@')[1] || 'localhost').toLowerCase();
  const messageId = `<geekcrm.${crypto.randomUUID()}@${domain}>`;
  const info = await transport().sendMail({
    from: { name: config.fromName, address: config.fromEmail },
    to: name ? { name, address: to } : to,
    cc: cc.length ? cc : undefined,
    // the signature logo travels inside the email (also needed for quoted earlier emails)
    attachments: email.html?.includes('cid:geek-signature-logo')
      ? [{ filename: 'geek.png', path: LOGO_PATH, cid: 'geek-signature-logo', contentDisposition: 'inline' }]
      : undefined,
    replyTo: config.replyTo || undefined,
    subject: email.subject,
    html: email.html,
    text: email.text,
    messageId,
    inReplyTo: threadIds.at(-1),
    references: threadIds.length ? threadIds.join(' ') : undefined,
    // Gmail / Outlook show their own "Unsubscribe" button from this header (also helps stay out of spam)
    headers: email.bulk === false ? {} : {
      'List-Unsubscribe': [`<mailto:${unsubMailbox()}?subject=unsubscribe>`, unsub && `<${unsub}>`].filter(Boolean).join(', '),
      ...(unsub?.startsWith('https://') ? { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
    },
  });
  return info.messageId || messageId;
}

export async function verifySmtp() {
  if (!smtpReady()) return { ok: false, error: 'SMTP is not configured in .env' };
  try {
    await transport().verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 550-554 on the recipient = address does not exist
export const isBadAddress = (e) =>
  Number(e?.responseCode) >= 550 && Number(e?.responseCode) <= 554 && /recipient|mailbox|user|address|unknown|not exist/i.test(e?.response || e?.message || '');

/** "a@x.com, b@y.com" -> ['a@x.com', 'b@y.com'] (valid addresses only, max 5) */
export const parseCc = (v) =>
  [...new Set(String(v || '').toLowerCase().split(/[\s,;]+/).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))].slice(0, 5);
