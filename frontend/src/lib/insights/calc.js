// All dashboard calculations: filters, totals, % change, series, movers.
// A row = one account + one platform + one date range (start "week" → "end").
import { METRICS, METRIC_KEYS } from "./constants";

const zero = () => Object.fromEntries(METRIC_KEYS.map((k) => [k, 0]));

// Fill missing fields so old/partial rows never break the charts
export function normalize(r) {
  return { ...zero(), ...r, end: r.end || r.week };
}

export function filterRows(rows, { account = "All", platform = "All" } = {}) {
  return rows.filter(
    (r) => (account === "All" || r.account === account) && (platform === "All" || r.platform === platform)
  );
}

export function sum(rows) {
  const t = zero();
  rows.forEach((r) => METRIC_KEYS.forEach((k) => (t[k] += Number(r[k]) || 0)));
  return t;
}

// % change; null means "New" (previous was 0)
export function change(prev, cur) {
  if (!prev) return cur ? null : 0;
  return ((cur - prev) / prev) * 100;
}

// Engagement rate = (likes + comments + shares) / views
export function engagementRate(t) {
  return t.views ? ((t.likes + t.comments + t.shares) / t.views) * 100 : 0;
}

export function listWeeks(rows) {
  return [...new Set(rows.map((r) => r.week))].sort();
}

export function listMonths(rows) {
  return [...new Set(rows.map((r) => r.week.slice(0, 7)))].sort();
}

export function listPeriods(rows, mode) {
  return mode === "month" ? listMonths(rows) : listWeeks(rows);
}

// End date of a week period (for labels like "9 – 15 Nov")
export function endOf(rows, week) {
  return rows.find((r) => r.week === week)?.end || week;
}

// Totals for one week or one month.
// Month: normal metrics are added; snapshot metrics (followers) = each account+platform's
// latest entry in that month, added together.
export function periodTotals(rows, mode, key) {
  if (mode === "week") return sum(rows.filter((r) => r.week === key));
  const inMonth = rows.filter((r) => r.week.startsWith(key));
  const total = sum(inMonth);
  const latest = {};
  inMonth.forEach((r) => {
    const c = r.account + "|" + r.platform;
    if (!latest[c] || r.week > latest[c].week) latest[c] = r;
  });
  const last = sum(Object.values(latest));
  METRICS.filter((m) => m.snapshot).forEach((m) => (total[m.key] = last[m.key]));
  return total;
}

// Like-for-like comparison: keep only account + platform pairs that have data in the current period.
// Pairs with data last period but not yet this period are returned as "missing" (not uploaded yet),
// so they don't show as −100%.
export function likeForLike(rows, mode, prevKey, curKey) {
  const key = (r) => r.account + "|" + r.platform;
  const inPeriod = (r, k) => (mode === "week" ? r.week === k : r.week.startsWith(k));
  const cur = new Set(rows.filter((r) => inPeriod(r, curKey)).map(key));
  const missing = [...new Set(rows.filter((r) => inPeriod(r, prevKey)).map(key))]
    .filter((c) => !cur.has(c))
    .sort()
    .map((c) => c.replace("|", " · "));
  return { rows: rows.filter((r) => cur.has(key(r))), missing };
}

// Line chart data: one series per platform or account
export function groupSeries(rows, by, metric) {
  const labels = listWeeks(rows);
  const keys = [...new Set(rows.map((r) => r[by]))].sort();
  const series = keys.map((name) => ({
    name,
    values: labels.map((w) =>
      rows.filter((r) => r.week === w && r[by] === name).reduce((s, r) => s + (Number(r[metric]) || 0), 0)
    ),
  }));
  return { labels, series };
}

// Total of one metric for each week (for sparklines)
export function totalSeries(rows, metric) {
  return listWeeks(rows).map((w) => sum(rows.filter((r) => r.week === w))[metric]);
}

// Per account + platform comparison between two periods
export function comboChanges(rows, mode, prevKey, curKey) {
  const combos = [...new Set(rows.map((r) => r.account + "|" + r.platform))];
  return combos.map((c) => {
    const [account, platform] = c.split("|");
    const own = rows.filter((r) => r.account === account && r.platform === platform);
    return { account, platform, prev: periodTotals(own, mode, prevKey), cur: periodTotals(own, mode, curKey) };
  });
}

// Per account totals between two periods (leaderboard)
export function accountChanges(rows, mode, prevKey, curKey) {
  return [...new Set(rows.map((r) => r.account))].map((account) => {
    const own = rows.filter((r) => r.account === account);
    return { account, prev: periodTotals(own, mode, prevKey), cur: periodTotals(own, mode, curKey) };
  });
}

// Previous vs current totals for each platform or account (for comparison bars)
export function groupCompare(rows, by, mode, prevKey, curKey, metric) {
  return [...new Set(rows.map((r) => r[by]))]
    .map((name) => {
      const own = rows.filter((r) => r[by] === name);
      return { name, prev: periodTotals(own, mode, prevKey)[metric], cur: periodTotals(own, mode, curKey)[metric] };
    })
    .filter((x) => x.prev || x.cur)
    .sort((a, b) => b.cur - a.cur);
}

// Top gainers / losers by a metric (ignores tiny numbers to avoid noise)
export function movers(list, metric, minBase = 500) {
  const withPct = list
    .filter((x) => x.prev[metric] >= minBase || x.cur[metric] >= minBase || metric === "earnings")
    .map((x) => ({ ...x, pct: change(x.prev[metric], x.cur[metric]) }))
    .filter((x) => x.pct !== null);
  const sorted = [...withPct].sort((a, b) => b.pct - a.pct);
  return {
    gainers: sorted.filter((x) => x.pct > 0).slice(0, 5),
    losers: sorted.filter((x) => x.pct < 0).reverse().slice(0, 5),
  };
}

// Share of a metric by platform or account for one week
export function breakdown(rows, week, by, metric) {
  const map = {};
  rows.filter((r) => r.week === week).forEach((r) => (map[r[by]] = (map[r[by]] || 0) + (Number(r[metric]) || 0)));
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
}

// Rows -> CSV text (All Data → Export)
export function toCSV(rows) {
  const head = ["Start", "End", "Account", "Platform", ...METRICS.map((m) => m.full)];
  const lines = rows.map((r) => [r.week, r.end, r.account, r.platform, ...METRIC_KEYS.map((k) => r[k] ?? 0)]);
  return [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}
