import ChangeBadge from "./ChangeBadge";
import { PLATFORM_COLORS, theme } from "@/lib/insights/constants";
import { fmtValue } from "@/lib/insights/format";

// Top gainers / losers list. items: [{ account, platform, prev, cur, pct }]
export default function MoversList({ items, metric, emptyText }) {
  if (!items.length) return <div style={s.empty}>{emptyText}</div>;

  return (
    <div style={s.list}>
      {items.map((m, i) => (
        <div key={m.account + m.platform} style={{ ...s.row, ...(i === items.length - 1 ? { borderBottom: "none" } : {}) }}>
          <span style={{ ...s.avatar, background: PLATFORM_COLORS[m.platform] }}>{m.platform[0]}</span>
          <div style={s.info}>
            <div style={s.name}>{m.account}</div>
            <div style={s.sub}>
              {m.platform} · {fmtValue(metric, m.prev[metric])} → {fmtValue(metric, m.cur[metric])}
            </div>
          </div>
          <ChangeBadge pct={m.pct} />
        </div>
      ))}
    </div>
  );
}

const s = {
  list: { display: "flex", flexDirection: "column" },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${theme.border}` },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
    fontSize: 14,
    flexShrink: 0,
  },
  info: { flex: 1, minWidth: 0 },
  name: { fontWeight: 650, fontSize: 14, color: theme.text },
  sub: { fontSize: 12, color: theme.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  empty: { padding: 24, color: theme.muted, textAlign: "center", fontSize: 13 },
};
