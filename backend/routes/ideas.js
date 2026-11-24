// Idea Bucket: anyone who logs in (admin, employees, the Insights login, clients) can suggest an idea.
// The team (admin, employees, Insights) sees and votes on each other's ideas; a client sees only their own.
// Only the admin moves an idea through its stages and adds an admin note.
import { Router } from 'express';
import mongoose from 'mongoose';
import { HrFile } from '../hr-models.js';
import { removeFile } from './files.js';
import { ah, checkId, fail, str } from '../utils.js';

const { Schema, model } = mongoose;

export const CATEGORIES = ['CRM', 'Employee portal', 'Insights', 'Client portal', 'Process', 'Other'];
export const STATUSES = ['new', 'review', 'planned', 'progress', 'done', 'notnow'];
const STATUS_LABEL = { new: 'New', review: 'Under review', planned: 'Planned', progress: 'In progress', done: 'Done', notnow: 'Not now' };

const person = { _id: false, key: String, name: String, kind: { type: String, enum: ['admin', 'team', 'insights', 'client'] } };
const fileRef = new Schema({ id: String, name: String, size: Number, type: { type: String } }, { _id: false });

export const Idea = model(
  'Idea',
  new Schema(
    {
      title: { type: String, required: true },
      detail: { type: String, default: '' },
      category: { type: String, enum: CATEGORIES, default: 'Other' },
      status: { type: String, enum: STATUSES, default: 'new', index: true },
      author: person,
      company: { type: String, default: '' }, // a client's company, so the admin knows who asked
      votes: [String], // person keys
      files: [fileRef],
      adminNote: { type: String, default: '' },
      comments: [{ by: person, text: String, at: { type: Date, default: () => new Date() } }],
      history: [{ status: String, by: String, at: { type: Date, default: () => new Date() } }],
    },
    { timestamps: true }
  )
);

/** who is asking, as one stable key */
export function who(req) {
  if (req.role === 'admin') return { key: `admin:${req.user}`, name: 'Admin', kind: 'admin' };
  if (req.role === 'insights') return { key: `insights:${req.user}`, name: req.user, kind: 'insights' };
  return { key: String(req.account._id), name: req.account.name, kind: req.role };
}

/** may this person see this idea? admin: all. team / insights: every team idea. client: their own only */
export function canSee(req, idea) {
  if (req.role === 'admin') return true;
  if (req.role === 'client') return idea.author?.key === who(req).key;
  return idea.author?.kind !== 'client';
}
const visibleFilter = (req) => (req.role === 'admin' ? {} : req.role === 'client' ? { 'author.key': who(req).key } : { 'author.kind': { $ne: 'client' } });

