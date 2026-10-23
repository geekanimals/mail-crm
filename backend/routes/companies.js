// Companies / accounts pipeline: cold -> hot -> opportunity -> account (+ old clients),
// many contact points per company, team tasks per account, and import from a Google Sheet.
import crypto from 'node:crypto';
import { Router } from 'express';
import { Company, Contact, EmailLog, STAGES, Suppression, User, companyKey, hashPassword, upsertCompany } from '../models.js';
import { strongEnough } from './team.js';
import { mapColumns, parseAccounts, parseCSV, parseOpportunity, rowToLead, saveLead, statusFromSheet } from '../sheets.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';

const router = Router();
// team members come from the Team page (people with a team login)
export const getTeam = async () => (await User.find({ role: 'team', active: true }).sort({ name: 1 }).select('name').lean()).map((u) => u.name);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const details = (b = {}) => {
  const out = {};
  for (const k of ['website', 'industry', 'location', 'linkedin', 'owner', 'source']) if (b[k] !== undefined) out[k] = str(b[k], 300);
  if (b.notes !== undefined) out.notes = str(b.notes, 20000);
  if (b.stage !== undefined) {
    if (!STAGES.includes(b.stage)) throw fail(400, 'Unknown stage');
    out.stage = b.stage;
  }
  return out;
};

/* ---------- team members ---------- */
router.get('/team', ah(async (_req, res) => res.json({ team: await getTeam() })));

/* ---------- every open task, by team member ---------- */
router.get(
  '/tasks',
  ah(async (req, res) => {
    const member = str(req.query.member, 60);
    const match = { 'tasks.0': { $exists: true } };
    const list = await Company.find(match).select('name stage owner tasks').lean();
    const items = [];
    for (const c of list)
      for (const t of c.tasks)
        if ((!member || t.member === member) && (req.query.done === 'all' || !t.done)) items.push({ ...t, companyId: c._id, company: c.name, stage: c.stage });
    items.sort((a, b) => a.member.localeCompare(b.member) || new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ items, team: await getTeam() });
  })
);

/* ---------- list ---------- */
router.get(
  '/',
  ah(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const filter = {};
    if (STAGES.includes(req.query.stage)) filter.stage = req.query.stage;
    if (str(req.query.owner)) filter.owner = str(req.query.owner, 60);
    const q = escape(str(req.query.search, 100));
    if (q) filter.$or = ['name', 'industry', 'location', 'owner'].map((k) => ({ [k]: new RegExp(q, 'i') }));
    const [items, total, counts] = await Promise.all([
      Company.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Company.countDocuments(filter),
      Company.aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }]),
    ]);
    const people = await Contact.aggregate([
      { $match: { companyId: { $in: items.map((c) => c._id) } } },
      { $group: { _id: '$companyId', n: { $sum: 1 }, names: { $push: '$name' } } },
    ]);
    const byId = new Map(people.map((p) => [String(p._id), p]));
    res.json({
      items: items.map((c) => ({
        ...c,
        fields: undefined,
        contacts: byId.get(String(c._id))?.n || 0,
        contactNames: (byId.get(String(c._id))?.names || []).filter(Boolean).slice(0, 3),
        openTasks: (c.tasks || []).filter((t) => !t.done).length,
      })),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
      team: await getTeam(),
    });
  })
);

