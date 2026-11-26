// Geek CRM backend - start with: npm run dev   (port from .env, default 5001)
import express from 'express';

// one failed background job (mail server timeout etc.) is logged, never takes the whole API down
process.on('unhandledRejection', (e) => console.warn('[warn] unhandled:', e?.code || e?.message || e));
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { apiLimit, heavyLimit, publicLimit, testEmailLimit, websiteLeadLimit } from './limits.js';
import { config, checkConfig } from './config.js';
import { startWorker } from './worker.js';
import authRoutes, { requireAdmin, requireAuth } from './routes/auth.js';
import teamRoutes from './routes/team.js';
import portalRoutes from './routes/portal.js';
import contactRoutes from './routes/contacts.js';
import campaignRoutes from './routes/campaigns.js';
import dashboardRoutes from './routes/dashboard.js';
import publicRoutes from './routes/public.js';
import companyRoutes from './routes/companies.js';
import hrRoutes from './routes/hr.js';
import meRoutes from './routes/me.js';
import fileRoutes from './routes/files.js';
import dealRoutes from './routes/deals.js';
import ideaRoutes from './routes/ideas.js';
import newsletterRoutes from './routes/newsletter.js';
import { admin as websiteLeadRoutes, hook as websiteLeadHook } from './routes/website-leads.js';
import insightsRoutes, { ensureDefaultAccounts } from './insights/index.js';
import { Company, Contact, Notification, Reply, getSetting, setSetting } from './models.js';
import { syncPipeline } from './worker.js';

checkConfig();

const app = express();
app.set('trust proxy', config.trustProxy);
app.set('query parser', 'simple'); // query values are always plain strings
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // tracking pixel is loaded by email apps
    contentSecurityPolicy: config.isProd ? undefined : { directives: { upgradeInsecureRequests: null } },
  })
);

// email links (unsubscribe / tracking) - public
app.use(['/u', '/t'], publicLimit);
app.use(publicRoutes);
app.get('/health', (_req, res) => res.json({ ok: true }));

// API - only the frontend URL from .env may call it
app.use(
  '/api',
  cors({ origin: (o, cb) => cb(null, !o || config.frontendUrls.includes(o.replace(/\/$/, ''))) }),
  apiLimit,
  express.json({ limit: '15mb' })
);
// strip "$" keys from request bodies (NoSQL injection guard)
const clean = (o) => {
  if (o && typeof o === 'object') for (const k of Object.keys(o)) k.startsWith('$') || k.includes('.') ? delete o[k] : clean(o[k]);
};
app.use('/api', (req, _res, next) => (clean(req.body), next()));

// stricter limits for heavy / email-sending actions
const heavyWrites = (req, res, next) => (req.method === 'GET' ? next() : heavyLimit(req, res, next)); // checking progress is not limited
app.use(['/api/files', '/api/contacts/import', '/api/contacts/import-continue', '/api/companies/import/google', '/api/settings/run', '/api/settings/test-smtp', '/api/replies/check', '/api/campaigns/:id/start', '/api/insights/uploads'], heavyWrites);
app.use('/api/settings/test-email', testEmailLimit);

app.use('/api/public/website-lead', websiteLeadLimit, websiteLeadHook); // the website's client form (shared secret, no login)
app.use('/api/auth', authRoutes);
app.use('/api/portal', requireAuth, portalRoutes); // team members + clients
app.use('/api/me', requireAuth, meRoutes); // employee portal (team members)
app.use('/api/files', requireAuth, fileRoutes); // HR files: the admin, or the employee they belong to
app.use('/api/ideas', requireAuth, ideaRoutes); // Idea Bucket: every login (who sees what is checked inside)
app.use('/api/deals', requireAuth, dealRoutes); // client work after an account: admin + the employees on it
app.use('/api/insights', requireAuth, insightsRoutes); // Insights Dashboard: admin + Insights logins (checked inside)
const admin = [requireAuth, requireAdmin]; // everything else: admin only
app.use('/api/contacts', ...admin, contactRoutes);
app.use('/api/campaigns', ...admin, campaignRoutes);
app.use('/api/companies', ...admin, companyRoutes);
app.use('/api/team', ...admin, teamRoutes);
app.use('/api/hr', ...admin, hrRoutes);
app.use('/api/newsletter', ...admin, newsletterRoutes);
app.use('/api/website-leads', requireAuth, websiteLeadRoutes); // admin: every form; an employee: the forms given to them (checked inside)
app.use('/api', ...admin, dashboardRoutes);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let status = err.status || (err.name === 'ValidationError' || err.name === 'CastError' ? 400 : err.code === 11000 ? 409 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && config.isProd ? 'Server error' : err.message, ...(status < 500 && err.extra ? err.extra : {}) });
});

