// Agreement → estimate → payment, before an Opportunity becomes an account (admin). See documents.js.
// Nothing here sends on its own: an email goes only from POST /:id/send (the Send button).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { Company, Contact, notify } from '../models.js';
import { HrFile } from '../hr-models.js';
import { sendPlain, escapeHtml } from '../mail.js';
import { Action } from '../actions.js';
import { UPLOAD_DIR } from './files.js';
import {
  ClientDoc,
  DOC_DEFAULTS,
  agreementPdf,
  cleanHtml,
  dmy,
  docSettings,
  estimatePdf,
  estimateTotals,
  fileName,
  fillTemplate,
  giveBackEstimateNumber,
  inWords,
  inr,
  newToken,
  peekEstimateNumber,
  saveDocSettings,
  takeEstimateNumber,
  ymdIst,
} from '../documents.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';

const router = Router();
const who = (req) => req.user || req.account?.name || 'admin';
const frontend = () => config.frontendUrls[0] || 'http://localhost:3000';
export const reviewUrl = (token) => `${frontend()}/agreement/${token}`;

/* ---------------- the flow of one company ---------------- */
export async function flowFor(companyId) {
  const [company, docs] = await Promise.all([Company.findById(companyId).lean(), ClientDoc.find({ company: companyId }).sort({ createdAt: -1 }).select('-html').lean()]);
  if (!company) return null;
  const st = await docSettings();
  const agreement = docs.find((d) => d.kind === 'agreement' && d.status !== 'replaced') || null;
  const estimate = docs.find((d) => d.kind === 'estimate' && d.status !== 'replaced') || null;
  const agreed = Boolean(agreement && ['accepted', 'outside'].includes(agreement.status));
  const estimateSent = Boolean(estimate && ['sent', 'outside'].includes(estimate.status));
  const total = estimate?.estimate?.total || 0;
  const paid = (company.payments || []).reduce((n, p) => n + (p.amount || 0), 0);
  const advanceDue = Math.round((total * (st.advancePercent || 50)) / 100);
  return {
    company: { _id: company._id, name: company.name, stage: company.stage, billing: company.billing || {}, payments: company.payments || [] },
    agreement,
    estimate,
    history: docs,
    agreed,
    estimateSent,
    total,
    paid,
    advanceDue,
    advancePercent: st.advancePercent || 50,
    paymentReceived: paid > 0,
    nextEstimateNumber: await peekEstimateNumber(),
  };
}
router.get(
  '/company/:id',
  ah(async (req, res) => {
    const f = await flowFor(checkId(req.params.id));
    if (!f) throw fail(404, 'Company not found');
    const contacts = await Contact.find({ companyId: f.company._id, email: { $type: 'string' }, status: { $nin: ['bounced', 'unsubscribed'] } }).select('name email title status').lean();
    res.json({ ...f, contacts });
  })
);

/** the people a document goes to by default: whoever replied, else the first person with an email */
async function defaultTo(companyId) {
  const people = await Contact.find({ companyId, email: { $type: 'string' }, status: { $nin: ['bounced', 'unsubscribed'] } }).sort({ repliedAt: -1, updatedAt: -1 }).select('name email status').lean();
  const p = people.find((x) => x.status === 'replied') || people[0];
  return p ? { to: p.email, name: (p.name || '').split(' ')[0] } : { to: '', name: '' };
}

