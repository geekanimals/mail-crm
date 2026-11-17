// Shared helpers for the HR routes (admin side and employee side).
import { config } from './config.js';
import { Attendance, Holiday, Leave } from './hr-models.js';
import { dayOf, isDay, leaveBalance, monthRegister, workingDays } from './hr-calc.js';
import { fail, str } from './utils.js';

export const TZ = config.timezone || 'Asia/Kolkata';
export const today = () => dayOf(new Date(), TZ);

/** "2026-11-17" + "09:30" in the office time zone -> Date */
export function atTime(day, hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!isDay(day) || !m || +m[1] > 23 || +m[2] > 59) return null;
  const guess = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), +m[1], +m[2]);
  // how far the office clock is from UTC at that moment
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(guess))
      .map((x) => [x.type, x.value])
  );
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (shown - guess));
}

/** a time sent as "HH:MM" (or empty = keep / clear) */
export function timeField(day, v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = atTime(day, str(v, 5));
  if (!d) throw fail(400, 'Time must look like 09:30');
  return d;
}

export async function holidayMap(from, to) {
  const list = await Holiday.find({ day: { $gte: from, $lte: to } }).lean();
  return new Map(list.map((h) => [h.day, h.name]));
}

/** a month of attendance for one employee */
export async function registerFor(user, month) {
  const from = `${month}-01`;
  const to = `${month}-31`;
  const [rows, leaves, holidays] = await Promise.all([
    Attendance.find({ user: user._id, day: { $gte: from, $lte: to } }).lean(),
    Leave.find({ user: user._id, status: 'approved', from: { $lte: to }, to: { $gte: from } }).lean(),
    holidayMap(from, to),
  ]);
  const attendance = Object.fromEntries(rows.map((a) => [a.day, a]));
  return monthRegister({ month, today: today(), joiningDate: user.employee?.joiningDate || '', attendance, leaves, holidays });
}

export async function balanceFor(user, year = +today().slice(0, 4)) {
  const leaves = await Leave.find({ user: user._id, from: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }).lean();
  return leaveBalance({ joiningDate: user.employee?.joiningDate || '', year, today: today(), leaves });
}

/** working days a leave asks for (Sundays and holidays are not counted) */
export async function leaveDays(from, to, half) {
  if (!isDay(from) || !isDay(to) || to < from) throw fail(400, 'Choose a valid from and to date');
  if (to > from && half) throw fail(400, 'A half day leave is for one day only');
  if (+to.slice(0, 4) !== +from.slice(0, 4)) throw fail(400, 'A leave cannot cross into the next year - split it in two');
  const days = workingDays(from, to, new Set((await holidayMap(from, to)).keys())).length;
  if (!days) throw fail(400, 'These dates are Sundays or holidays - no leave needed');
  return half ? 0.5 : days;
}

/** what an employee (or the admin about them) sees of a person */
export const publicEmployee = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  title: u.title,
  active: u.active,
  employee: u.employee || {},
});
