"use client";

import { PLATFORM_COLORS, theme } from "@/lib/insights/constants";
import { useScreen } from "@/lib/insights/useScreen";
import { change } from "@/lib/insights/calc";
import { fmtValue } from "@/lib/insights/format";

// Diverging bars: % change per account + platform. Down = red (left), up = green (right).
// list: [{ account, platform, prev, cur }]
export default function UpDownChart({ list, metric }) {
  const { mobile } = useScreen();
  const cols = mobile ? "92px 1fr 54px" : "200px 1fr 62px";
  const items = list
    .map((x) => ({ ...x, p: x.prev[metric], c: x.cur[metric], pct: change(x.prev[metric], x.cur[metric]) }))
    .filter((x) => x.pct !== null && (x.p || x.c))
    .sort((a, b) => a.pct - b.pct);

  if (!items.length) return <div style={s.empty}>No changes to show for this metric</div>;

  const max = Math.max(1, ...items.map((x) => Math.min(Math.abs(x.pct), 300)));
  const downs = items.filter((x) => x.pct < 0).length;
  const ups = items.filter((x) => x.pct > 0).length;

  return (
    <div>
      <div style={s.summary}>
        <span style={{ ...s.pill, background: theme.redSoft, color: theme.red }}>▼ {downs} down</span>
        <span style={{ ...s.pill, background: theme.greenSoft, color: theme.green }}>▲ {ups} up</span>
        <span style={s.hint}>Bars capped at 300% for readability</span>
      </div>

      <div style={{ ...s.row, gridTemplateColumns: cols, marginBottom: 6 }}>
        <span />
        <div style={s.head}>
          <span style={{ color: theme.red }}>← Down</span>
          <span style={{ color: theme.green }}>Up →</span>
        </div>
        <span />
      </div>

      <div style={s.list}>
        {items.map((x) => {
          const w = (Math.min(Math.abs(x.pct), 300) / max) * 50;
          const down = x.pct < 0;
          return (
            <div key={x.account + x.platform} style={{ ...s.row, gridTemplateColumns: cols }} title={`${fmtValue(metric, x.p)} → ${fmtValue(metric, x.c)}`}>
              <div style={{ ...s.label, ...(mobile ? s.labelStack : {}) }}>
                <span style={{ ...s.dot, background: PLATFORM_COLORS[x.platform] }} />
                <b style={{ color: theme.text }}>{x.account}</b>
                <span style={s.platform}>{x.platform}</span>
              </div>
              <div style={s.track}>
                <div style={s.axis} />
                <div
                  style={{
                    ...s.bar,
                    width: `${w}%`,
                    left: down ? `${50 - w}%` : "50%",
                    background: down ? "linear-gradient(90deg,#fb7185,#e11d48)" : "linear-gradient(90deg,#22c55e,#16a34a)",
                    borderRadius: down ? "999px 0 0 999px" : "0 999px 999px 0",
                  }}
                />
              </div>
              <div style={{ ...s.pct, color: down ? theme.red : x.pct > 0 ? theme.green : theme.muted }}>
                {x.pct > 0 ? "+" : ""}
                {x.pct.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s = {
  summary: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  pill: { padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700 },
  hint: { fontSize: 11.5, color: theme.faint, marginLeft: "auto" },
  head: { display: "flex", justifyContent: "space-between", fontSize: 11.5, fontWeight: 700 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "grid", gap: 10, alignItems: "center" },
  label: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden" },
  dot: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
  labelStack: { flexDirection: "column", alignItems: "flex-start", gap: 0, fontSize: 12 },
  platform: { color: theme.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" },
  track: { position: "relative", height: 16, background: "#f6f7fb", borderRadius: 999 },
  axis: { position: "absolute", left: "50%", top: -3, bottom: -3, width: 1.5, background: "#c7cbe0" },
  bar: { position: "absolute", top: 2, height: 12 },
  pct: { fontSize: 12.5, fontWeight: 700, textAlign: "right" },
  empty: { padding: 24, textAlign: "center", color: theme.muted, fontSize: 13 },
};