/* ---------------- agreement ---------------- */
router.post(
  '/company/:id/agreement',
  ah(async (req, res) => {
    const company = await Company.findById(checkId(req.params.id)).lean();
    if (!company) throw fail(404, 'Company not found');
    const st = await docSettings();
    const last = await ClientDoc.findOne({ company: company._id, kind: 'agreement', status: { $ne: 'replaced' } }).sort({ createdAt: -1 });
    if (last && last.status === 'draft') return res.json(last); // one draft at a time: keep editing it
    if (last && last.status === 'accepted') throw fail(400, 'The agreement is already accepted. Make the estimate next.');
    // a new version (after changes were asked) starts from the last one
    const base = last ? last.toObject() : null;
    const af = st.agreementFields;
    const fields = base?.fields || {
      effectiveDate: ymdIst(),
      clientName: company.billing?.legalName || company.name,
      brand: company.name,
      creators: af.creators,
      maxProfiles: String((Number(af.creators) || 0) * 2 || ''),
      guarantee: af.guarantee,
      fee: '',
      paymentTerms: af.paymentTerms,
      nonBarterPayout: af.nonBarterPayout,
      logisticsFee: af.logisticsFee,
      carryMonths: af.carryMonths,
      nonCircMonths: af.nonCircMonths,
      jurisdiction: af.jurisdiction,
      annexCreators: af.creators,
      annexPayment: af.paymentTerms,
      annexEligibility: '',
      annexConsideration: '',
      annexDeliverables: '',
      annexTimelines: '',
      annexApproval: '',
    };
    const to = await defaultTo(company._id);
    const d = await ClientDoc.create({
      company: company._id,
      kind: 'agreement',
      version: (last?.version || 0) + 1,
      fields: { ...fields, effectiveDate: ymdIst() },
      html: base?.html || fillTemplate(st.agreementTemplate, fields),
      mail: base?.mail || {
        to: to.to,
        cc: '',
        subject: `Agreement – Geek Creative Agency x ${company.name}`,
        body: `Hi ${to.name || 'there'},\n\nPlease find attached the agreement for the ${company.name} campaign.\n\nYou can review it and accept it online with the button below. If anything needs to change, use "Request changes" on the same page or simply reply to this email.\n\nBest regards,\n${config.fromName}`,
      },
      by: who(req),
    });
    res.status(201).json(d);
  })
);

const FIELD_NAMES = ['effectiveDate', 'clientName', 'brand', 'creators', 'maxProfiles', 'guarantee', 'fee', 'paymentTerms', 'nonBarterPayout', 'logisticsFee', 'carryMonths', 'nonCircMonths', 'jurisdiction', 'annexCreators', 'annexPayment', 'annexEligibility', 'annexConsideration', 'annexDeliverables', 'annexTimelines', 'annexApproval'];
const cleanFields = (f = {}) => Object.fromEntries(FIELD_NAMES.map((k) => [k, str(f[k], k.startsWith('annex') ? 3000 : 300)]));
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** the client's GST number before an estimate: a valid GSTIN, or "no GST" ticked */
function checkGst(gst, noGst) {
  if (noGst) return '';
  const g = String(gst || '').replace(/\s/g, '').toUpperCase();
  if (!g) throw fail(400, 'Enter the client’s GST number (or tick “The client has no GST number”)');
  if (!GSTIN.test(g)) throw fail(400, 'This GST number does not look right (15 characters, like 29ABCDE1234F1Z5)');
  return g;
}
const cleanMail = (m = {}) => ({ to: str(m.to, 1000), cc: str(m.cc, 1000), subject: str(m.subject, 300), body: str(m.body, 10000) });

router.get(
  '/:id',
  ah(async (req, res) => {
    const d = await ClientDoc.findById(checkId(req.params.id)).lean();
    if (!d) throw fail(404, 'Not found');
    res.json({ ...d, reviewUrl: d.token ? reviewUrl(d.token) : '' });
  })
);

// save a draft: fields, the edited document, the email; refill = make the document again from the template and fields
router.put(
  '/:id',
  ah(async (req, res) => {
    const d = await ClientDoc.findById(checkId(req.params.id));
    if (!d) throw fail(404, 'Not found');
    if (d.status !== 'draft') throw fail(400, 'Only a draft can be changed');
    const b = req.body || {};
    if (b.mail) d.mail = cleanMail(b.mail);
    if (d.kind === 'agreement') {
      if (b.fields) {
        d.fields = cleanFields(b.fields);
        d.markModified('fields');
      }
      if (b.refill) d.html = fillTemplate((await docSettings()).agreementTemplate, d.fields);
      else if (typeof b.html === 'string') d.html = cleanHtml(b.html);
    } else {
      const e = b.estimate || {};
      const t = estimateTotals({ items: Array.isArray(e.items) ? e.items.slice(0, 30) : d.estimate.items, gstRate: e.gstRate ?? d.estimate.gstRate });
      d.estimate = {
        date: /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? e.date : d.estimate.date,
        billTo: { name: str(e.billTo?.name ?? d.estimate.billTo?.name, 300), address: str(e.billTo?.address ?? d.estimate.billTo?.address, 1000), gst: str(e.billTo?.gst ?? d.estimate.billTo?.gst, 40).toUpperCase() },
        terms: Array.isArray(e.terms) ? e.terms.map((x) => str(x, 500)).filter(Boolean).slice(0, 15) : d.estimate.terms,
        noGst: e.noGst !== undefined ? e.noGst === true : Boolean(d.estimate.noGst),
        ...t,
      };
    }
    await d.save();
    res.json(d);
  })
);

