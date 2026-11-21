import { theme } from "@/lib/insights/constants";
import { fmtMetric, fmtValue } from "@/lib/insights/format";

// Horizontal bars with share %. items: [{ name, value }]
export default function BarList({ items, colors = {}, metric = "views" }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const max = Math.max(1, ...items.map((i) => i.value));

  if (!items.length) return <div style={s.empty}>No data for this metric</div>;

  return (
    <div style={s.list}>
      {items.map((i) => (
        <div key={i.name} title={fmtMetric(metric, i.value)}>
          <div style={s.row}>
            <span style={s.name}>
              <span style={{ ...s.dot, background: colors[i.name] || theme.primary }} />
              {i.name}
            </span>
            <span style={s.val}>
              {fmtValue(metric, i.value)} <span style={s.share}>{((i.value / total) * 100).toFixed(1)}%</span>
            </span>
          </div>
          <div style={s.track}>
            <div
              style={{
                ...s.bar,
                width: `${(i.value / max) * 100}%`,
                background: `linear-gradient(90deg, ${colors[i.name] || theme.primary}cc, ${colors[i.name] || theme.primary})`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const s = {
  list: { display: "flex", flexDirection: "column", gap: 16 },
  row: { display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 7 },
  name: { fontWeight: 600, color: theme.text, display: "flex", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 999 },
  val: { color: theme.text, fontWeight: 700 },
  share: { color: theme.faint, fontWeight: 500, marginLeft: 6 },
  track: { height: 9, background: "#f1f2f8", borderRadius: 999, overflow: "hidden" },
  bar: { height: "100%", borderRadius: 999 },
  empty: { padding: 20, color: theme.muted, textAlign: "center", fontSize: 13 },
};
