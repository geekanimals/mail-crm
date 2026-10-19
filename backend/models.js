// All MongoDB models in one place.
import crypto from 'node:crypto';
import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const id = Schema.Types.ObjectId;
mongoose.set('strictQuery', true);

// A person you can email
export const Contact = model(
  'Contact',
  new Schema(
    {
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      name: { type: String, default: '' },
      company: { type: String, default: '' },
      phone: { type: String, default: '' },
      location: { type: String, default: '' },
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
  )
);

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
export const Reply = model(
  'Reply',
  new Schema({
    contact: { type: id, ref: 'Contact' },
    campaign: { type: id, ref: 'Campaign' },
    afterStep: Number,
    from: String,
    subject: String,
    snippet: String,
    messageId: { type: String, index: true },
    isAutoReply: { type: Boolean, default: false },
    handled: { type: Boolean, default: false },
    receivedAt: { type: Date, default: () => new Date(), index: true },
  })
);

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
