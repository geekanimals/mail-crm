// Login with ADMIN_USERNAME / ADMIN_PASSWORD from .env
import crypto from 'node:crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { loginLimit } from '../limits.js';
import { config } from '../config.js';

const router = Router();
const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

router.post(
  '/login',
  loginLimit,
  (req, res) => {
    const { username = '', password = '' } = req.body || {};
    const ok = same(username, config.adminUser) & same(password, config.adminPass); // check both, always
    if (!ok) return res.status(401).json({ error: 'Invalid ID or password' });
    const token = jwt.sign({ sub: config.adminUser }, config.jwtSecret, { expiresIn: config.jwtExpires });
    res.json({ token, user: config.adminUser });
  }
);

// Protects every other /api route
export function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (p.sub !== config.adminUser) throw new Error();
    req.user = p.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Please log in again' });
  }
}

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
