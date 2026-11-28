// Companies / accounts pipeline: cold -> hot -> opportunity -> account (+ old clients),
// many contact points per company, team tasks per account, and import from a Google Sheet.
import crypto from 'node:crypto';
import { Router } from 'express';
import { Company, Contact, EmailLog, STAGES, Suppression, User, companyKey, hashPassword, upsertCompany } from '../models.js';
import { strongEnough } from './team.js';
import { bountyBrand, bountyBrandLogin, bountyReady, bountyResetLogin } from '../bounty.js';
import { Deal, startDeal } from '../lifecycle.js';
import { stageChanged } from '../models.js';
import { mapColumns, parseAccounts, parseCSV, parseOpportunity, rowToLead, saveLead, statusFromSheet } from '../sheets.js';
import { ah, checkId, fail, str, validEmail } from '../utils.js';
import { config } from '../config.js';
import { escapeHtml, sendMail } from '../mail.js';
import { getSetting } from '../models.js';

/* ---------- convert checklist: everything must be ticked before an Opportunity becomes an account ---------- */
export const DEFAULT_CHECKLIST = ['GST certificate', 'Campaign brief', 'Estimate', 'WhatsApp group'];
export async function convertChecklist() {
  const list = await getSetting('convertChecklist', null);
  return Array.isArray(list) && list.length ? list : DEFAULT_CHECKLIST;
}
export const BOUNTY_BRANDS_URL = 'https://bounty.geekcreativeagency.com/brands';
const crmLoginUrl = () => `${config.frontendUrls.find((u) => !/localhost|127\.0\.0\.1/.test(u)) || config.frontendUrls[0]}/login`;

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
// the checklist the convert form shows, and the links put in the login message
router.get(
  '/convert/checklist',
  ah(async (_req, res) => res.json({ items: await convertChecklist(), links: { crm: crmLoginUrl(), bounty: BOUNTY_BRANDS_URL } }))
);


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
      Company.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
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
      clientLogin: login ? { _id: login._id, name: login.name, email: login.email, active: login.active, lastLoginAt: login.lastLoginAt, bounty: Boolean(login.bountyMemberId) } : null,
      bounty: bountyReady(), // client logins are made on Bounty too (same email + password)
      deal: (await Deal.findOne({ company: id }).sort({ createdAt: -1 }).select('_id step').lean()) || null,
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
    const fromStage = c.stage;
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
    await stageChanged(c, fromStage, c.stage); // tasks for the new stage (meeting, contract, deal)
    res.json(c);
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const id = checkId(req.params.id);
    await Contact.updateMany({ companyId: id }, { $unset: { companyId: 1 } }); // people stay in Contacts
    await User.deleteMany({ role: 'client', companyId: id }); // the client's login goes with the company
    // its deals, client tasks and deal files go too
    const { HrTask, HrFile } = await import('../hr-models.js');
    const { removeFile } = await import('./files.js');
    const deals = await Deal.find({ company: id }).select('_id').lean();
    for (const f of await HrFile.find({ owner: { $in: [...deals.map((d) => d._id), id] } }).select('_id').lean()) await removeFile(String(f._id)); // deal files + agreement/estimate PDFs
    const { ClientDoc } = await import('../documents.js');
    await ClientDoc.deleteMany({ company: id }); // its agreements and estimates
    const { Action } = await import('../actions.js');
    await Action.deleteMany({ company: id }); // its Needs you cards
    await HrTask.deleteMany({ company: id });
    await Deal.deleteMany({ company: id });
    await Company.deleteOne({ _id: id });
    res.json({ ok: true });
  })
);

/* ---------- convert to account + the client's login (email + password made by the admin) ---------- */
// With Bounty set up (.env), a new client login is made on Bounty first (Bounty creates the password) and the CRM
// login gets the same email + password. Without Bounty, the admin's password is used. Returns { user, password }.
async function saveClientLogin(company, body) {
  const email = validEmail(body?.email);
  if (!email) throw fail(400, 'Enter a valid email for the client login');
  let u = await User.findOne({ role: 'client', companyId: company._id });
  const other = await User.findOne({ email });
  if (other && String(other._id) !== String(u?._id)) throw fail(409, 'This email already has a login');
  const name = str(body?.name, 80) || company.name;
  let password = null;
  if (!u) {
    if (bountyReady()) {
      const brand = await bountyBrand({ name: company.name, website: company.website });
      const made = await bountyBrandLogin({ brandId: brand.brandId, email, name });
      password = made.password;
      u = new User({ role: 'client', companyId: company._id, email, name, passwordHash: hashPassword(password), bountyBrandId: brand.brandId, bountyMemberId: made.memberId || '' });
    } else {
      password = strongEnough(body?.password);
      u = new User({ role: 'client', companyId: company._id, email, name, passwordHash: hashPassword(password) });
    }
  } else {
    if (u.bountyMemberId && email !== u.email) throw fail(400, 'This login is synced with Bounty, so its email cannot be changed here. Delete it and make a new one.');
    u.email = email;
    if (str(body?.name, 80)) u.name = str(body.name, 80);
    if (body?.password || body?.reset) {
      if (u.bountyMemberId && bountyReady()) {
        password = (await bountyResetLogin({ brandId: u.bountyBrandId, memberId: u.bountyMemberId })).password;
      } else password = strongEnough(body.password);
      u.passwordHash = hashPassword(password);
    }
    if (body?.active !== undefined) u.active = body.active === true;
  }
  await u.save();
  return { user: u, password, bounty: Boolean(u.bountyMemberId) };
}

