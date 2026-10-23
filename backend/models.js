// All MongoDB models in one place.
import crypto from 'node:crypto';
import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const id = Schema.Types.ObjectId;
mongoose.set('strictQuery', true);

// A person (a contact point). Email is optional - old leads may only have a phone / LinkedIn.
const contactSchema = new Schema(
  {
    email: { type: String, lowercase: true, trim: true },
    name: { type: String, default: '' },
    company: { type: String, default: '' }, // company name as written in the sheet
    companyId: { type: id, ref: 'Company', index: true }, // the company / account this person belongs to
    title: { type: String, default: '' }, // designation
    phone: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    website: { type: String, default: '' },
    industry: { type: String, default: '' },
    location: { type: String, default: '' },
    signal: { type: String, default: '' }, // buying signal
    notes: { type: String, default: '' }, // remarks
    leadDate: { type: String, default: '' },
    referredBy: { type: String, default: '' }, // came as a referral from this person (same company)
    source: { type: String, default: '' }, // which file / sheet it came from
    // every column from the uploaded sheet, exactly as it was (A to Z)
    fields: [{ _id: false, k: String, v: String }],
    customSubject: { type: String, default: '' }, // ready-written first email from CSV (e.g. ClientMagnet)
    customBody: { type: String, default: '' },
    // Your own written emails for this person, from the CSV / Excel file.
    // messages[0] = first email, messages[1] = follow-up 1 ... day = days after the first email
    messages: [{ _id: false, subject: String, body: String, day: Number }],
    batch: { type: String, default: '', index: true },
    status: { type: String, enum: ['new', 'contacted', 'replied', 'unsubscribed', 'bounced'], default: 'new', index: true },
    unsubscribeToken: { type: String, unique: true, default: () => crypto.randomBytes(24).toString('hex') },
    lastContactedAt: Date,
    repliedAt: Date,
  },
  {
    timestamps: true,
    toJSON: { transform: (_d, r) => (delete r.unsubscribeToken, delete r.__v, r) },
  }
);
// unique email, but many people may have no email
contactSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
export const Contact = model('Contact', contactSchema);

// A company / brand / account. stage = where it is in the pipeline.
export const STAGES = ['cold', 'hot', 'opportunity', 'account', 'old_client'];
export const STAGE_RANK = { cold: 0, hot: 1, opportunity: 2, account: 3, old_client: 3 };
export const companyKey = (name) =>
  String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(pvt|private|ltd|limited|llp|inc|co)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
export const Company = model(
  'Company',
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      key: { type: String, unique: true }, // name in lowercase, used to avoid duplicates
      website: { type: String, default: '' },
      industry: { type: String, default: '' },
      location: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      stage: { type: String, enum: STAGES, default: 'cold', index: true },
      owner: { type: String, default: '' }, // team member responsible
      source: { type: String, default: '' },
      notes: { type: String, default: '' },
      // accounts: who works on it, what each one has to do, and the conversation about it
      team: [String], // team member names
      tasks: [{ member: String, task: String, done: { type: Boolean, default: false }, updatedAt: { type: Date, default: () => new Date() } }],
      messages: [{ author: String, role: { type: String, enum: ['admin', 'team', 'client'] }, text: String, createdAt: { type: Date, default: () => new Date() } }],
      fields: [{ _id: false, k: String, v: String }], // original sheet row
    },
    { timestamps: true }
  )
);

/* ---------- logins for team members and clients (the admin login stays in .env) ---------- */
export const User = model(
  'User',
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true }, // login ID
      role: { type: String, enum: ['team', 'client'], required: true, index: true },
      title: { type: String, default: '' }, // e.g. "Account manager" (team) or the client's designation
      companyId: { type: id, ref: 'Company', index: true }, // clients: their account
      passwordHash: { type: String, required: true },
      active: { type: Boolean, default: true },
      lastLoginAt: Date,
    },
    { timestamps: true, toJSON: { transform: (_d, r) => (delete r.passwordHash, delete r.__v, r) } }
  )
);
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
export function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Move a company forward in the pipeline (never backwards). */
export async function bumpStage(companyId, stage) {
  if (!companyId || !STAGES.includes(stage)) return;
  const c = await Company.findById(companyId);
  if (c && STAGE_RANK[stage] > STAGE_RANK[c.stage]) {
    c.stage = stage;
    await c.save();
  }
}

/** Find a company by name or create it. Fills empty details; moves the stage forward, never back. */
export async function upsertCompany(name, data = {}) {
  const key = companyKey(name);
  if (!key) return null;
  let c = await Company.findOne({ key });
  if (!c) {
    try {
      return await Company.create({ ...data, name: String(name).trim().slice(0, 200), key, stage: STAGES.includes(data.stage) ? data.stage : 'cold' });
    } catch (e) {
      if (e?.code !== 11000) throw e;
      c = await Company.findOne({ key });
    }
  }
  for (const k of ['website', 'industry', 'location', 'linkedin', 'source']) if (!c[k] && data[k]) c[k] = data[k];
  if (data.owner && !c.owner) c.owner = data.owner;
  if (data.notes) c.notes = c.notes ? (c.notes.includes(data.notes) ? c.notes : `${c.notes}\n${data.notes}`) : data.notes;
  if (STAGES.includes(data.stage) && STAGE_RANK[data.stage] > STAGE_RANK[c.stage]) c.stage = data.stage;
  if (data.tasks?.length) c.tasks.push(...data.tasks.filter((t) => !c.tasks.some((x) => x.member === t.member && x.task === t.task)));
  if (data.fields?.length && !c.fields?.length) c.fields = data.fields;
  await c.save();
  return c;
}

