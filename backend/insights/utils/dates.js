// Date helpers. All dates are stored as "YYYY-MM-DD" strings.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Reads the date formats seen in the export files:
// "2026-11-01", "2026-11-01T00:00:00", "11/18/2026", "11/18/2026 4:33", "9-Nov-26", "16 Nov 2026", "Nov 1, 2026"
// Excel serial numbers (e.g. 46327) are also supported.
export function toISODate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !isNaN(value)) return iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const d = new Date(Math.round((value - 25569) * 86400000));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(value).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, m[1], m[2]); // US style MM/DD/YYYY (Meta, LinkedIn exports)
  }
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s,]+(\d{2,4})/))) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return iso(y, mo, m[1]);
  }
  if ((m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/))) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return iso(m[3], mo, m[2]);
  }
  return null;
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export const isISODate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// true when no range is given, or the date is inside it
export function inRange(date, range) {
  if (!date || !range?.start || !range?.end) return true;
  return date >= range.start && date <= range.end;
}

// Days in a range, counting both ends (2026-11-09 → 2026-11-15 = 7)
export function rangeDays(start, end) {
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000) + 1;
}

// Full Monday–Sunday weeks inside a range, plus the leftover part-week days at the edges
export function fullWeeks(start, end) {
  const weeks = [];
  const day = new Date(start + "T00:00:00Z").getUTCDay(); // 0 = Sunday
  let monday = addDays(start, (8 - day) % 7); // first Monday on or after start
  while (addDays(monday, 6) <= end) {
    weeks.push({ start: monday, end: addDays(monday, 6) });
    monday = addDays(monday, 7);
  }
  const skipped = [];
  if (!weeks.length) skipped.push({ start, end });
  else {
    if (weeks[0].start > start) skipped.push({ start, end: addDays(weeks[0].start, -1) });
    if (weeks.at(-1).end < end) skipped.push({ start: addDays(weeks.at(-1).end, 1), end });
  }
  return { weeks, skipped };
}