// the PDF, at any time (a draft as it is now; a sent one exactly as sent; an accepted agreement with its acceptance)
async function pdfOf(d) {
  const company = await Company.findById(d.company).lean();
  const buf = d.kind === 'estimate' ? await estimatePdf(d) : await agreementPdf(d, company);
  return { buf, name: fileName(d, company) };
}
export async function sendPdf(res, d, inline) {
  const { buf, name } = await pdfOf(d);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(buf);
}
router.get(
  '/:id/pdf',
  ah(async (req, res) => {
    const d = await ClientDoc.findById(checkId(req.params.id)).lean();
    if (!d) throw fail(404, 'Not found');
    await sendPdf(res, d, req.query.inline === '1');
  })
);

/** keep a PDF as a file (company documents now, the deal's documents after convert) */
export async function keepPdf(d, buf, name, owner) {
  const stored = `${crypto.randomBytes(16).toString('hex')}.pdf`;
  await fs.writeFile(path.join(UPLOAD_DIR, stored), buf);
  const f = await HrFile.create({ owner, name, type: 'application/pdf', size: buf.length, path: stored, uploadedBy: 'CRM' });
  return { id: String(f._id), name };
}

const emails = (v) => [...new Set(String(v || '').split(/[,;\s]+/).map((x) => validEmail(x)).filter(Boolean))];
const paragraphs = (t) => escapeHtml(t).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');