// First email + follow-ups
export const Campaign = model(
  'Campaign',
  new Schema(
    {
      name: { type: String, required: true },
      subject: { type: String, default: '' },
      body: { type: String, default: '' },
      fromFile: { type: Boolean, default: false }, // every email comes from the uploaded file
      useContactContent: { type: Boolean, default: true },
      followUps: [{ _id: false, delayDays: { type: Number, min: 1, max: 60 }, body: String }],
      gapDays: { type: Number, min: 1, max: 30 }, // working days between follow-ups (empty = .env default)
      cc: { type: String, default: null }, // null = use the CC from Settings / .env
      status: { type: String, enum: ['draft', 'active', 'paused', 'completed'], default: 'draft' },
    },
    { timestamps: true }
  )
);

// One contact going through one campaign. step = emails already sent.
const enrollmentSchema = new Schema(
  {
    campaign: { type: id, ref: 'Campaign', required: true },
    contact: { type: id, ref: 'Contact', required: true },
    status: { type: String, enum: ['active', 'replied', 'completed', 'unsubscribed', 'bounced', 'failed', 'stopped'], default: 'active' },
    step: { type: Number, default: 0 },
    nextSendAt: { type: Date, default: () => new Date() },
    rootSubject: String,
    messageIds: [String],
    lastSentAt: Date,
    repliedAfterStep: Number,
    attempts: { type: Number, default: 0 },
    lastError: String,
  },
  { timestamps: true }
);
enrollmentSchema.index({ campaign: 1, contact: 1 }, { unique: true });
enrollmentSchema.index({ status: 1, nextSendAt: 1 });
export const Enrollment = model('Enrollment', enrollmentSchema);

// Every email sent
export const EmailLog = model(
  'EmailLog',
  new Schema({
    campaign: { type: id, ref: 'Campaign', index: true },
    contact: { type: id, ref: 'Contact', index: true },
    enrollment: { type: id, ref: 'Enrollment' },
    step: Number,
    subject: String,
    html: String, // what was written (incl. quoted earlier emails) - quoted again in the next follow-up
    text: String,
    messageId: { type: String, index: true },
    trackingId: { type: String, index: true },
    status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
    error: String,
    sentAt: { type: Date, default: () => new Date(), index: true },
    openedAt: Date,
    clickedAt: Date,
  })
);

// Replies found in the inbox
const replySchema = new Schema({
    contact: { type: id, ref: 'Contact' },
    campaign: { type: id, ref: 'Campaign' },
    afterStep: Number,
    from: String,
    subject: String,
    snippet: String,
    messageId: { type: String },
    isAutoReply: { type: Boolean, default: false },
    handled: { type: Boolean, default: false },
    receivedAt: { type: Date, default: () => new Date(), index: true },
});
// one email = one reply, even when two servers check the same inbox at the same time
replySchema.index({ messageId: 1 }, { unique: true, partialFilterExpression: { messageId: { $type: 'string' } } });
export const Reply = model('Reply', replySchema);

// Small key/value store (pause switch, IMAP position)
const Setting = model('Setting', new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed }));
export const getSetting = async (key, def = null) => (await Setting.findOne({ key }).lean())?.value ?? def;
export const setSetting = (key, value) => Setting.updateOne({ key }, { $set: { value } }, { upsert: true });

// Activity feed for the bell: every email sent, reply, unsubscribe, bounce, failure (kept 60 days)
const notificationSchema = new Schema({
  type: { type: String, enum: ['sent', 'replied', 'unsubscribed', 'bounced', 'failed'], required: true },
  contact: { type: id, ref: 'Contact' },
  campaign: { type: id, ref: 'Campaign' },
  name: String, // person's name or email at the time
  step: Number, // 1 = first email, 2 = follow-up 1 ...
  text: String, // subject / reply snippet / error
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date() },
});
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 86400 });
export const Notification = model('Notification', notificationSchema);
export const notify = (type, contact, extra = {}) =>
  Notification.create({ type, contact: contact?._id, name: contact?.name || contact?.email || '', ...extra }).catch(() => {});

// Permanent memory of emails - survives contact delete / re-import
export const Suppression = model(
  'Suppression',
  new Schema({ email: { type: String, unique: true, lowercase: true }, reason: String }, { timestamps: true })
);
const RANK = { new: 0, contacted: 1, replied: 2, bounced: 3, unsubscribed: 4 };
export const statusRank = (s) => RANK[s] ?? 0;
export async function remember(email, reason) {
  if (!email || !RANK[reason]) return;
  const old = await Suppression.findOne({ email }).lean();
  if (!old) await Suppression.create({ email, reason }).catch(() => {});
  else if (RANK[reason] > statusRank(old.reason)) await Suppression.updateOne({ email }, { $set: { reason } });
}
