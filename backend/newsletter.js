// Newsletter: leads that got their whole email sequence with no reply join the newsletter list.
// The admin writes a newsletter and sends it to the list. It goes from the newsletter mailbox (NEWSLETTER_SMTP_* in .env),
// or, while that is empty, from the normal sending mailbox. Its own hourly / daily limits keep it slow and safe.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { Contact, getSetting, setSetting } from './models.js';
import { escapeHtml, unsubscribeUrl } from './mail.js';

const { Schema, model } = mongoose;
const id = Schema.Types.ObjectId;
const env = (k, d = '') => String(process.env[k] ?? d).trim();
const num = (k, d) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);

export const Newsletter = model(
  'Newsletter',
  new Schema(
    {
      subject: { type: String, required: true },
      body: { type: String, default: '' }, // plain text; blank lines = paragraphs, http links become links
      status: { type: String, enum: ['draft', 'sending', 'sent', 'stopped'], default: 'draft', index: true },
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
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
    },
    { timestamps: true }
  ).index({ newsletter: 1, contact: 1 }, { unique: true })
);

const own = () => Boolean(env('NEWSLETTER_SMTP_HOST') && env('NEWSLETTER_SMTP_USER'));
export const sender = () => ({
  separate: own(),
  host: own() ? env('NEWSLETTER_SMTP_HOST') : config.smtp.host,
  user: own() ? env('NEWSLETTER_SMTP_USER') : config.smtp.user,
  fromEmail: env('NEWSLETTER_FROM_EMAIL') || (own() ? env('NEWSLETTER_SMTP_USER') : config.fromEmail),
  fromName: env('NEWSLETTER_FROM_NAME') || config.fromName,
  hourly: num('NEWSLETTER_HOURLY_LIMIT', 30),
  daily: num('NEWSLETTER_DAILY_LIMIT', 200),
});
let transporter;
const transport = () =>
  (transporter ||= own()
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

/** who is on the list right now */
export const audienceFilter = () => ({ newsletter: true, status: { $nin: ['unsubscribed', 'bounced', 'replied'] }, email: { $type: 'string' } });

/** a lead finished its sequence without a reply: join the newsletter (their cold emails are over) */
export async function joinNewsletter(contactId) {
  if (!(await newsletterOn())) return; // off: the lead just finishes (can be added later with "Add them")
  await Contact.updateOne({ _id: contactId, status: { $nin: ['replied', 'unsubscribed', 'bounced'] }, newsletter: { $ne: true } }, { $set: { newsletter: true, newsletterAt: new Date() } });
}

const linkify = (t) => escapeHtml(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
export function render(n, contact) {
  const unsub = contact ? unsubscribeUrl(contact) : null;
  const paras = String(n.body || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:620px">${paras.map((p) => `<p>${linkify(p).replace(/\n/g, '<br>')}</p>`).join('')}<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:12px;color:#6b7280">You are getting this because you were in touch with us.${unsub ? ` <a href="${unsub}" style="color:#6b7280">Unsubscribe</a>` : ' Reply "unsubscribe" to stop these emails.'}</p></div>`;
  const text = `${paras.join('\n\n')}\n\n--\nYou are getting this because you were in touch with us.${unsub ? ` Unsubscribe: ${unsub}` : ' Reply "unsubscribe" to stop these emails.'}`;
  return { html, text, unsub };
}

export async function sendOne(n, contact) {
  const s = sender();
  const { html, text, unsub } = render(n, contact);
  const domain = (s.fromEmail.split('@')[1] || 'localhost').toLowerCase();
  await transport().sendMail({
    from: { name: s.fromName, address: s.fromEmail },
    to: contact.name ? { name: contact.name, address: contact.email } : contact.email,
    replyTo: env('NEWSLETTER_REPLY_TO') || config.replyTo || undefined,
    subject: n.subject,
    html,
    text,
    messageId: `<geeknews.${crypto.randomUUID()}@${domain}>`,
    headers: {
      'List-Unsubscribe': [`<mailto:${s.fromEmail}?subject=unsubscribe>`, unsub && `<${unsub}>`].filter(Boolean).join(', '),
      ...(unsub?.startsWith('https://') ? { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
      Precedence: 'bulk',
    },
  });
}

/** start sending: everyone on the list now is queued once */
export async function startNewsletter(n) {
  const people = await Contact.find(audienceFilter()).select('_id').lean();
  if (!people.length) throw Object.assign(new Error('Nobody is on the newsletter list yet'), { status: 400 });
  await NewsletterSend.insertMany(people.map((p) => ({ newsletter: n._id, contact: p._id })), { ordered: false }).catch(() => {});
  n.status = 'sending';
  n.total = await NewsletterSend.countDocuments({ newsletter: n._id });
  n.startedAt = new Date();
  await n.save();
  return n;
}

let busy = false;
/** every minute: send a few, inside the newsletter limits */
export async function runNewsletters() {
  if (busy) return;
  busy = true;
  try {
    if (!(await newsletterOn())) return; // switched off: sending waits
    const n = await Newsletter.findOne({ status: 'sending' }).sort({ startedAt: 1 });
    if (!n) return;
    const s = sender();
    const hour = await NewsletterSend.countDocuments({ status: 'sent', sentAt: { $gte: new Date(Date.now() - 3600000) } });
    const day = await NewsletterSend.countDocuments({ status: 'sent', sentAt: { $gte: new Date(Date.now() - 86400000) } });
    const room = Math.min(s.hourly - hour, s.daily - day, Math.max(1, Math.ceil(s.hourly / 60)));
    if (room <= 0) return;
    const batch = await NewsletterSend.find({ newsletter: n._id, status: 'queued' }).limit(room).lean();
    for (const q of batch) {
      const c = await Contact.findOne({ _id: q.contact, ...audienceFilter() }).lean();
      if (!c) {
        await NewsletterSend.updateOne({ _id: q._id }, { $set: { status: 'skipped' } });
        continue;
      }
      try {
        await sendOne(n, c);
        await NewsletterSend.updateOne({ _id: q._id }, { $set: { status: 'sent', sentAt: new Date() } });
      } catch (e) {
        await NewsletterSend.updateOne({ _id: q._id }, { $set: { status: 'failed', error: String(e.message).slice(0, 300) } });
      }
    }
    const [sent, failed, left] = await Promise.all(['sent', 'failed', 'queued'].map((st) => NewsletterSend.countDocuments({ newsletter: n._id, status: st })));
    n.sent = sent;
    n.failed = failed;
    if (!left) {
      n.status = 'sent';
      n.finishedAt = new Date();
    }
    await n.save();
  } catch (e) {
    console.error('[newsletter]', e.message);
  } finally {
    busy = false;
  }
}