// Send (the only way anything is emailed)
router.post(
  '/:id/send',
  ah(async (req, res) => {
    const d = await ClientDoc.findById(checkId(req.params.id));
    if (!d) throw fail(404, 'Not found');
    if (d.status !== 'draft') throw fail(400, 'This was already sent');
    if (req.body?.mail) d.mail = cleanMail(req.body.mail);
    const to = emails(d.mail?.to);
    const cc = emails(d.mail?.cc);
    if (!to.length) throw fail(400, 'Enter the email it goes to');
    if (!d.mail?.subject) throw fail(400, 'Write the subject');
    const company = await Company.findById(d.company);
    if (d.kind === 'estimate') {
      const f = await flowFor(d.company);
      if (!f.agreed) throw fail(400, 'The agreement must be accepted before the estimate goes');
      if (!(d.estimate?.total > 0)) throw fail(400, 'Add the items: the total is zero');
      if (!d.estimate?.billTo?.name) throw fail(400, 'Fill in Bill To (the client’s legal name)');
      const gst = checkGst(d.estimate?.billTo?.gst, d.estimate?.noGst);
      if (d.estimate.billTo.gst !== gst) {
        d.estimate.billTo.gst = gst;
        d.markModified('estimate');
      }
    } else {
      if (/__________/.test(d.html)) throw fail(400, 'Some blanks (__________) are still empty in the agreement. Fill them in first.');
      d.token = d.token || newToken();
    }
    const { buf, name } = await pdfOf(d);
    const link = d.kind === 'agreement' ? reviewUrl(d.token) : '';
    const button = link ? `<p style="margin:22px 0"><a href="${link}" style="background:#13aee6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">Review &amp; accept the agreement</a></p><p style="font-size:12px;color:#6b7280">Or open: ${escapeHtml(link)}</p>` : '';
    const text = `${d.mail.body}${link ? `\n\nReview & accept: ${link}` : ''}`;
    try {
      await sendPlain({ to, cc, subject: d.mail.subject, text, html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2328">${paragraphs(d.mail.body)}${button}</div>`, attachments: [{ filename: name, content: buf, contentType: 'application/pdf' }] });
    } catch (e) {
      throw fail(502, `The email could not be sent: ${e.message}`);
    }
    d.status = 'sent';
    d.sentAt = new Date();
    d.sentBy = who(req);
    d.sentTo = [...to, ...cc].join(', ');
    d.file = await keepPdf(d, buf, name, company._id);
    await d.save();
    // the older version of the agreement is replaced by this one
    if (d.kind === 'agreement') await ClientDoc.updateMany({ company: d.company, kind: 'agreement', _id: { $ne: d._id }, status: { $in: ['sent', 'changes'] } }, { $set: { status: 'replaced' } });
    await Action.updateMany({ kind: 'agreement', company: d.company, status: 'open' }, { $set: { status: 'done', decidedBy: 'CRM', decidedAt: new Date(), decision: { note: `${d.kind === 'agreement' ? 'A new version of the agreement' : `Estimate ${d.number}`} was sent` } } });
    if (d.kind === 'estimate') {
      // the bill-to details are kept on the company for next time
      company.billing = { legalName: d.estimate.billTo.name, address: d.estimate.billTo.address, gst: d.estimate.billTo.gst };
      await company.save();
      // Needs you: "Has the advance come?" (stays until answered)
      const st = await docSettings();
      const due = Math.round((d.estimate.total * (st.advancePercent || 50)) / 100);
      await Action.updateMany({ kind: 'payment', company: d.company, status: 'open' }, { $set: { status: 'dismissed', decidedBy: 'CRM', decidedAt: new Date(), decision: { note: 'A newer estimate was sent' } } });
      await Action.create({ kind: 'payment', company: d.company, emailAt: d.sentAt, quote: `Estimate ${d.number} sent to ${d.sentTo} on ${dmy(ymdIst(d.sentAt))}.\nTotal ₹${inr(d.estimate.total)} (${inWords(d.estimate.total)}).`, suggestion: { type: 'payment', note: `${st.advancePercent || 50}% advance = ₹${inr(due)}` }, decision: { estimate: d.number, docId: String(d._id), due, total: d.estimate.total } });
    }
    res.json({ ...d.toObject(), reviewUrl: link });
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const d = await ClientDoc.findById(checkId(req.params.id));
    if (!d) throw fail(404, 'Not found');
    if (d.status !== 'draft') throw fail(400, 'Only a draft can be deleted');
    if (d.kind === 'estimate') await giveBackEstimateNumber(d.number);
    await d.deleteOne();
    res.json({ ok: true });
  })
);

/* ---------------- estimate ---------------- */
router.post(
  '/company/:id/estimate',
  ah(async (req, res) => {
    const company = await Company.findById(checkId(req.params.id)).lean();
    if (!company) throw fail(404, 'Company not found');
    const f = await flowFor(company._id);
    if (!f.agreed) throw fail(400, 'The agreement must be accepted first');
    const draft = await ClientDoc.findOne({ company: company._id, kind: 'estimate', status: 'draft' });
    if (draft) return res.json(draft);
    const st = await docSettings();
    const af = f.agreement?.fields || {};
    const creators = Number(af.creators) || 0;
    const items = creators ? [{ desc: `${creators} Barter Influencer`, qty: creators, rate: 1000 }, { desc: 'Platform Fees', rate: 10000 }] : [{ desc: '', qty: 1, rate: 0 }];
    const to = await defaultTo(company._id);
    const number = await takeEstimateNumber();
    const t = estimateTotals({ items, gstRate: 18 });
    const d = await ClientDoc.create({
      company: company._id,
      kind: 'estimate',
      number,
      estimate: { date: ymdIst(), billTo: { name: company.billing?.legalName || af.clientName || company.name, address: company.billing?.address || '', gst: company.billing?.gst || '' }, terms: st.estimateTerms, ...t },
      mail: {
        to: f.agreement?.mail?.to || to.to,
        cc: f.agreement?.mail?.cc || '',
        subject: `Estimate ${number} – Geek Creative Agency x ${company.name}`,
        body: `Hi ${to.name || 'there'},\n\nThank you for accepting the agreement. Please find attached our estimate ${number} for the ${company.name} campaign.\n\nAs agreed, a ${st.advancePercent || 50}% advance starts the campaign. The bank details are in the estimate.\n\nBest regards,\n${config.fromName}`,
      },
      by: who(req),
    });
    res.status(201).json(d);
  })
);

/* ---------------- done outside the CRM (deals already in progress) ---------------- */
router.post(
  '/company/:id/outside',
  ah(async (req, res) => {
    const company = await Company.findById(checkId(req.params.id)).lean();
    if (!company) throw fail(404, 'Company not found');
    const kind = req.body?.kind === 'estimate' ? 'estimate' : 'agreement';
    const note = str(req.body?.note, 500);
    if (kind === 'estimate') {
      const total = Math.round(Number(String(req.body?.total || '').replace(/[,₹\s]/g, '')) || 0);
      if (!(total > 0)) throw fail(400, 'Enter the estimate total (with GST)');
      const noGst = req.body?.noGst === true;
      const gst = checkGst(req.body?.gst, noGst);
      const d = await ClientDoc.create({ company: company._id, kind, status: 'outside', number: str(req.body?.number, 40), estimate: { date: ymdIst(), billTo: { name: company.billing?.legalName || company.name, gst }, noGst, items: [], total, subtotal: total, gst: 0 }, outside: { note, by: who(req), at: new Date() }, by: who(req) });
      if (gst) await Company.updateOne({ _id: company._id }, { $set: { 'billing.gst': gst } });
      return res.status(201).json(d);
    }
    const d = await ClientDoc.create({ company: company._id, kind, status: 'outside', fields: {}, outside: { note, by: who(req), at: new Date() }, by: who(req) });
    res.status(201).json(d);
  })
);

/* ---------------- the payment ---------------- */
export async function recordPayment(companyId, { amount, date, reference, by }) {
  const a = Math.round(Number(String(amount ?? '').replace(/[,₹\s]/g, '')) || 0);
  if (!(a > 0)) throw fail(400, 'Enter the amount received');
  const f = await flowFor(companyId);
  if (!f) throw fail(404, 'Company not found');
  if (!f.estimateSent) throw fail(400, 'The estimate must be sent first');
  const p = { kind: 'advance', amount: a, date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : ymdIst(), reference: str(reference, 120), estimate: f.estimate?.number || '', by, at: new Date() };
  await Company.updateOne({ _id: companyId }, { $push: { payments: p } });
  await Action.updateMany({ kind: 'payment', company: companyId, status: 'open' }, { $set: { status: 'done', decidedBy: by, decidedAt: new Date(), decision: { choice: 'received', ...p } } });
  await notify('action', null, { text: `Payment ₹${inr(a)} received from ${f.company.name}. Finish the checklist and create the account.` }).catch(() => {});
  return p;
}
router.post(
  '/company/:id/payment',
  ah(async (req, res) => {
    const p = await recordPayment(checkId(req.params.id), { ...(req.body || {}), by: who(req) });
    res.json({ payment: p, flow: await flowFor(req.params.id) });
  })
);

/* ---------------- settings ---------------- */
router.get(
  '/settings/all',
  ah(async (_req, res) => res.json({ ...(await docSettings()), defaults: { agreementTemplate: DOC_DEFAULTS.agreementTemplate }, nextEstimateNumber: await peekEstimateNumber() }))
);
router.put(
  '/settings/all',
  ah(async (req, res) => {
    const b = req.body || {};
    const st = await docSettings();
    if (typeof b.agreementTemplate === 'string') {
      const t = cleanHtml(b.agreementTemplate);
      if (!t) throw fail(400, 'The template is empty');
      st.agreementTemplate = t;
    }
    if (b.agreementFields) st.agreementFields = Object.fromEntries(Object.keys(DOC_DEFAULTS.agreementFields).map((k) => [k, str(b.agreementFields[k] ?? st.agreementFields[k], 300)]));
    if (b.signatory) st.signatory = { name: str(b.signatory.name, 120), designation: str(b.signatory.designation, 120) };
    if (b.geek) st.geek = Object.fromEntries(Object.keys(DOC_DEFAULTS.geek).map((k) => [k, str(b.geek[k] ?? st.geek[k], 600)]));
    if (typeof b.bank === 'string') st.bank = str(b.bank, 1000);
    if (Array.isArray(b.estimateTerms)) st.estimateTerms = b.estimateTerms.map((x) => str(x, 500)).filter(Boolean).slice(0, 15);
    if (b.advancePercent !== undefined) {
      const n = Math.round(Number(b.advancePercent));
      if (!(n >= 1 && n <= 100)) throw fail(400, 'The advance must be 1 to 100%');
      st.advancePercent = n;
    }
    await saveDocSettings(st);
    res.json({ ...st, nextEstimateNumber: await peekEstimateNumber() });
  })
);

export default router;
