// Geek CRM backend - start with: npm run dev   (port from .env, default 5001)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { apiLimit, heavyLimit, publicLimit, testEmailLimit } from './limits.js';
import { config, checkConfig } from './config.js';
import { startWorker } from './worker.js';
import authRoutes, { requireAuth } from './routes/auth.js';
import contactRoutes from './routes/contacts.js';
import campaignRoutes from './routes/campaigns.js';
import dashboardRoutes from './routes/dashboard.js';
import publicRoutes from './routes/public.js';

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
app.use(['/api/contacts/import', '/api/contacts/import-continue', '/api/settings/run', '/api/settings/test-smtp', '/api/replies/check', '/api/campaigns/:id/start'], heavyLimit);
app.use('/api/settings/test-email', testEmailLimit);

app.use('/api/auth', authRoutes);
app.use('/api/contacts', requireAuth, contactRoutes);
app.use('/api/campaigns', requireAuth, campaignRoutes);
app.use('/api', requireAuth, dashboardRoutes);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let status = err.status || (err.name === 'ValidationError' || err.name === 'CastError' ? 400 : err.code === 11000 ? 409 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && config.isProd ? 'Server error' : err.message });
});

mongoose
  .connect(config.mongoUri)
  .then(() => {
    console.log('[db] MongoDB connected');
    app.listen(config.port, () => console.log(`[server] Geek CRM API on http://localhost:${config.port}`));
    startWorker();
  })
  .catch((e) => {
    console.error('[db] connection failed:', e.message);
    process.exit(1);
  });
