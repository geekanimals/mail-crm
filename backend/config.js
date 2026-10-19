// All settings come from .env - nothing is hard-coded.
import 'dotenv/config';

const str = (k, d = '') => (process.env[k] ?? '').trim() || d;
const num = (k, d) => (process.env[k] && !isNaN(Number(process.env[k])) ? Number(process.env[k]) : d);
const bool = (k, d) => (process.env[k] ? ['1', 'true', 'yes'].includes(process.env[k].toLowerCase()) : d);

export const config = {
  port: num('PORT', 5001),
  isProd: str('NODE_ENV') === 'production',
  frontendUrls: str('FRONTEND_URL', 'http://localhost:3000').split(',').map((s) => s.trim().replace(/\/$/, '')),
  publicUrl: str('PUBLIC_BACKEND_URL', 'http://localhost:5001').replace(/\/$/, ''),
  trustProxy: num('TRUST_PROXY', 0),
  mongoUri: str('MONGODB_URI'),

  // Admin login (only this ID/password can log in)
  adminUser: str('ADMIN_USERNAME'),
  adminPass: process.env.ADMIN_PASSWORD || '',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpires: str('JWT_EXPIRES_IN', '12h'),

  smtp: { host: str('SMTP_HOST'), port: num('SMTP_PORT', 465), secure: bool('SMTP_SECURE', true), user: str('SMTP_USER'), pass: str('SMTP_PASS') },
  fromName: str('MAIL_FROM_NAME', 'Geek'),
  fromEmail: str('MAIL_FROM_EMAIL', str('SMTP_USER')),
  replyTo: str('MAIL_REPLY_TO'),
  publicLinks: !/localhost|127\.0\.0\.1/.test(str('PUBLIC_BACKEND_URL', 'http://localhost')), // can people outside open our links?
  cc: str('MAIL_CC'), // comma separated - CC on every email (can be changed in the frontend too)

  imap: {
    host: str('IMAP_HOST'),
    port: num('IMAP_PORT', 993),
    secure: bool('IMAP_SECURE', true),
    user: str('IMAP_USER', str('SMTP_USER')),
    pass: str('IMAP_PASS', str('SMTP_PASS')),
    mailbox: str('IMAP_MAILBOX', 'INBOX'),
  },
  replyCheckMinutes: Math.min(59, Math.max(1, num('REPLY_CHECK_INTERVAL_MINUTES', 5))),

  intervalDays: Math.max(1, num('DEFAULT_FOLLOWUP_INTERVAL_DAYS', 3)), // working days between follow-ups (default 3)
  sequenceDays: Math.max(0, num('DEFAULT_SEQUENCE_DAYS', 10)),
  dailyLimit: Math.max(1, num('DAILY_SEND_LIMIT', 100)),
  hourlyLimit: Math.max(1, num('HOURLY_SEND_LIMIT', 30)), // max emails per hour (spread out = less spam)

  // Rate limiting (requests per IP)
  rate: {
    loginAttempts: Math.max(1, num('RATE_LOGIN_ATTEMPTS', 5)), // wrong logins per 15 min
    apiPerMinute: Math.max(10, num('RATE_API_PER_MINUTE', 300)), // normal app usage
    heavyPerMinute: Math.max(1, num('RATE_HEAVY_PER_MINUTE', 20)), // uploads, run queue, inbox check
    testEmailsPer10Min: Math.max(1, num('RATE_TEST_EMAILS_PER_10_MIN', 5)),
    publicPerMinute: Math.max(5, num('RATE_PUBLIC_PER_MINUTE', 60)), // unsubscribe / tracking links
  },
  sendDelaySec: Math.max(0, num('SEND_DELAY_SECONDS', 25)),
  windowStart: num('SEND_WINDOW_START', 9),
  windowEnd: num('SEND_WINDOW_END', 19),
  timezone: str('TIMEZONE', 'Asia/Kolkata'),
  skipWeekends: bool('SKIP_WEEKENDS', true), // Sat/Sun off: nothing is sent, follow-up gaps count working days only
  // tracking only works when PUBLIC_BACKEND_URL is a real public address (not localhost)
  trackOpens: bool('TRACK_OPENS', true) && !/localhost|127\.0\.0\.1/.test(str('PUBLIC_BACKEND_URL', 'http://localhost')),
  trackClicks: bool('TRACK_CLICKS', true) && !/localhost|127\.0\.0\.1/.test(str('PUBLIC_BACKEND_URL', 'http://localhost')),
  footer: str('COMPANY_FOOTER'),
};

export const smtpReady = () => Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
export const imapReady = () => Boolean(config.imap.host && config.imap.user && config.imap.pass);

export function checkConfig() {
  const errors = [];
  if (!config.mongoUri) errors.push('MONGODB_URI is required');
  if (!config.adminUser) errors.push('ADMIN_USERNAME is required');
  if (config.adminPass.length < 8 || config.adminPass === 'change-this-password') errors.push('ADMIN_PASSWORD must be 8+ characters and not the example value');
  if (config.jwtSecret.length < 32 || config.jwtSecret.startsWith('replace-with')) errors.push('JWT_SECRET must be a random string of 32+ characters');
  if (errors.length) {
    console.error('\n[config] Fix your .env:\n  - ' + errors.join('\n  - ') + '\n');
    process.exit(1);
  }
  if (!smtpReady()) console.warn('[config] SMTP not set - emails will not be sent.');
  if (!imapReady()) console.warn('[config] IMAP not set - replies will not be detected.');
}
