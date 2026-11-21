// Small helpers shared by all parsers
import { toNumber } from "../utils/numbers.js";
import { inRange, toISODate } from "../utils/dates.js";

const norm = (v) => String(v ?? "").trim().toLowerCase();

// Index of the first row that satisfies the test, or -1
export function findRow(rows, test, limit = 15) {
  return rows.slice(0, limit).findIndex((r) => test(r.map(norm)));
}

// Column index for the first pattern that matches a header cell (patterns in priority order)
export function findCol(header, ...patterns) {
  const h = header.map(norm);
  for (const p of patterns) {
    const i = h.findIndex((c) => (p instanceof RegExp ? p.test(c) : c === p));
    if (i >= 0) return i;
  }
  return -1;
}

export const hasCols = (header, ...names) => names.every((n) => findCol(header, n) >= 0);

// Sum one column over rows (skips when column is missing)
export function sumCol(rows, col) {
  if (col < 0) return undefined;
  return rows.reduce((s, r) => s + toNumber(r[col]), 0);
}

// Some exports repeat a column name (e.g. "3-Second viewers" and "3-second viewers").
// Sum every column with that name and keep the one with the most data.
export function sumBest(rows, header, name) {
  const cols = header.map((c, i) => (norm(c) === name ? i : -1)).filter((i) => i >= 0);
  if (!cols.length) return undefined;
  return Math.max(...cols.map((c) => sumCol(rows, c)));
}

// Keep rows whose date column is inside the range; also return every date seen
export function rowsInRange(rows, dateCol, range) {
  const dates = [];
  const kept = rows.filter((r) => {
    const d = toISODate(r[dateCol]);
    if (!d) return false;
    dates.push(d);
    return inRange(d, range);
  });
  return { kept, dates };
}

// Build a values object, dropping undefined entries
export function values(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && !isNaN(v)));
}

// Count unique ids (posts / videos) whose publish date is inside the range
export function countPublished(rows, idCol, publishCol, range) {
  const ids = new Set();
  rows.forEach((r, i) => {
    const d = toISODate(r[publishCol]);
    if (d && inRange(d, range)) ids.add(idCol >= 0 ? r[idCol] : i);
  });
  return ids.size;
}