/* ---------- one company with all its people ---------- */
router.get(
  '/:id',
  ah(async (req, res) => {
    const id = checkId(req.params.id);
    const company = await Company.findById(id).lean();
    if (!company) throw fail(404, 'Company not found');
    const contacts = await Contact.find({ companyId: id }).sort({ createdAt: 1 }).lean();
    const last = await EmailLog.aggregate([
      { $match: { contact: { $in: contacts.map((c) => c._id) }, status: 'sent' } },
      { $group: { _id: '$contact', at: { $max: '$sentAt' }, n: { $sum: 1 } } },
    ]);
    const sent = new Map(last.map((l) => [String(l._id), l]));
    const login = await User.findOne({ role: 'client', companyId: id }).lean();
    res.json({
      company,
      clientLogin: login ? { _id: login._id, name: login.name, email: login.email, active: login.active, lastLoginAt: login.lastLoginAt } : null,
      contacts: contacts.map((c) => ({ ...c, unsubscribeToken: undefined, sent: sent.get(String(c._id))?.n || 0, lastSentAt: sent.get(String(c._id))?.at || c.lastContactedAt })),
      team: await getTeam(),
    });
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const name = str(req.body?.name, 200);
    if (!name) throw fail(400, 'Company name is required');
    if (await Company.exists({ key: companyKey(name) })) throw fail(409, 'This company already exists');
    res.status(201).json(await Company.create({ ...details(req.body), name, key: companyKey(name) }));
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const c = await Company.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Company not found');
    if (req.body?.stage === 'account' && !['opportunity', 'account'].includes(c.stage)) {
      // a company that was an account before (moved back by mistake) may go straight back
      const wasAccount = c.tasks?.length || c.team?.length || c.messages?.length || (await User.exists({ role: 'client', companyId: c._id }));
      if (!wasAccount) throw fail(400, 'Only an Opportunity can become an account (use "Convert to account")');
    }
    Object.assign(c, details(req.body));
    const name = str(req.body?.name, 200);
    if (name && name !== c.name) {
      const key = companyKey(name);
      if (await Company.exists({ key, _id: { $ne: c._id } })) throw fail(409, 'Another company has this name');
      c.name = name;
      c.key = key;
      await Contact.updateMany({ companyId: c._id }, { $set: { company: name } });
    }
    await c.save();
    res.json(c);
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const id = checkId(req.params.id);
    await Contact.updateMany({ companyId: id }, { $unset: { companyId: 1 } }); // people stay in Contacts
    await User.deleteMany({ role: 'client', companyId: id }); // the client's login goes with the company
    await Company.deleteOne({ _id: id });
    res.json({ ok: true });
  })
);

/* ---------- convert to account + the client's login (email + password made by the admin) ---------- */
async function saveClientLogin(company, body) {
  const email = validEmail(body?.email);
  if (!email) throw fail(400, 'Enter a valid email for the client login');
  let u = await User.findOne({ role: 'client', companyId: company._id });
  const other = await User.findOne({ email });
  if (other && String(other._id) !== String(u?._id)) throw fail(409, 'This email already has a login');
  if (!u) {
    u = new User({ role: 'client', companyId: company._id, email, name: str(body?.name, 80) || company.name, passwordHash: hashPassword(strongEnough(body?.password)) });
  } else {
    u.email = email;
    if (str(body?.name, 80)) u.name = str(body.name, 80);
    if (body?.password) u.passwordHash = hashPassword(strongEnough(body.password));
    if (body?.active !== undefined) u.active = body.active === true;
  }
  await u.save();
  return u;
}

router.post(
  '/:id/convert',
  ah(async (req, res) => {
    const c = await Company.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Company not found');
    if (c.stage !== 'opportunity') throw fail(400, 'Only an Opportunity can be converted to an account. Move it to Opportunity first.');
    const login = req.body?.email ? await saveClientLogin(c, req.body) : null; // login is optional
    c.stage = 'account';
    await c.save();
    res.json({ company: c, clientLogin: login });
  })
);

router.put(
  '/:id/client-login',
  ah(async (req, res) => {
    const c = await Company.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Company not found');
    res.json(await saveClientLogin(c, req.body));
  })
);

router.delete(
  '/:id/client-login',
  ah(async (req, res) => {
    await User.deleteOne({ role: 'client', companyId: checkId(req.params.id) });
    res.json({ ok: true });
  })
);

/* ---------- contact points (members) ---------- */
router.post(
  '/:id/members',
  ah(async (req, res) => {
    const c = await Company.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Company not found');
    const b = req.body || {};
    const email = b.email ? validEmail(b.email) : null;
    if (b.email && !email) throw fail(400, 'Email is not valid');
    if (!email && !str(b.name)) throw fail(400, 'Name or email is required');
    let contact = email ? await Contact.findOne({ email }) : null;
    if (!contact) {
      const memory = email ? await Suppression.findOne({ email }).lean() : null;
      contact = new Contact({ ...(email ? { email } : {}), status: memory?.reason || 'new', source: 'Added manually' });
    }
    for (const k of ['name', 'title', 'phone', 'linkedin', 'notes']) if (str(b[k])) contact[k] = str(b[k], k === 'notes' ? 5000 : 300);
    contact.companyId = c._id;
    contact.company = c.name;
    await contact.save();
    c.updatedAt = new Date();
    await c.save();
    res.status(201).json(contact);
  })
);

