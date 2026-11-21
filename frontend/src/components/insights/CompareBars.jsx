"use client";

import ChangeBadge from "./ChangeBadge";
import { useScreen } from "@/lib/insights/useScreen";
import { theme } from "@/lib/insights/constants";
import { change } from "@/lib/insights/calc";
import { fmtMetric, fmtValue } from "@/lib/insights/format";

// Previous vs current bars for each item. items: [{ name, prev, cur }]
export default function CompareBars({ items, colors = {}, metric, prevLabel, curLabel }) {
  const { mobile } = useScreen();
  if (!items.length) return <div style={s.empty}>No data for this selection</div>;
  const max = Math.max(1, ...items.flatMap((i) => [i.prev, i.cur]));

  return (
    <div>
      <div style={s.legend}>
        <span style={s.legendItem}><span style={{ ...s.swatch, background: "#d7dbe8" }} />{prevLabel}</span>
        <span style={s.legendItem}><span style={{ ...s.swatch, background: theme.gradient }} />{curLabel}</span>
      </div>

      <div style={s.list}>
        {items.map((i) => {
          const color = colors[i.name] || theme.primary;
          const down = i.cur < i.prev;
          return (
            <div key={i.name} style={{ ...s.row, gridTemplateColumns: mobile ? "78px 1fr 70px" : "130px 1fr 92px", gap: mobile ? 8 : 14 }}>
              <div style={s.name}>
                <span style={{ ...s.dot, background: color }} />
                {i.name}
              </div>

              <div style={s.bars}>
                <div style={s.barRow} title={`${prevLabel}: ${fmtMetric(metric, i.prev)}`}>
                  <div style={{ ...s.bar, width: `${(i.prev / max) * 100}%`, background: "#d7dbe8" }} />
                  <span style={s.barVal}>{fmtValue(metric, i.prev)}</span>
                </div>
                <div style={s.barRow} title={`${curLabel}: ${fmtMetric(metric, i.cur)}`}>
                  <div style={{ ...s.bar, width: `${(i.cur / max) * 100}%`, background: color }} />
                  <span style={{ ...s.barVal, color: theme.text, fontWeight: 700 }}>{fmtValue(metric, i.cur)}</span>
                </div>
              </div>

              <div style={s.change}>
                <ChangeBadge pct={change(i.prev, i.cur)} />
                <div style={{ ...s.diff, color: down ? theme.red : theme.green }}>
                  {down ? "−" : "+"}
                  {fmtValue(metric, Math.abs(i.cur - i.prev))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s = {
  legend: { display: "flex", gap: 18, marginBottom: 16 },
  legendItem: { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: theme.muted, fontWeight: 600 },
  swatch: { width: 14, height: 10, borderRadius: 3 },
  list: { display: "flex", flexDirection: "column", gap: 14 },
  row: { display: "grid", alignItems: "center" },
  name: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 650, color: theme.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  dot: { width: 9, height: 9, borderRadius: 999, flexShrink: 0 },
  bars: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  barRow: { display: "flex", alignItems: "center", gap: 8 },
  bar: { height: 11, borderRadius: 999, minWidth: 3 },
  barVal: { fontSize: 11.5, color: theme.muted, whiteSpace: "nowrap" },
  change: { textAlign: "right" },
  diff: { fontSize: 11.5, fontWeight: 650, marginTop: 4 },
  empty: { padding: 24, textAlign: "center", color: theme.muted, fontSize: 13 },
};
