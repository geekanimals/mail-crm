// Links inside emails: unsubscribe page, open pixel, click tracking (no login)
import express, { Router } from 'express';
import { config } from '../config.js';
import { Contact, EmailLog } from '../models.js';
import { escapeHtml, verifySign } from '../mail.js';
import { markUnsubscribed } from '../worker.js';

const router = Router();
const TOKEN = /^[a-f0-9]{48}$/;
const TRACK = /^[a-f0-9]{32}$/;

const page = (title, msg, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f6fb;font-family:system-ui,Arial,sans-serif;padding:16px}
.c{background:#fff;border-radius:16px;padding:32px;max-width:420px;width:100%;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.06)}
h1{font-size:22px;margin:0 0 10px}p{color:#5b6472;line-height:1.6}button{background:#1a5cff;color:#fff;border:0;border-radius:10px;padding:12px;width:100%;font-size:15px;font-weight:600;cursor:pointer}</style>
</head><body><div class="c"><h1>${title}</h1><p>${msg}</p>${extra}</div></body></html>`;

async function findContact(token) {
  return TOKEN.test(token) ? Contact.findOne({ unsubscribeToken: token }) : null;
}

// confirm page (a button click, so email scanners can't unsubscribe people by accident)
router.get('/u/:token', async (req, res, next) => {
  try {
    const c = await findContact(req.params.token);
    if (!c) return res.status(404).send(page('Link not valid', 'This unsubscribe link is not valid.'));
    if (c.status === 'unsubscribed') return res.send(page("You're unsubscribed", `<b>${escapeHtml(c.email)}</b> won't receive any more emails.`));
    res.send(page('Unsubscribe?', `<b>${escapeHtml(c.email)}</b> will not receive any more emails from ${escapeHtml(config.fromName)}.`,
      `<form method="post"><button>Yes, unsubscribe me</button></form>`));
  } catch (e) {
    next(e);
  }
});

// form button + Gmail one-click unsubscribe
router.post('/u/:token', express.urlencoded({ extended: false, limit: '2kb' }), async (req, res, next) => {
  try {
    const c = await findContact(req.params.token);
    if (!c) return res.status(404).send(page('Link not valid', 'This unsubscribe link is not valid.'));
    if (c.status !== 'unsubscribed') await markUnsubscribed(c);
    res.send(page("You're unsubscribed", `<b>${escapeHtml(c.email)}</b> has been removed. You won't hear from us again.`));
  } catch (e) {
    next(e);
  }
});

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
router.get('/t/o/:id.gif', (req, res) => {
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }).end(GIF);
  if (TRACK.test(req.params.id)) EmailLog.updateOne({ trackingId: req.params.id, openedAt: null }, { $set: { openedAt: new Date() } }).catch(() => {});
});

router.get('/t/c/:id', (req, res) => {
  const { id } = req.params;
  const url = String(req.query.u || '');
  // signed links only -> can't be used as an open redirect
  if (!TRACK.test(id) || !/^https?:\/\//i.test(url) || !verifySign(`${id}|${url}`, req.query.s)) return res.status(400).send(page('Link not valid', 'This link is not valid.'));
  const now = new Date();
  EmailLog.updateOne({ trackingId: id, clickedAt: null }, { $set: { clickedAt: now } })
    .then(() => EmailLog.updateOne({ trackingId: id, openedAt: null }, { $set: { openedAt: now } }))
    .catch(() => {});
  res.redirect(url);
});

export default router;
