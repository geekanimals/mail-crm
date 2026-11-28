// The client's "Review & accept" link (no login): read the agreement, download the PDF, accept it, or ask for changes.
import { Router } from 'express';
import { config } from '../config.js';
import { Company, notify } from '../models.js';
import { sendPlain, escapeHtml } from '../mail.js';
import { Action } from '../actions.js';
import { ClientDoc, agreementPdf, cleanHtml, fileName } from '../documents.js';
import { keepPdf, sendPdf } from './documents.js';
import { fail, str, validEmail } from '../utils.js';

const router = Router();
const TOKEN = /^[A-Za-z0-9_-]{20,60}$/;
async function byToken(token) {
  if (!TOKEN.test(String(token || ''))) throw fail(404, 'This link is not valid');
  const d = await ClientDoc.findOne({ token, kind: 'agreement' });
  if (!d) throw fail(404, 'This link is not valid');
  return d;
}
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get(
  '/:token',
  ah(async (req, res) => {
    const d = await byToken(req.params.token);
    const company = await Company.findById(d.company).select('name').lean();
    if (!d.viewedAt && d.status === 'sent') {
      d.viewedAt = new Date();
      await d.save();
    }
    // a newer version replaced this one: say so (the newer link is in the newer email)
    res.json({
      status: d.status,
      version: d.version,
      brand: d.fields?.brand || company?.name || '',
      clientName: d.fields?.clientName || company?.name || '',
      html: cleanHtml(d.html).replace(/<p>\[Signatures\]<\/p>/, ''),
      sentAt: d.sentAt,
      accepted: d.accepted?.at ? { name: d.accepted.name, designation: d.accepted.designation, at: d.accepted.at } : null,
      changes: (d.changes || []).map((c) => ({ text: c.text, at: c.at })),
    });
  })
);

router.get(
  '/:token/pdf',
  ah(async (req, res) => {
    const d = await byToken(req.params.token);
    await sendPdf(res, d.toObject(), req.query.inline === '1');
  })
);

router.post(
  '/:token/accept',
  ah(async (req, res) => {
    const d = await byToken(req.params.token);
    if (d.status === 'accepted') return res.json({ ok: true, already: true });
    if (d.status !== 'sent') throw fail(400, d.status === 'replaced' ? 'A newer version of this agreement was sent. Please use the link in the latest email.' : 'This agreement cannot be accepted right now.');
    const name = str(req.body?.name, 120);
    const designation = str(req.body?.designation, 120);
    if (!name) throw fail(400, 'Please enter your full name');
    if (!designation) throw fail(400, 'Please enter your designation');
    if (req.body?.agree !== true) throw fail(400, 'Please tick that you have read and agree to the agreement');
    d.accepted = { name, designation, email: validEmail(req.body?.email) || '', at: new Date(), ip: String(req.ip || '').slice(0, 60), agent: String(req.headers['user-agent'] || '').slice(0, 300) };
    d.status = 'accepted';
    await d.save();
    const company = await Company.findById(d.company);
    // the accepted copy (with the acceptance in the client's signature block), kept and emailed to both sides
    let signed = null;
    try {
      const buf = await agreementPdf(d.toObject(), company);
      const fname = fileName(d, company);
      signed = { buf, fname };
      d.signedFile = await keepPdf(d, buf, fname, company._id);
      await d.save();
    } catch (e) {
      console.error('[agreement] signed copy failed:', e.message);
    }
    const to = [...new Set([...String(d.sentTo || '').split(/,\s*/), d.accepted.email].map((x) => validEmail(x)).filter(Boolean))];
    const admin = validEmail(config.replyTo) || validEmail(config.fromEmail);
    const msg = `Hi ${name.split(' ')[0]},\n\nThank you for accepting the agreement for the ${d.fields?.brand || company.name} campaign. The accepted copy is attached for your records.\n\nWe will send the estimate next.\n\nBest regards,\n${config.fromName}`;
    let emailed = false;
    if (signed && to.length)
      emailed = await sendPlain({ to, cc: admin ? [admin] : [], subject: `Accepted: Agreement – Geek Creative Agency x ${d.fields?.brand || company.name}`, text: msg, html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${escapeHtml(msg).replace(/\n/g, '<br>')}</div>`, attachments: [{ filename: signed.fname, content: signed.buf, contentType: 'application/pdf' }] }).then(() => true).catch((e) => (console.error('[agreement] accepted email failed:', e.message), false));
    // Needs you: the next step is the estimate
    await Action.create({ kind: 'agreement', company: company._id, emailAt: d.accepted.at, quote: `${name}${designation ? ` (${designation})` : ''} accepted the agreement (version ${d.version}).`, suggestion: { type: 'agreement_accepted', note: 'Make and send the estimate next' }, decision: { docId: String(d._id) } });
    await notify('action', null, { name: company.name, text: `${company.name} accepted the agreement. Make the estimate.` });
    res.json({ ok: true, emailed });
  })
);

router.post(
  '/:token/changes',
  ah(async (req, res) => {
    const d = await byToken(req.params.token);
    if (d.status !== 'sent' && d.status !== 'changes') throw fail(400, d.status === 'accepted' ? 'This agreement is already accepted.' : 'This agreement cannot be changed right now.');
    const text = str(req.body?.text, 3000);
    const name = str(req.body?.name, 120);
    if (!text) throw fail(400, 'Please write what should change');
    d.changes.push({ text, name, at: new Date() });
    d.status = 'changes';
    await d.save();
    const company = await Company.findById(d.company).select('name').lean();
    await Action.updateMany({ kind: 'agreement', company: d.company, status: 'open' }, { $set: { status: 'dismissed', decidedBy: 'CRM', decidedAt: new Date() } });
    await Action.create({ kind: 'agreement', company: d.company, emailAt: new Date(), quote: `${name ? `${name}: ` : ''}${text}`, suggestion: { type: 'agreement_changes', note: `Changes asked on version ${d.version}` }, decision: { docId: String(d._id) } });
    await notify('action', null, { name: company?.name || '', text: `${company?.name || 'A client'} asked for changes in the agreement.` });
    res.json({ ok: true });
  })
);

export default router;