function shape(req, i, full = false) {
  const me = who(req).key;
  const out = {
    _id: i._id,
    title: i.title,
    detail: full ? i.detail : String(i.detail || '').slice(0, 220),
    category: i.category,
    status: i.status,
    statusLabel: STATUS_LABEL[i.status],
    author: { name: i.author?.name, kind: i.author?.kind },
    company: req.role === 'admin' ? i.company : undefined,
    mine: i.author?.key === me,
    votes: (i.votes || []).length,
    voted: (i.votes || []).includes(me),
    comments: (i.comments || []).length,
    files: (i.files || []).length,
    adminNote: i.adminNote || '',
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
  if (full) {
    out.files = i.files || [];
    out.commentList = (i.comments || []).map((c) => ({ _id: c._id, name: c.by?.name, kind: c.by?.kind, text: c.text, at: c.at, mine: c.by?.key === me }));
    out.history = (i.history || []).map((h) => ({ status: h.status, label: STATUS_LABEL[h.status], by: h.by, at: h.at }));
    out.canEdit = req.role === 'admin' || (out.mine && i.status === 'new');
  }
  return out;
}

const router = Router();

router.get(
  '/',
  ah(async (req, res) => {
    const base = visibleFilter(req);
    const filter = { ...base };
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (CATEGORIES.includes(req.query.category)) filter.category = req.query.category;
    if (req.query.mine === '1') filter['author.key'] = who(req).key;
    const q = str(req.query.q, 100);
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { detail: rx }];
    }
    const sort = req.query.sort === 'top' ? { votesCount: -1, createdAt: -1 } : { createdAt: -1 };
    const list = await Idea.aggregate([{ $match: filter }, { $addFields: { votesCount: { $size: { $ifNull: ['$votes', []] } } } }, { $sort: sort }, { $limit: 300 }]);
    const counts = await Idea.aggregate([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const by = Object.fromEntries(counts.map((c) => [c._id, c.n]));
    res.json({
      list: list.map((i) => shape(req, i)),
      stats: { total: counts.reduce((n, c) => n + c.n, 0), new: by.new || 0, planned: (by.planned || 0) + (by.progress || 0), done: by.done || 0 },
      categories: CATEGORIES,
      statuses: STATUSES.map((k) => ({ key: k, label: STATUS_LABEL[k] })),
      isAdmin: req.role === 'admin',
    });
  })
);

const fields = (b = {}) => {
  const title = str(b.title, 140);
  const detail = str(b.detail, 5000);
  if (title.length < 4) throw fail(400, 'Give your idea a short title');
  if (!detail) throw fail(400, 'Explain the idea in a line or two');
  return { title, detail, category: CATEGORIES.includes(b.category) ? b.category : 'Other' };
};

router.post(
  '/',
  ah(async (req, res) => {
    const me = who(req);
    const recent = await Idea.countDocuments({ 'author.key': me.key, createdAt: { $gte: new Date(Date.now() - 3600000) } });
    if (recent >= 20) throw fail(429, 'Too many ideas in an hour. Please try again later.');
    let company = '';
    if (req.role === 'client' && req.account.companyId) {
      company = (await mongoose.model('Company').findById(req.account.companyId).select('name').lean())?.name || '';
    }
    const idea = await Idea.create({ ...fields(req.body), author: me, company, votes: [me.key], history: [{ status: 'new', by: me.name }] });
    res.status(201).json(shape(req, idea.toObject(), true));
  })
);

async function load(req) {
  const i = await Idea.findById(checkId(req.params.id));
  if (!i || !canSee(req, i)) throw fail(404, 'Idea not found');
  return i;
}

router.get('/:id', ah(async (req, res) => res.json(shape(req, (await load(req)).toObject(), true))));

router.post(
  '/:id/vote',
  ah(async (req, res) => {
    const i = await load(req);
    const me = who(req).key;
    const has = i.votes.includes(me);
    await Idea.updateOne({ _id: i._id }, has ? { $pull: { votes: me } } : { $addToSet: { votes: me } });
    res.json(shape(req, (await Idea.findById(i._id).lean()), true));
  })
);

router.post(
  '/:id/comments',
  ah(async (req, res) => {
    const i = await load(req);
    const text = str(req.body?.text, 2000);
    if (!text) throw fail(400, 'Write a comment');
    i.comments.push({ by: who(req), text });
    await i.save();
    res.status(201).json(shape(req, i.toObject(), true));
  })
);

router.delete(
  '/:id/comments/:cid',
  ah(async (req, res) => {
    const i = await load(req);
    const c = i.comments.id(req.params.cid);
    if (!c) throw fail(404, 'Comment not found');
    if (req.role !== 'admin' && c.by?.key !== who(req).key) throw fail(403, 'You can delete only your own comment');
    c.deleteOne();
    await i.save();
    res.json(shape(req, i.toObject(), true));
  })
);

// the author edits while it is still New; the admin changes the stage and the admin note any time
router.put(
  '/:id',
  ah(async (req, res) => {
    const i = await load(req);
    const admin = req.role === 'admin';
    const mine = i.author?.key === who(req).key;
    if (req.body?.title !== undefined || req.body?.detail !== undefined || req.body?.category !== undefined) {
      if (!admin && !mine) throw fail(403, 'You can edit only your own idea');
      if (!admin && i.status !== 'new') throw fail(403, 'You can edit your idea only while it is New');
      Object.assign(i, fields({ title: req.body.title ?? i.title, detail: req.body.detail ?? i.detail, category: req.body.category ?? i.category }));
    }
    if (req.body?.status !== undefined) {
      if (!admin) throw fail(403, 'Only the admin can change the stage');
      if (!STATUSES.includes(req.body.status)) throw fail(400, 'Unknown stage');
      if (i.status !== req.body.status) {
        i.status = req.body.status;
        i.history.push({ status: i.status, by: 'Admin' });
      }
    }
    if (req.body?.adminNote !== undefined) {
      if (!admin) throw fail(403, 'Only the admin can add the admin note');
      i.adminNote = str(req.body.adminNote, 1000);
    }
    await i.save();
    res.json(shape(req, i.toObject(), true));
  })
);

// attach files that were uploaded for this idea (POST /api/files with { idea: id })
router.post(
  '/:id/files',
  ah(async (req, res) => {
    const i = await load(req);
    if (req.role !== 'admin' && i.author?.key !== who(req).key) throw fail(403, 'Only the person who sent the idea can attach files');
    const ids = (Array.isArray(req.body?.files) ? req.body.files : []).map((f) => (typeof f === 'object' ? f?.id : f)).filter((x) => mongoose.isValidObjectId(x));
    const files = await HrFile.find({ _id: { $in: ids }, owner: i._id }).lean();
    for (const f of files) if (!i.files.some((x) => x.id === String(f._id))) i.files.push({ id: String(f._id), name: f.name, size: f.size, type: f.type });
    if (i.files.length > 10) throw fail(400, 'An idea can have up to 10 files');
    await i.save();
    res.json(shape(req, i.toObject(), true));
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const i = await load(req);
    if (req.role !== 'admin' && i.author?.key !== who(req).key) throw fail(403, 'You can delete only your own idea');
    if (req.role !== 'admin' && i.status !== 'new') throw fail(403, 'You can delete your idea only while it is New');
    for (const f of await HrFile.find({ owner: i._id }).select('_id').lean()) await removeFile(String(f._id));
    await i.deleteOne();
    res.json({ ok: true });
  })
);

export default router;
