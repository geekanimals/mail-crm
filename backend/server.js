// Geek CRM backend - start with: npm run dev   (port from .env, default 5001)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { apiLimit, heavyLimit, publicLimit, testEmailLimit } from './limits.js';
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
app.use(['/api/contacts/import', '/api/contacts/import-continue', '/api/companies/import/google', '/api/settings/run', '/api/settings/test-smtp', '/api/replies/check', '/api/campaigns/:id/start'], heavyWrites);
app.use('/api/settings/test-email', testEmailLimit);

app.use('/api/auth', authRoutes);
app.use('/api/portal', requireAuth, portalRoutes); // team members + clients
const admin = [requireAuth, requireAdmin]; // everything else: admin only
app.use('/api/contacts', ...admin, contactRoutes);
app.use('/api/campaigns', ...admin, campaignRoutes);
app.use('/api/companies', ...admin, companyRoutes);
app.use('/api/team', ...admin, teamRoutes);
app.use('/api', ...admin, dashboardRoutes);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let status = err.status || (err.name === 'ValidationError' || err.name === 'CastError' ? 400 : err.code === 11000 ? 409 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && config.isProd ? 'Server error' : err.message });
});

// database fixes (safe to run every start). Each step runs on its own, so one problem never blocks the rest.
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`[db] ${name}:`, e.message);
  }
}
async function dropOldIndex(model, name, wantKey) {
  const idx = await model.collection.indexes();
  const old = idx.find((i) => i.name === name && !i[wantKey]);
  if (old) await model.collection.dropIndex(name);
}

async function migrate() {
  // email became optional: the unique index must allow people without an email
  await step('contact indexes', async () => {
    await dropOldIndex(Contact, 'email_1', 'partialFilterExpression');
    await Contact.createIndexes();
  });
  await step('company indexes', () => Company.createIndexes());

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
    await migrate();
    app.listen(config.port, () => console.log(`[server] Geek CRM API on http://localhost:${config.port}`));
    startWorker();
  })
  .catch((e) => {
    console.error('[db] connection failed:', e.message);
    process.exit(1);
  });