router.delete(
  '/:id/members/:contactId',
  ah(async (req, res) => {
    await Contact.updateOne({ _id: checkId(req.params.contactId), companyId: checkId(req.params.id) }, { $unset: { companyId: 1 } });
    res.json({ ok: true });
  })
);

/* ---------- team tasks on an account ---------- */
router.post(
  '/:id/tasks',
  ah(async (req, res) => {
    const member = str(req.body?.member, 60);
    const task = str(req.body?.task, 2000);
    if (!member || !task) throw fail(400, 'Choose a team member and write the task');
    if (!(await getTeam()).includes(member)) throw fail(400, `${member} is not on the Team page (or their login is turned off)`);
    const c = await Company.findOneAndUpdate(
      { _id: checkId(req.params.id), stage: { $in: ['account', 'old_client'] } },
      { $push: { tasks: { member, task, done: false, updatedAt: new Date() } }, $addToSet: { team: member } },
      { new: true }
    );
    if (!c) throw fail(400, 'Team tasks are for accounts. Convert this company to an account first.');
    res.status(201).json(c);
  })
);

router.put(
  '/:id/tasks/:taskId',
  ah(async (req, res) => {
    const set = { 'tasks.$.updatedAt': new Date() };
    if (req.body?.member !== undefined) {
      const member = str(req.body.member, 60);
      if (!(await getTeam()).includes(member)) throw fail(400, `${member} is not on the Team page`);
      set['tasks.$.member'] = member;
    }
    if (req.body?.task !== undefined) set['tasks.$.task'] = str(req.body.task, 2000);
    if (req.body?.done !== undefined) set['tasks.$.done'] = req.body.done === true;
    const c = await Company.findOneAndUpdate({ _id: checkId(req.params.id), 'tasks._id': checkId(req.params.taskId) }, { $set: set }, { new: true });
    if (!c) throw fail(404, 'Task not found');
    res.json(c);
  })
);

router.delete(
  '/:id/tasks/:taskId',
  ah(async (req, res) => {
    const c = await Company.findByIdAndUpdate(checkId(req.params.id), { $pull: { tasks: { _id: checkId(req.params.taskId) } } }, { new: true });
    if (!c) throw fail(404, 'Company not found');
    res.json(c);
  })
);

/* ---------- account team + messages ---------- */
router.put(
  '/:id/team',
  ah(async (req, res) => {
    const all = await getTeam();
    const team = [...new Set((Array.isArray(req.body?.team) ? req.body.team : []).map((m) => str(m, 80)))].filter((m) => all.includes(m));
    const c = await Company.findOneAndUpdate({ _id: checkId(req.params.id), stage: { $in: ['account', 'old_client'] } }, { $set: { team } }, { new: true });
    if (!c) throw fail(400, 'Only accounts have a team');
    res.json(c);
  })
);

router.post(
  '/:id/messages',
  ah(async (req, res) => {
    const text = str(req.body?.text, 5000);
    if (!text) throw fail(400, 'Write a message');
    const c = await Company.findOneAndUpdate(
      { _id: checkId(req.params.id), stage: { $in: ['account', 'old_client'] } },
      { $push: { messages: { author: req.user, role: 'admin', text, createdAt: new Date() } } },
      { new: true }
    );
    if (!c) throw fail(400, 'Messages are for accounts');
    res.status(201).json(c.messages.at(-1));
  })
);

/* ---------- import from a Google Sheet link (runs in the background) ---------- */
const jobs = new Map(); // jobId -> progress

