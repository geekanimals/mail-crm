// Login. Admin = ADMIN_USERNAME / ADMIN_PASSWORD from .env.
// Team members and clients get a login (email + password) created by the admin.
import crypto from 'node:crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { loginLimit } from '../limits.js';
import { config } from '../config.js';
import { User, checkPassword, hashPassword } from '../models.js';
import { bountyChangePassword, bountySignIn } from '../bounty.js';

const router = Router();
const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const sign = (payload) => jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpires });
const DUMMY = 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128);

router.post('/login', loginLimit, async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (same(username, config.adminUser) & same(password, config.adminPass)) {
      return res.json({ token: sign({ sub: config.adminUser, role: 'admin' }), user: config.adminUser, role: 'admin' });
    }
    const user = username.includes('@') ? await User.findOne({ email: username.toLowerCase() }) : null;
    let ok = checkPassword(password, user?.passwordHash || DUMMY); // always check, so timing gives nothing away
    // a client whose login is synced with Bounty may have changed the password there: accept it and keep both in step
    if (!ok && user?.active && user.role === 'client' && user.bountyMemberId && password && (await bountySignIn(user.email, password).catch(() => null))) {
      user.passwordHash = hashPassword(password);
      ok = true;
    }
    if (!user || !ok || !user.active) return res.status(401).json({ error: 'Invalid ID or password' });
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: sign({ sub: String(user._id), role: user.role }), user: user.name, role: user.role, mustChangePassword: Boolean(user.mustChangePassword) });
  } catch (e) {
    next(e);
  }
});

// Any logged-in person. Team / client tokens stop working the moment they are deleted or disabled.
export async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (p.sub === config.adminUser && (!p.role || p.role === 'admin')) {
      req.user = p.sub;
      req.role = 'admin';
      return next();
    }
    if (!['team', 'client'].includes(p.role)) throw new Error();
    const user = await User.findById(p.sub).lean();
    if (!user || !user.active || user.role !== p.role) throw new Error();
    req.user = user.name;
    req.role = user.role;
    req.account = user;
    next();
  } catch {
    res.status(401).json({ error: 'Please log in again' });
  }
}

// Only the admin (everything except the team / client portal)
export function requireAdmin(req, res, next) {
  if (req.role !== 'admin') return res.status(403).json({ error: 'Only the admin can do this' });
  next();
}

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user, role: req.role, email: req.account?.email, mustChangePassword: Boolean(req.account?.mustChangePassword) }));

// team members and clients change their own password (the admin password stays in .env)
router.post('/password', loginLimit.slice(0, 1), requireAuth, async (req, res, next) => {
  try {
    if (req.role === 'admin') return res.status(400).json({ error: 'The admin password is set on the server (.env)' });
    const user = await User.findById(req.account._id);
    if (!checkPassword(String(req.body?.current || ''), user.passwordHash)) return res.status(400).json({ error: 'Current password is wrong' });
    const pw = String(req.body?.password || '');
    if (pw.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    if (pw === String(req.body?.current || '')) return res.status(400).json({ error: 'Choose a password different from the current one' });
    // the same login on Bounty changes too (clients only)
    const bounty = user.role === 'client' && user.bountyMemberId ? await bountyChangePassword(user.email, String(req.body?.current || ''), pw).catch(() => false) : null;
    user.passwordHash = hashPassword(pw);
    user.mustChangePassword = false;
    await user.save();
    res.json({ ok: true, bounty });
  } catch (e) {
    next(e);
  }
});

export default router;