// database fixes (safe to run every start). Each step runs on its own, so one problem never blocks the rest.
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    console.error(`[db] ${name}:`, e.message);
  }
  console.log(`[startup] ${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s`); // how long each start-up step takes
}
async function dropOldIndex(model, name, wantKey) {
  const idx = await model.collection.indexes();
  const old = idx.find((i) => i.name === name && !i[wantKey]);
  if (old) await model.collection.dropIndex(name);
}

async function migrate() {
  // the follow-up gap set in Settings wins over DEFAULT_FOLLOWUP_INTERVAL_DAYS in .env
  await step('settings', async () => {
    const days = await getSetting('intervalDays', null);
    if (Number.isInteger(days) && days >= 1 && days <= 30) config.intervalDays = days;
    const ps = await getSetting('pendingStartHour', null);
    if (Number.isInteger(ps) && ps >= config.windowStart && ps < config.windowEnd) config.pendingStart = ps;
  });
  // email became optional: the unique index must allow people without an email
  await step('contact indexes', async () => {
    await dropOldIndex(Contact, 'email_1', 'partialFilterExpression');
    await Contact.createIndexes();
  });
  await step('company indexes', () => Company.createIndexes());
  await step('insights companies', ensureDefaultAccounts); // first run: the default Insights companies

  // the same reply saved twice (two servers checked the inbox at once): keep the first one, then make it impossible
  await step('duplicate replies', async () => {
    const dups = await Reply.aggregate([
      { $match: { messageId: { $type: 'string' } } },
      { $group: { _id: '$messageId', ids: { $push: '$_id' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]);
    const extra = dups.flatMap((d) => d.ids.slice(1));
    if (extra.length) {
      await Reply.deleteMany({ _id: { $in: extra } });
      console.log(`[db] removed ${extra.length} duplicate repl${extra.length > 1 ? 'ies' : 'y'}`);
    }
    await dropOldIndex(Reply, 'messageId_1', 'unique');
    await Reply.createIndexes();
  });

  // once: test records left from 22 Oct testing
  await step('test cleanup', async () => {
    if (await getSetting('cleanup_test_2026_10_22', false)) return;
    const live = await Contact.distinct('_id');
    await Reply.deleteMany({ contact: { $nin: live }, snippet: 'Marked as replied manually' });
    await Notification.deleteMany({ name: { $in: ['ZZ Person A', 'ZZ Person B', 'Test Person One', 'Test Person Two', 'Demo Member'] } });
    await setSetting('cleanup_test_2026_10_22', true);
  });

  // companies whose people replied earlier move to Hot lead / Opportunity
  await step('pipeline sync', async () => {
    const moved = await syncPipeline();
    if (moved) console.log(`[pipeline] ${moved} compan${moved > 1 ? 'ies' : 'y'} moved forward from earlier replies`);
  });
}

mongoose
  .connect(config.mongoUri)
  .then(async () => {
    console.log('[db] MongoDB connected');
    // open for requests at once; the database fixes below run in the background (each is safe to run any time)
    app.listen(config.port, () => console.log(`[server] Geek CRM API on http://localhost:${config.port}`));
    const t0 = Date.now();
    await migrate();
    console.log(`[startup] all steps: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    startWorker(); // sending / inbox start after the fixes, as before
  })
  .catch((e) => {
    console.error('[db] connection failed:', e.message);
    process.exit(1);
  });
