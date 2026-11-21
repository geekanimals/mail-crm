"use client";

// Week-by-week (or month-by-month) columns for one metric.
// Number on every bar, % change vs the bar before it, green = went up, red = dropped.
// periods: [{ key, label, value }] oldest → newest. focus: [prevKey, curKey] are outlined.
import { useEffect, useRef } from "react";
import { theme } from "@/lib/insights/constants";
import { change } from "@/lib/insights/calc";
import { fmtMetric, fmtValue } from "@/lib/insights/format";

const HEIGHT = 200;

export default function PeriodColumns({ periods, metric, focus = [], color = "#32c1df" }) {
  const box = useRef(null);
  // on small screens start scrolled to the newest weeks
  useEffect(() => {
    if (box.current) box.current.scrollLeft = box.current.scrollWidth;
  }, [periods.length, metric]);

  if (!periods.length) return <div style={s.empty}>No data yet</div>;
  const max = Math.max(1, ...periods.map((p) => p.value));

  return (
    <div ref={box} style={s.scroll}>
      <div style={{ ...s.chart, minWidth: periods.length * 86 }}>
        {[0.5, 1].map((g) => (
          <div key={g} style={{ ...s.grid, bottom: 58 + HEIGHT * g }} />
        ))}
        {periods.map((p, i) => {
          const before = periods[i - 1];
          const pct = before ? change(before.value, p.value) : undefined;
          const down = pct !== undefined && pct !== null && pct < 0;
          const upNow = pct !== undefined && (pct === null || pct > 0);
          const isFocus = focus.includes(p.key);
          const bg = !before ? `linear-gradient(180deg, ${color}aa, ${color})` : down ? "linear-gradient(180deg, #fb7185, #e11d48)" : upNow ? "linear-gradient(180deg, #4ade80, #16a34a)" : "linear-gradient(180deg, #a5d8e4, #6bbccf)";
          return (
            <div key={p.key} style={s.col} title={`${p.label}: ${fmtMetric(metric, p.value)}`}>
              <div style={s.barArea}>
                <span style={{ ...s.val, ...(isFocus ? s.valFocus : {}) }}>{fmtValue(metric, p.value)}</span>
                <div
                  style={{
                    ...s.bar,
                    height: Math.max(p.value ? 4 : 0, (p.value / max) * HEIGHT),
                    background: bg,
                    ...(isFocus ? s.barFocus : { opacity: 0.75 }),
                  }}
                />
              </div>
              <div style={s.label}>
                <span style={{ ...s.period, ...(isFocus ? { color: theme.text, fontWeight: 700 } : {}) }}>{p.label}</span>
                {pct === undefined ? (
                  <span style={{ ...s.chip, color: theme.muted, background: "#eef3f5" }}>start</span>
                ) : (
                  <span style={{ ...s.chip, color: down ? theme.red : theme.green, background: down ? theme.redSoft : theme.greenSoft }}>
                    {pct === null ? "New" : `${down ? "▼" : "▲"} ${Math.abs(pct).toFixed(0)}%`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s = {
  scroll: { overflowX: "auto", paddingBottom: 4 },
  chart: { position: "relative", display: "flex", alignItems: "flex-end", gap: 10, height: HEIGHT + 58 + 26 },
  grid: { position: "absolute", left: 0, right: 0, borderTop: "1px dashed rgba(11,60,75,0.08)" },
  col: { flex: "1 0 76px", maxWidth: 130, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", zIndex: 1 },
  barArea: { height: HEIGHT + 22, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", width: "100%" },
  val: { fontSize: 11.5, fontWeight: 600, color: theme.muted, marginBottom: 5, whiteSpace: "nowrap" },
  valFocus: { fontSize: 13, fontWeight: 800, color: theme.text },
  bar: { width: "62%", maxWidth: 46, borderRadius: "9px 9px 4px 4px", transition: "height .4s ease" },
  barFocus: { boxShadow: "0 8px 18px -8px rgba(11,60,75,0.45)", outline: "2px solid rgba(255,255,255,0.9)" },
  label: { height: 58, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 8 },
  period: { fontSize: 11.5, color: theme.muted, whiteSpace: "nowrap" },
  chip: { fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 999, whiteSpace: "nowrap" },
  empty: { padding: "36px 0", textAlign: "center", color: theme.muted },
};