router.post(
  '/:id/convert',
  ah(async (req, res) => {
    const c = await Company.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Company not found');
    if (c.stage !== 'opportunity') throw fail(400, 'Only an Opportunity can be converted to an account. Move it to Opportunity first.');
    // agreement accepted -> estimate sent -> advance received, then the checklist
    const { flowFor } = await import('./documents.js');
    const flow = await flowFor(c._id);
    if (!flow.agreed) throw fail(400, 'The agreement must be accepted first (Agreement & estimate on the company page)');
    if (!flow.estimateSent) throw fail(400, 'The estimate must be sent first');
    if (!flow.paymentReceived) throw fail(400, 'Mark the advance payment as received first');
    // every other checklist item must be ticked (a file is optional); the estimate and the GST number come from the estimate step
    const need = (await convertChecklist()).filter((l) => !/estimate|\bgst\b/i.test(l));
    const sent = Array.isArray(req.body?.checklist) ? req.body.checklist : [];
    const items = need.map((label) => {
      const s = sent.find((x) => String(x?.label || '').trim().toLowerCase() === label.toLowerCase());
      const file = s?.file?.id ? { id: str(s.file.id, 40), name: str(s.file.name, 200) } : undefined;
      const amount = /estimate/i.test(label) ? Math.round(Number(s?.amount) || 0) : 0;
      return { label, done: s?.done === true, ...(amount > 0 ? { amount } : {}), ...(file ? { file } : {}) };
    });
    const missing = items.filter((i) => !i.done).map((i) => i.label);
    if (missing.length) throw fail(400, `Tick everything on the checklist first: ${missing.join(', ')}`);
    items.push({ label: `Estimate ${flow.estimate?.number || ''}`.trim(), done: true, amount: Math.round(flow.total) });
    const gstNo = flow.estimate?.estimate?.billTo?.gst;
    items.unshift({ label: gstNo ? `GST number ${gstNo}` : 'GST: the client has no GST number', done: true });
    const login = req.body?.email ? await saveClientLogin(c, req.body) : null; // login is optional
    c.onboarding = { items, at: new Date(), by: req.user || 'admin' };
    c.stage = 'account';
    await c.save();
    const contract = req.body?.contract?.id ? req.body.contract : null;
    // agreement, estimate and advance are done: the deal starts at Execution with their documents and the payment
    const deal = await startDeal(c, { by: req.user, contract, flow });
    res.json({ company: c, clientLogin: login && { ...login.user.toJSON(), password: login.password, bounty: login.bounty }, deal: deal._id, links: { crm: crmLoginUrl(), bounty: BOUNTY_BRANDS_URL } });
  })
);


// email the client their login (the password is shown only once, so the admin's screen sends it back here)
router.post(
  '/:id/client-login/mail',
  ah(async (req, res) => {
    const c = await Company.findById(checkId(req.params.id)).lean();
    if (!c) throw fail(404, 'Company not found');
    const u = await User.findOne({ role: 'client', companyId: c._id }).lean();
    if (!u) throw fail(400, 'This company has no client login yet');
    const password = str(req.body?.password, 200);
    if (!password) throw fail(400, 'The password is needed to send the login');
    const to = validEmail(req.body?.to) || u.email;
    const bounty = Boolean(u.bountyMemberId);
    const crm = crmLoginUrl();
    const lines = [
      `Hi ${u.name || c.name},`,
      '',
      `Your Geek Creative Agency account for ${c.name} is ready. You can see the work we are doing for you here:`,
      '',
      `Geek CRM (your campaign work, tasks and messages): ${crm}`,
      ...(bounty ? [`Bounty brand dashboard (creators and content): ${BOUNTY_BRANDS_URL}`] : []),
      '',
      `Email: ${u.email}`,
      `Password: ${password}`,
      '',
      bounty ? 'The same email and password open both.' : '',
      'Please keep these details safe.',
      '',
      'Best regards,',
      config.fromName,
    ].filter((l, i, a) => !(l === '' && a[i - 1] === ''));
    const html = lines
      .map((l) => escapeHtml(l).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>'))
      .join('<br>');
    try {
      await sendMail({ to, name: u.name, email: { subject: `Your Geek Creative Agency login for ${c.name}`, text: lines.join('\n'), html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${html}</div>`, bulk: false } });
    } catch (e) {
      throw fail(502, `The email could not be sent: ${e.message}`);
    }
    res.json({ ok: true, to });
  })
);

router.put(
  '/:id/client-login',
  ah(async (req, res) => {
    const c = await Company.findById(checkId(req.params.id));
    if (!c) throw fail(404, 'Company not found');
    const login = await saveClientLogin(c, req.body);
    res.json({ ...login.user.toJSON(), password: login.password, bounty: login.bounty });
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
