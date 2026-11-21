// Number and date formatting helpers (Indian style: K, L, Cr)
import { metricOf } from "./constants";

export function fmt(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + " Cr";
  if (abs >= 1e5) return (v / 1e5).toFixed(2) + " L";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return String(Math.round(v * 100) / 100);
}

export function fmtFull(n) {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// Short value for a metric ($ for money)
export function fmtValue(key, n) {
  return metricOf(key)?.money ? "$" + (Number(n) || 0).toFixed(2) : fmt(n);
}

export function fmtMetric(key, n) {
  return metricOf(key)?.money ? "$" + fmtFull(n) : fmtFull(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-11-16" -> "16 Nov 2026", "2026-11" -> "Nov 2026"
export function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!d) return MONTHS[Number(m) - 1] + " " + y;
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// "2026-11-16" -> "16 Nov"
export function fmtShort(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  if (!d) return MONTHS[Number(m) - 1];
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

// "9 – 15 Nov 2026"
export function fmtRange(start, end) {
  if (!start) return "";
  if (!end || end === start) return fmtDate(start);
  const [y1, m1] = start.split("-");
  const [y2, m2] = end.split("-");
  if (y1 === y2 && m1 === m2) return `${Number(start.slice(8))} – ${fmtDate(end)}`;
  if (y1 === y2) return `${fmtShort(start)} – ${fmtDate(end)}`;
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function fmtPct(p) {
  if (p === null || p === undefined) return "New";
  return (p > 0 ? "+" : "") + p.toFixed(1) + "%";
}
