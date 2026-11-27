// Newsletter links that email apps open (no login): the photos / GIFs / videos, the fixed design images,
// the open pixel and the click links (signed, so they cannot be used to send people anywhere else).
import path from 'node:path';
import express, { Router } from 'express';
import { NewsletterSend, verify } from '../newsletter.js';
import { ASSET_DIR, MEDIA_DIR } from '../newsletter-media.js';

const router = Router();
const SEND = /^[a-f0-9]{24}$/;
const FILE = /^[a-z0-9-]+\.(jpg|png|gif|mp4|mov|webm|m4v|mkv|avi)$/i;

// files: only plain names (no folders), cached for a long time (a file never changes once made)
const files = (dir) => [
  (req, res, next) => (FILE.test(path.basename(req.path)) && path.basename(req.path) === req.path.slice(1) ? next() : res.status(404).end()),
  express.static(dir, { maxAge: '365d', immutable: true, index: false, dotfiles: 'deny', fallthrough: false }),
];
router.use('/m', ...files(MEDIA_DIR));
router.use('/a', ...files(ASSET_DIR));

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
router.get('/o/:id.gif', (req, res) => {
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }).end(GIF);
  if (SEND.test(req.params.id)) NewsletterSend.updateOne({ _id: req.params.id, openedAt: null }, { $set: { openedAt: new Date() } }).catch(() => {});
});

router.get('/c/:id', (req, res) => {
  const { id } = req.params;
  const url = String(req.query.u || '');
  if (!SEND.test(id) || !/^https?:\/\//i.test(url) || !verify(`${id}|${url}`, req.query.s)) return res.status(400).send('This link is not valid.');
  const now = new Date();
  NewsletterSend.updateOne({ _id: id }, { $inc: { clicks: 1 } })
    .then(() => NewsletterSend.updateOne({ _id: id, clickedAt: null }, { $set: { clickedAt: now } }))
    .then(() => NewsletterSend.updateOne({ _id: id, openedAt: null }, { $set: { openedAt: now } })) // a click means it was opened
    .catch(() => {});
  res.redirect(url);
});

export default router;
