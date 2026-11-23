import ChangeBadge from "./ChangeBadge";
import { CORE_METRICS, PLATFORM_COLORS, theme } from "@/lib/insights/constants";
import { change } from "@/lib/insights/calc";
import { fmtValue } from "@/lib/insights/format";

// Account + platform wise comparison table. list: [{ account, platform, prev, cur }]
export default function ChangeTable({ list, metrics = CORE_METRICS }) {
  if (!list.length) return <div style={s.empty}>No data for this filter</div>;

  const sorted = [...list].sort((a, b) => a.account.localeCompare(b.account) || a.platform.localeCompare(b.platform));

  return (
    <div style={s.scroll}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={{ ...s.th, textAlign: "left" }}>Account</th>
            <th style={{ ...s.th, textAlign: "left" }}>Platform</th>
            {metrics.map((m) => (
              <th key={m.key} style={s.th}>{m.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.account + r.platform}>
              <td style={{ ...s.td, fontWeight: 650, textAlign: "left" }}>{r.account}</td>
              <td style={{ ...s.td, textAlign: "left" }}>
                <span style={{ ...s.dot, background: PLATFORM_COLORS[r.platform] }} />
                {r.platform}
              </td>
              {metrics.map((m) => (
                <td key={m.key} style={s.td}>
                  <div style={s.nums}>
                    {fmtValue(m.key, r.prev[m.key])} → <b style={{ color: theme.text }}>{fmtValue(m.key, r.cur[m.key])}</b>
                  </div>
                  <ChangeBadge pct={change(r.prev[m.key], r.cur[m.key])} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const s = {
  scroll: { overflowX: "auto", margin: "0 -22px", padding: "0 22px" },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 },
  th: {
    textAlign: "right",
    padding: "11px 14px",
    color: theme.faint,
    fontWeight: 700,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    borderBottom: `1px solid ${theme.border}`,
    background: "rgba(255,255,255,0.35)",
    whiteSpace: "nowrap",
  },
  td: { textAlign: "right", padding: "13px 14px", borderBottom: `1px solid ${theme.border}`, color: theme.text, whiteSpace: "nowrap" },
  nums: { marginBottom: 5, color: theme.muted },
  dot: { display: "inline-block", width: 8, height: 8, borderRadius: 999, marginRight: 8 },
  empty: { padding: 30, textAlign: "center", color: theme.muted },
};
