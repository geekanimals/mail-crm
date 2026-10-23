// Rate limiting - how many requests one IP can make. All numbers come from .env (see config.js).
import rateLimit from 'express-rate-limit';
import { config } from './config.js';

const limiter = (windowMs, limit, message, extra = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // tells the browser when it can try again
    legacyHeaders: false,
    message: { error: message },
    ...extra,
  });

const r = config.rate;

// wrong ID/password: blocked for 15 min after too many tries (correct logins don't count).
// Counted per login ID + IP, so one person's typos never lock out the rest of an office on the same network;
// a wider per-IP cap still stops someone guessing many different IDs.
const perId = limiter(15 * 60000, r.loginAttempts, 'Too many wrong attempts. Try again in 15 minutes.', {
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.username || '').trim().toLowerCase().slice(0, 254)}`,
});
const perIp = limiter(15 * 60000, r.loginAttempts * 6, 'Too many wrong attempts from this network. Try again in 15 minutes.', { skipSuccessfulRequests: true });
export const loginLimit = [perIp, perId];

// every API call from the app
export const apiLimit = limiter(60000, r.apiPerMinute, 'Too many requests. Please wait a minute.');

// heavy work: file uploads, run send queue, inbox check, SMTP test
export const heavyLimit = limiter(60000, r.heavyPerMinute, 'Too many uploads / actions. Please wait a minute.');

// test emails (each one is a real email)
export const testEmailLimit = limiter(10 * 60000, r.testEmailsPer10Min, 'Too many test emails. Try again in 10 minutes.');

// public links inside emails (unsubscribe page, open pixel, click tracking)
export const publicLimit = limiter(60000, r.publicPerMinute, 'Too many requests.');
