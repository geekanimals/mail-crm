// Files for the employee portal (reports, target sheets, documents).
// Upload: POST { name, type, data (base64), for? } -> saved on the server disk (UPLOAD_DIR), max 10 MB.
// Read:   GET /:id -> only the admin or the employee the file belongs to.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import mongoose from 'mongoose';
import { HrFile, HrTask } from '../hr-models.js';
import { User } from '../models.js';
import { ah, checkId, fail, str } from '../utils.js';

const router = Router();
const here = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(here, '..', 'uploads'));
const MAX = 10 * 1024 * 1024;
const OK_EXT = /\.(pdf|png|jpe?g|webp|gif|heic|docx?|xlsx?|csv|pptx?|txt|zip)$/i;

/** the employee a request may act for: themselves, or anyone (admin) */
async function ownerFor(req, wanted, deal, idea) {
  // an Idea Bucket attachment: the person who sent the idea, or the admin
  if (idea) {
    const i = mongoose.isValidObjectId(idea) ? await mongoose.model('Idea').findById(idea).select('author').lean() : null;
    if (!i) throw fail(400, 'Idea not found');
    const { who } = await import('./ideas.js');
    if (req.role === 'admin' || i.author?.key === who(req).key) return i._id;
    throw fail(403, 'Only the person who sent the idea can attach files');
  }
  // a deal document (estimate, PO, invoice, report): the admin, or an employee with a task on that deal
  if (deal) {
    const d = mongoose.isValidObjectId(deal) ? await mongoose.model('Deal').findById(deal).select('_id').lean() : null;
    if (!d) throw fail(400, 'Deal not found');
    if (req.role === 'admin' || (req.role === 'team' && (await HrTask.exists({ deal: d._id, user: req.account._id })))) return d._id;
    throw fail(403, 'You cannot upload files for this deal');
  }
  if (req.role === 'team') return req.account._id;
  if (req.role === 'admin' && mongoose.isValidObjectId(wanted) && (await User.exists({ _id: wanted, role: 'team' }))) return wanted;
  throw fail(req.role === 'admin' ? 400 : 403, req.role === 'admin' ? 'Choose the employee this file is for' : 'You cannot upload files');
}

/** admin: all. employee: their own files, and files of deals they work on. client: their deal's shared documents */
async function mayRead(req, f) {
  if (req.role === 'admin') return true;
  const idea = await mongoose.model('Idea').findById(f.owner).select('author').lean().catch(() => null);
  if (idea) return (await import('./ideas.js')).canSee(req, idea);
  if (req.role === 'team' && String(f.owner) === String(req.account._id)) return true;
  const deal = await mongoose.model('Deal').findById(f.owner).select('company documents.file.id documents.emailedAt').lean().catch(() => null);
  if (!deal) return false;
  if (req.role === 'team') return Boolean(await HrTask.exists({ deal: deal._id, user: req.account._id }));
  if (req.role === 'client') return String(deal.company) === String(req.account.companyId) && deal.documents.some((d) => d.file?.id === String(f._id) && d.emailedAt);
  return false;
}

router.post(
  '/',
  ah(async (req, res) => {
    const owner = await ownerFor(req, req.body?.for, req.body?.deal, req.body?.idea);
    const name = str(req.body?.name, 200).replace(/[\\/]/g, '_') || 'file';
    if (!OK_EXT.test(name)) throw fail(400, 'This file type is not allowed (use PDF, image, Word, Excel, PowerPoint, CSV, TXT or ZIP)');
    const data = str(req.body?.data, 15 * 1024 * 1024).replace(/^data:[^,]*,/, '');
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) throw fail(400, 'The file is empty');
    if (buf.length > MAX) throw fail(400, 'The file is bigger than 10 MB');
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const stored = `${crypto.randomBytes(16).toString('hex')}${path.extname(name).toLowerCase()}`;
    await fs.writeFile(path.join(UPLOAD_DIR, stored), buf);
    const f = await HrFile.create({ owner, name, type: str(req.body?.type, 100) || 'application/octet-stream', size: buf.length, path: stored, uploadedBy: req.user });
    res.status(201).json({ id: f._id, name: f.name, size: f.size, type: f.type });
  })
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const f = await HrFile.findById(checkId(req.params.id)).lean();
    if (!f || !(await mayRead(req, f))) throw fail(404, 'File not found');
    const full = path.join(UPLOAD_DIR, path.basename(f.path));
    try {
      await fs.access(full);
    } catch {
      throw fail(404, 'File is missing on the server');
    }
    res.setHeader('Content-Type', f.type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(full);
  })
);

/** a profile photo: must be an image file that belongs to this employee. Returns its id, or '' to remove. */
export async function photoFor(value, owner) {
  if (value === '' || value === null) return '';
  if (!mongoose.isValidObjectId(value)) throw fail(400, 'Upload the photo first');
  const f = await HrFile.findOne({ _id: value, owner }).lean();
  if (!f || !/^image\//.test(f.type || '') || !/\.(png|jpe?g|webp|gif|heic)$/i.test(f.name || '')) throw fail(400, 'The photo must be an image (JPG, PNG or WEBP)');
  if (f.size > 5 * 1024 * 1024) throw fail(400, 'The photo must be smaller than 5 MB');
  return String(f._id);
}

/** delete a stored file (record + file on disk) */
export async function removeFile(idv) {
  if (!mongoose.isValidObjectId(idv)) return;
  const f = await HrFile.findByIdAndDelete(idv).lean();
  if (f) await fs.unlink(path.join(UPLOAD_DIR, path.basename(f.path))).catch(() => {});
}

/** turn [{id}] / [id] from a request into stored file refs the person may use */
export async function fileRefs(list, owner) {
  const ids = (Array.isArray(list) ? list : []).map((x) => (typeof x === 'object' ? x?.id : x)).filter((x) => mongoose.isValidObjectId(x)).slice(0, 20);
  if (!ids.length) return [];
  const files = await HrFile.find({ _id: { $in: ids }, owner }).lean();
  return files.map((f) => ({ id: f._id, name: f.name, size: f.size, type: f.type }));
}

export default router;
