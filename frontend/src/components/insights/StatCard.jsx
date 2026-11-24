import ChangeBadge from "./ChangeBadge";
import Sparkline from "./Sparkline";
import { metricFor, theme } from "@/lib/insights/constants";
import { change } from "@/lib/insights/calc";
import { fmtMetric, fmtValue } from "@/lib/insights/format";

// Big metric card: value, % change, previous value and a small trend line
export default function StatCard({ metric, prev, cur, prevLabel, trend, compact, platform }) {
  const m = metricFor(metric, platform); // YouTube → "Subscribers"
  const diff = cur - prev;

  return (
    <div style={{ ...s.card, ...(compact ? s.compact : {}) }}>
      <div style={s.top}>
        <div style={s.labelRow}>
          <span style={{ ...s.icon, background: m.color + "1a", color: m.color }}>{m.icon}</span>
          <span style={s.label} title={m.full}>{m.label}</span>
        </div>
        <ChangeBadge pct={change(prev, cur)} />
      </div>

      <div style={s.middle}>
        <div style={{ ...s.value, ...(compact ? s.valueSm : {}) }} title={fmtMetric(metric, cur)}>
          {fmtValue(metric, cur)}
        </div>
        {!compact && <Sparkline values={trend} color={m.color} />}
      </div>

      <div style={s.prev}>
        {prevLabel}: <b style={{ color: theme.text }}>{fmtValue(metric, prev)}</b>
        <span style={{ color: diff >= 0 ? theme.green : theme.red, marginLeft: 8, fontWeight: 600 }}>
          {diff >= 0 ? "+" : "−"}
          {fmtValue(metric, Math.abs(diff))}
        </span>
      </div>
    </div>
  );
}

const s = {
  card: {
    background: theme.glass,
    border: `1px solid ${theme.glassBorder}`,
    borderRadius: theme.radius,
    padding: 20,
    boxShadow: theme.shadow,
    backdropFilter: theme.blur,
    WebkitBackdropFilter: theme.blur,
    minWidth: 0,
  },
  compact: { padding: 16 },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  labelRow: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  icon: { width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", fontSize: 15, fontWeight: 700, flexShrink: 0 },
  label: { fontSize: 13, color: theme.muted, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  middle: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8, margin: "14px 0 8px" },
  value: { fontSize: 30, fontWeight: 780, color: theme.text, letterSpacing: -1, lineHeight: 1 },
  valueSm: { fontSize: 22 },
  prev: { fontSize: 12.5, color: theme.muted },
};
