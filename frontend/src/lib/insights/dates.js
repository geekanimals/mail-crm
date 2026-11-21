// Date helpers. All dates are "YYYY-MM-DD" strings in local time.

const pad = (n) => String(n).padStart(2, "0");

export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromISO = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function daysBetween(start, end) {
  return Math.round((fromISO(end) - fromISO(start)) / 86400000) + 1;
}

// Today as "YYYY-MM-DD" (call only in the browser)
export const todayISO = () => toISO(new Date());

// Quick date-range buttons, based on today's date ("YYYY-MM-DD")
export function presets(t) {
  if (!t) return [];
  const today = fromISO(t);
  const monday = addDays(t, -((today.getDay() + 6) % 7));
  const firstThis = toISO(new Date(today.getFullYear(), today.getMonth(), 1));
  const firstLast = toISO(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  return [
    { label: "Last week", start: addDays(monday, -7), end: addDays(monday, -1) },
    { label: "This week", start: monday, end: t },
    { label: "Last 7 days", start: addDays(t, -6), end: t },
    { label: "Last 14 days", start: addDays(t, -13), end: t },
    { label: "This month", start: firstThis, end: t },
    { label: "Last month", start: firstLast, end: addDays(firstThis, -1) },
  ];
}

// Pulls a "YYYY-MM-DD" out of cells like "2026-11-01T00:00:00" or "Nov 1, 2026"
export function cellDate(cell) {
  const s = String(cell || "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (!/[a-z]{3}/i.test(s) || !/\d{4}/.test(s)) return null;
  const d = new Date(s);
  return isNaN(d) ? null : toISO(d);
}
