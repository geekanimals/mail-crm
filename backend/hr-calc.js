// HR rules in one place (no database here, so they are easy to check).
//  - Sunday is the weekly off. Holidays come from the holiday list.
//  - Present = checked in that day (hours are flexible).
//  - A past working day with no check-in and no approved leave = absent (unpaid).
//  - Paid leave: 0.5 day for every month from the joining date (or 1 January), lapses on 31 December.
//    Leave beyond the balance is unpaid.
//  - Salary per day = monthly gross / days in the month. Unpaid days are cut from the gross.

export const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of a moment in the office time zone */
export function dayOf(d = new Date(), tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}
export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(`${s}T00:00:00Z`));
export const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));

const toUtc = (day) => new Date(`${day}T00:00:00Z`);
export const addDays = (day, n) => new Date(toUtc(day).getTime() + n * 86400000).toISOString().slice(0, 10);
export const isSunday = (day) => toUtc(day).getUTCDay() === 0;
export const daysInMonth = (month) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
export const monthDays = (month) => Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${pad(i + 1)}`);

/** every day from..to (inclusive), at most 366 */
export function range(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 366; d = addDays(d, 1)) out.push(d);
  return out;
}

/** working days between two days (Sundays and holidays left out) */
export const workingDays = (from, to, holidays = new Set()) => range(from, to).filter((d) => !isSunday(d) && !holidays.has(d));

/** Monday of the week a day falls in */
export function weekOf(day) {
  const dow = toUtc(day).getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

/** paid leave earned in `year` up to (and including) the month of `upto`: 0.5 per month */
export function leaveEarned(joiningDate, year, upto) {
  const start = isDay(joiningDate) && joiningDate > `${year}-01-01` ? joiningDate : `${year}-01-01`;
  const end = upto.slice(0, 4) > String(year) ? `${year}-12-31` : upto;
  if (start.slice(0, 4) !== String(year) || end < start) return 0;
  const months = (+end.slice(0, 4) - +start.slice(0, 4)) * 12 + (+end.slice(5, 7) - +start.slice(5, 7)) + 1;
  return months * 0.5;
}

/** leave position for a year: earned, used (approved paid days), pending (days asked, not decided), available */
export function leaveBalance({ joiningDate, year, today, leaves = [] }) {
  const earned = leaveEarned(joiningDate, year, today);
  const inYear = leaves.filter((l) => l.from.slice(0, 4) === String(year));
  const used = inYear.filter((l) => l.status === 'approved').reduce((n, l) => n + (l.paidDays || 0), 0);
  const unpaid = inYear.filter((l) => l.status === 'approved').reduce((n, l) => n + (l.unpaidDays || 0), 0);
  const pending = inYear.filter((l) => l.status === 'pending').reduce((n, l) => n + (l.days || 0), 0);
  return { year, earned, used, unpaid, pending, available: Math.max(0, earned - used) };
}

/** on approval: as many days as the balance allows are paid, the rest unpaid */
export function splitLeave(days, available) {
  const paid = Math.min(days, Math.max(0, Math.floor(available * 2) / 2));
  return { paidDays: paid, unpaidDays: Math.round((days - paid) * 2) / 2 };
}

/**
 * What each day of a month was for one employee.
 * attendance: { day: { checkIn, checkOut, request } }, leaves: approved leaves, holidays: Map(day -> name)
 * status: before-join | off | holiday | present | leave | half-leave | absent | today | future
 */
export function monthRegister({ month, today, joiningDate = '', attendance = {}, leaves = [], holidays = new Map() }) {
  const leaveOf = {};
  for (const l of leaves) {
    if (l.status !== 'approved') continue;
    // unpaid days are the last days of the leave
    const days = workingDays(l.from, l.to, new Set(holidays.keys()));
    const unpaidCount = Math.ceil(l.unpaidDays || 0);
    days.forEach((d, i) => { leaveOf[d] = { half: l.half, paid: days.length - i > unpaidCount, leaveId: l._id }; });
  }
  const sum = { present: 0, paidLeave: 0, unpaidLeave: 0, absent: 0, holidays: 0, sundays: 0, workingDays: 0, beforeJoin: 0, pendingFix: 0 };
  const days = monthDays(month).map((day) => {
    const a = attendance[day];
    const l = leaveOf[day];
    const row = { day, checkIn: a?.checkIn || null, checkOut: a?.checkOut || null, request: a?.request?.status === 'pending' ? a.request : null, note: a?.note || '' };
    if (row.request) sum.pendingFix++;
    if (isDay(joiningDate) && day < joiningDate) { sum.beforeJoin++; return { ...row, status: 'before-join' }; }
    if (isSunday(day)) { sum.sundays++; return { ...row, status: a?.checkIn ? 'present' : 'off', extra: true }; }
    if (holidays.has(day)) { sum.holidays++; return { ...row, status: a?.checkIn ? 'present' : 'holiday', holiday: holidays.get(day), extra: true }; }
    sum.workingDays++;
    if (a?.checkIn) {
      sum.present++;
      if (l?.half) sum[l.paid ? 'paidLeave' : 'unpaidLeave'] += 0.5;
      return { ...row, status: 'present', leave: l || null };
    }
    if (l) {
      if (l.half) {
        sum[l.paid ? 'paidLeave' : 'unpaidLeave'] += 0.5;
        if (day < today) sum.absent += 0.5;
        return { ...row, status: 'half-leave', leave: l };
      }
      sum[l.paid ? 'paidLeave' : 'unpaidLeave']++;
      return { ...row, status: 'leave', leave: l };
    }
    if (day < today) { sum.absent++; return { ...row, status: 'absent' }; }
    return { ...row, status: day === today ? 'today' : 'future' };
  });
  return { month, days, summary: sum };
}

const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => Math.round(Number(n) || 0);

/** salary for a month from the register summary */
export function payroll({ month, summary, salary = {} }) {
  const dim = daysInMonth(month);
  const basic = money(salary.basic), hra = money(salary.hra), allowances = money(salary.allowances);
  const gross = basic + hra + allowances;
  const unpaidDays = r2(summary.absent + summary.unpaidLeave + summary.beforeJoin);
  const paidDays = r2(Math.max(0, dim - unpaidDays));
  const lossOfPay = money((gross / dim) * unpaidDays);
  const pt = money(salary.pt), tds = money(salary.tds), otherDeductions = money(salary.otherDeductions);
  const totalDeductions = lossOfPay + pt + tds + otherDeductions;
  return {
    month, daysInMonth: dim, workingDays: summary.workingDays, present: summary.present, paidLeave: summary.paidLeave,
    paidDays, unpaidDays, basic, hra, allowances, gross, lossOfPay, pt, tds, otherDeductions, totalDeductions,
    net: Math.max(0, gross - totalDeductions),
  };
}
