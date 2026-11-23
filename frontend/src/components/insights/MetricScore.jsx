"use client";

// One metric, last period vs this period, in plain words: "Reach dropped 2.1K (−18%)".
// Click to show this metric in the week-by-week chart.
import { theme } from "@/lib/insights/constants";
import { change } from "@/lib/insights/calc";
import { fmtValue } from "@/lib/insights/format";

export default function MetricScore({ label, icon, color, metric, prev, cur, prevLabel, active, onClick, suffix = "" }) {
  const pct = change(prev, cur);
  const diff = cur - prev;
  const down = diff < 0;
  const same = diff === 0;
  const show = (v) => (suffix ? v.toFixed(2) + suffix : fmtValue(metric, v));
  const tone = same ? theme.muted : down ? theme.red : theme.green;
  const word = same ? "No change" : down ? "Dropped" : "Went up";

  return (
    <button type="button" onClick={onClick} style={{ ...s.card, ...(active ? s.active : {}), borderTopColor: tone }}>
      <div style={s.head}>
        <span style={{ ...s.icon, color, background: color + "1f" }}>{icon}</span>
        <span style={s.label}>{label}</span>
        <span style={{ ...s.badge, color: tone, background: same ? "#e9f2ee" : down ? theme.redSoft : theme.greenSoft }}>
          {pct === null ? "New" : same ? "0%" : `${down ? "▼" : "▲"} ${Math.abs(pct).toFixed(0)}%`}
        </span>
      </div>
      <div style={s.value}>{show(cur)}</div>
      <div style={s.line}>
        <b style={{ color: tone }}>
          {word}
          {!same && ` ${down ? "−" : "+"}${show(Math.abs(diff))}`}
        </b>
      </div>
      <div style={s.prev}>
        {prevLabel}: {show(prev)}
      </div>
    </button>
  );
}

const s = {
  card: {
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
    background: theme.glass,
    backdropFilter: theme.blur,
    WebkitBackdropFilter: theme.blur,
    borderWidth: "3px 1px 1px 1px",
    borderStyle: "solid",
    borderColor: theme.border,
    borderRadius: 18,
    padding: "14px 16px",
    boxShadow: theme.shadow,
    minWidth: 0,
    transition: "transform .15s, box-shadow .15s",
  },
  active: { boxShadow: "0 0 0 2px #2d6a5f, 0 12px 26px -12px rgba(45,106,95,0.6)" },
  head: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  icon: { width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", fontSize: 13, flexShrink: 0 },
  label: { fontSize: 13, fontWeight: 600, color: theme.muted, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  badge: { fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" },
  value: { fontSize: 24, fontWeight: 750, color: theme.text, letterSpacing: -0.5 },
  line: { fontSize: 12.5, marginTop: 2 },
  prev: { fontSize: 12, color: theme.faint, marginTop: 2 },
};
