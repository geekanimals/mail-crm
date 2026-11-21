// Entries -> CSV text
import { METRIC_KEYS } from "../constants/metrics.js";

const quote = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function entriesToCSV(entries) {
  const head = ["Start", "End", "Account", "Platform", ...METRIC_KEYS];
  const lines = entries.map((e) => [e.week, e.end, e.account, e.platform, ...METRIC_KEYS.map((k) => e[k] ?? 0)]);
  return [head, ...lines].map((l) => l.map(quote).join(",")).join("\n");
}
