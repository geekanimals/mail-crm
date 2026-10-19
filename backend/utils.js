import mongoose from 'mongoose';

// wrap async routes so errors go to the error handler
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const fail = (status, message) => Object.assign(new Error(message), { status });

// always a plain string (blocks {$ne: ...} style injection)
export const str = (v, max = 10000) => (v == null || typeof v === 'object' ? '' : String(v).trim().slice(0, max));

export const validEmail = (v) => {
  const e = str(v, 254).toLowerCase();
  return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(e) ? e : null;
};

export const checkId = (v) => {
  if (!mongoose.isValidObjectId(v)) throw fail(400, 'Invalid id');
  return String(v);
};

export const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
