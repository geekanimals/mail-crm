"use client";

import { useSyncExternalStore } from "react";
import { theme } from "@/lib/insights/constants";
import { daysBetween, presets, todayISO } from "@/lib/insights/dates";

const noop = () => () => {};

// Start + End date with quick preset buttons
export default function DateRange({ start, end, onChange, detected }) {
  const valid = start && end && end >= start;
  const today = useSyncExternalStore(noop, todayISO, () => ""); // browser only

  return (
    <div>
      <div style={s.row}>
        <label style={s.field}>
          <span style={s.label}>Start date</span>
          <input type="date" value={start} max={end || undefined} onChange={(e) => onChange({ start: e.target.value, end })} style={s.input} />
        </label>
        <span style={s.arrow}>→</span>
        <label style={s.field}>
          <span style={s.label}>End date</span>
          <input type="date" value={end} min={start || undefined} onChange={(e) => onChange({ start, end: e.target.value })} style={s.input} />
        </label>
        <div style={{ ...s.days, ...(valid ? {} : s.bad) }}>{valid ? `${daysBetween(start, end)} days` : "Check the dates"}</div>
      </div>

      <div style={s.presets}>
        {presets(today).map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange({ start: p.start, end: p.end })}
            style={{ ...s.preset, ...(p.start === start && p.end === end ? s.presetOn : {}) }}
          >
            {p.label}
          </button>
        ))}
        {detected && (
          <button type="button" onClick={() => onChange(detected)} style={{ ...s.preset, ...s.detected }}>
            ⚡ Use file dates
          </button>
        )}
      </div>
    </div>
  );
}

const s = {
  row: { display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 11, fontWeight: 700, color: theme.faint, textTransform: "uppercase", letterSpacing: 0.8 },
  input: {
    padding: "9px 12px",
    borderRadius: 12,
    borderWidth: 1, borderStyle: "solid", borderColor: theme.border,
    fontSize: 14,
    fontWeight: 500,
    color: theme.text,
    background: "#fff",
    outline: "none",
  },
  arrow: { paddingBottom: 10, color: theme.faint, fontWeight: 700 },
  days: { padding: "9px 12px", background: theme.primarySoft, color: theme.primary, borderRadius: 12, fontSize: 13, fontWeight: 700 },
  bad: { background: theme.redSoft, color: theme.red },
  presets: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 },
  preset: {
    borderWidth: 1, borderStyle: "solid", borderColor: theme.border,
    background: "#fff",
    color: theme.muted,
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  presetOn: { borderColor: theme.primary, color: theme.primary, background: theme.primarySoft },
  detected: { borderColor: "#bbf7d0", color: theme.green, background: "#f0fdf4" },
};