function sheetUrl(url) {
  const id = (String(url).match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/) || [])[1];
  if (!id) throw fail(400, 'Paste a Google Sheets link (docs.google.com/spreadsheets/d/...)');
  const gid = (String(url).match(/[#&?]gid=(\d+)/) || [])[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

function detectKind(rows, team) {
  const head = (rows[0] || []).map((h) => String(h).trim().toLowerCase());
  const map = mapColumns(rows[0] || []);
  if (map.email !== undefined && (map.name !== undefined || map.company !== undefined)) return 'leads';
  if (head.some((h) => /brand|campaign/.test(h)) && head.filter((h) => team.some((m) => m.toLowerCase() === h)).length >= 2) return 'accounts';
  return 'opportunities';
}

async function runImport(job, rows, kind, team) {
  const source = job.source;
  const companies = new Set();
  const bump = (k) => (job.result[k] = (job.result[k] || 0) + 1);
  try {
    if (kind === 'leads') {
      const headers = rows[0].map((h) => String(h).trim());
      const map = mapColumns(headers);
      job.total = rows.length - 1;
      for (const row of rows.slice(1)) {
        job.done++;
        const lead = rowToLead(headers, row, map);
        const st = statusFromSheet(lead.sheetStatus, Boolean(lead.sentDate));
        const r = await saveLead(lead, { batch: job.batch, source, stage: job.stage || st.stage, status: lead.email ? st.status : undefined });
        if (r.skipped) { bump('skipped'); continue; }
        bump(r.created ? 'newContacts' : 'updatedContacts');
        if (!lead.email) bump('withoutEmail');
        if (r.company) companies.add(String(r.company._id));
      }
    } else if (kind === 'opportunities') {
      job.total = rows.length;
      for (const row of rows) {
        job.done++;
        const o = parseOpportunity(row, team);
        if (!o.company || /^(source|lead source)$/i.test(row[0] || '')) { bump('skipped'); continue; }
        const c = await upsertCompany(o.company, { stage: 'opportunity', owner: o.owner, source: o.source, notes: o.notes, fields: o.fields });
        companies.add(String(c._id));
        bump('opportunities');
        if (o.email || o.person) {
          const r = await saveLead({ email: o.email, name: o.person, company: c.name, phone: o.phone }, { batch: job.batch, source, stage: 'opportunity', status: o.email ? 'replied' : undefined });
          if (!r.skipped) bump(r.created ? 'newContacts' : 'updatedContacts');
        }
      }
    } else {
      const accounts = parseAccounts(rows);
      job.total = accounts.length;
      for (const a of accounts) {
        job.done++;
        const c = await upsertCompany(a.name, { stage: 'account', source, tasks: a.tasks.map((t) => ({ ...t, done: false, updatedAt: new Date() })), fields: a.fields });
        companies.add(String(c._id));
        bump('accounts');
        if (a.tasks.length) job.result.tasks = (job.result.tasks || 0) + a.tasks.length;
      }
    }
    job.result.companies = companies.size;
    job.status = 'done';
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
  }
  job.finishedAt = new Date();
}

router.post(
  '/import/google',
  ah(async (req, res) => {
    const url = sheetUrl(str(req.body?.url, 1000));
    let text;
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      text = r.ok ? await r.text() : '';
    } catch {
      text = '';
    }
    if (!text || /^\s*</.test(text)) throw fail(400, 'Could not read this sheet. In Google Sheets: Share → General access → "Anyone with the link" (Viewer), then try again.');
    const rows = parseCSV(text);
    if (rows.length < 1) throw fail(400, 'This sheet tab is empty');
    const team = await getTeam();
    const kind = ['leads', 'opportunities', 'accounts'].includes(req.body?.kind) ? req.body.kind : detectKind(rows, team);
    const stage = STAGES.includes(req.body?.stage) ? req.body.stage : null; // optional: force a stage for leads
    const job = { id: crypto.randomUUID(), kind, status: 'running', done: 0, total: 0, result: {}, startedAt: new Date(), stage,
      batch: str(req.body?.batch, 200) || `Sheet ${kind} ${new Date().toISOString().slice(0, 10)}`, source: `Google Sheet (${kind})` };
    jobs.set(job.id, job);
    setTimeout(() => jobs.delete(job.id), 6 * 3600000).unref?.();
    runImport(job, rows, kind, team);
    res.status(202).json({ jobId: job.id, kind, rows: rows.length });
  })
);

router.get(
  '/import/google/:jobId',
  ah(async (req, res) => {
    const job = jobs.get(String(req.params.jobId));
    if (!job) throw fail(404, 'Import not found (the server may have restarted)');
    res.json({ ...job });
  })
);

export default router;
