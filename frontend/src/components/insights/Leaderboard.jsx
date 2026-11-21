import ChangeBadge from "./ChangeBadge";
import { theme } from "@/lib/insights/constants";
import { change } from "@/lib/insights/calc";
import { fmtValue } from "@/lib/insights/format";

// Accounts ranked by a metric. list: [{ account, prev, cur }]
export default function Leaderboard({ list, metric, colors = {} }) {
  const ranked = [...list].sort((a, b) => b.cur[metric] - a.cur[metric]);
  const max = Math.max(1, ...ranked.map((r) => r.cur[metric]));

  if (!ranked.length) return <div style={s.empty}>No data yet</div>;

  return (
    <div style={s.list}>
      {ranked.map((r, i) => (
        <div key={r.account} style={s.row}>
          <span style={{ ...s.rank, ...(i === 0 ? s.first : {}) }}>{i + 1}</span>
          <div style={s.info}>
            <div style={s.top}>
              <span style={s.name}>{r.account}</span>
              <span style={s.value}>{fmtValue(metric, r.cur[metric])}</span>
            </div>
            <div style={s.track}>
              <div style={{ ...s.bar, width: `${(r.cur[metric] / max) * 100}%`, background: colors[r.account] || theme.primary }} />
            </div>
          </div>
          <ChangeBadge pct={change(r.prev[metric], r.cur[metric])} />
        </div>
      ))}
    </div>
  );
}

const s = {
  list: { display: "flex", flexDirection: "column", gap: 14 },
  row: { display: "flex", alignItems: "center", gap: 12 },
  rank: {
    width: 28,
    height: 28,
    borderRadius: 9,
    background: "#f1f2f8",
    color: theme.muted,
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
    fontSize: 13,
    flexShrink: 0,
  },
  first: { background: theme.gradient, color: "#fff" },
  info: { flex: 1, minWidth: 0 },
  top: { display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 6 },
  name: { fontWeight: 650, color: theme.text },
  value: { fontWeight: 700, color: theme.text },
  track: { height: 7, background: "#f1f2f8", borderRadius: 999, overflow: "hidden" },
  bar: { height: "100%", borderRadius: 999 },
  empty: { padding: 20, color: theme.muted, textAlign: "center" },
};
