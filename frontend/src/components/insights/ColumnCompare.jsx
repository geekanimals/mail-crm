"use client";

// Column chart: previous vs current for every account + platform, numbers on the bars.
// Current bar is green when it went up and red when it dropped. Filter: All / Dropped / Grew.
import { useState } from "react";
import { PLATFORM_COLORS, theme } from "@/lib/insights/constants";
import { change } from "@/lib/insights/calc";
import { fmtMetric, fmtPct, fmtValue } from "@/lib/insights/format";

const HEIGHT = 230; // bar area in px
const PREV = "#cfe3dc";
const UP = "linear-gradient(180deg, #4ade80, #16a34a)";
const DOWN = "linear-gradient(180deg, #fb7185, #e11d48)";
const SAME = "linear-gradient(180deg, #3f8a7b, #2d6a5f)";
const FILTERS = [
  { value: "all", label: "All" },
  { value: "down", label: "▼ Dropped" },
  { value: "up", label: "▲ Grew" },
];

// list: [{ account, platform, prev: {...}, cur: {...} }]
export default function ColumnCompare({ list, metric, prevLabel, curLabel }) {
  const [show, setShow] = useState("all");

  const items = list
    .map((x) => ({ ...x, p: x.prev[metric] || 0, c: x.cur[metric] || 0 }))
    .filter((x) => x.p || x.c)
    .map((x) => ({ ...x, diff: x.c - x.p, pct: change(x.p, x.c) }))
    .sort((a, b) => (a.pct ?? Infinity) - (b.pct ?? Infinity)); // biggest drop first

  const downs = items.filter((x) => x.diff < 0);
  const ups = items.filter((x) => x.diff > 0);
  const shown = show === "down" ? downs : show === "up" ? ups : items;
  const max = Math.max(1, ...shown.flatMap((x) => [x.p, x.c]));
  const worst = downs[0];
  // best growth: highest % among ones that existed before; a brand-new one only if nothing else grew
  const best = [...ups].sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity))[0];

  if (!items.length) return <div style={s.empty}>No data for this selection</div>;

  return (
    <div>
      <div style={s.top}>
        <div style={s.pills}>
          <span style={{ ...s.pill, background: theme.redSoft, color: theme.red }}>▼ {downs.length} dropped</span>
          <span style={{ ...s.pill, background: theme.greenSoft, color: theme.green }}>▲ {ups.length} grew</span>
          {worst && (
            <span style={s.callout}>
              Biggest drop: <b>{worst.account} · {worst.platform}</b> <b style={{ color: theme.red }}>{fmtPct(worst.pct)}</b>
            </span>
          )}
          {best && (
            <span style={s.callout}>
              Best growth: <b>{best.account} · {best.platform}</b> <b style={{ color: theme.green }}>{fmtPct(best.pct)}</b>
            </span>
          )}
        </div>
        <div style={s.filters}>
          {FILTERS.map((f) => (
            <button key={f.value} type="button" onClick={() => setShow(f.value)} style={{ ...s.filter, ...(show === f.value ? s.filterOn : {}) }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={s.legend}>
        <span style={s.legendItem}><span style={{ ...s.swatch, background: PREV }} />{prevLabel}</span>
        <span style={s.legendItem}><span style={{ ...s.swatch, background: UP }} />{curLabel} — went up</span>
        <span style={s.legendItem}><span style={{ ...s.swatch, background: DOWN }} />{curLabel} — dropped</span>
      </div>

      {!shown.length ? (
        <div style={s.empty}>{show === "down" ? "Nothing dropped — everything held or grew 🎉" : "Nothing grew in this selection"}</div>
      ) : (
        <div style={s.scroll}>
          <div style={{ ...s.chart, minWidth: shown.length * 92 }}>
            {[0.25, 0.5, 0.75, 1].map((g) => (
              <div key={g} style={{ ...s.grid, bottom: 64 + HEIGHT * g }}>
                <span style={s.gridLabel}>{fmtValue(metric, max * g)}</span>
              </div>
            ))}

            {shown.map((x) => {
              const down = x.diff < 0;
              const curBg = down ? DOWN : x.diff > 0 ? UP : SAME;
              const h = (v) => Math.max(v ? 3 : 0, (v / max) * HEIGHT);
              return (
                <div key={x.account + x.platform} style={s.group} title={`${x.account} · ${x.platform}\n${prevLabel}: ${fmtMetric(metric, x.p)}\n${curLabel}: ${fmtMetric(metric, x.c)}`}>
                  <div style={s.bars}>
                    <div style={s.barCol}>
                      <span style={s.val}>{fmtValue(metric, x.p)}</span>
                      <div style={{ ...s.bar, height: h(x.p), background: PREV }} />
                    </div>
                    <div style={s.barCol}>
                      <span style={{ ...s.val, color: down ? theme.red : theme.text, fontWeight: 800 }}>{fmtValue(metric, x.c)}</span>
                      <div style={{ ...s.bar, height: h(x.c), background: curBg, boxShadow: down ? "0 6px 14px -6px rgba(225,29,72,0.6)" : "0 6px 14px -6px rgba(22,163,74,0.5)" }} />
                    </div>
                  </div>
                  <div style={s.label}>
                    <b style={s.account}>{x.account}</b>
                    <span style={s.platform}>
                      <span style={{ ...s.dot, background: PLATFORM_COLORS[x.platform] }} />
                      {x.platform}
                    </span>
                    <span style={{ ...s.pct, color: down ? theme.red : x.diff > 0 ? theme.green : theme.muted, background: down ? theme.redSoft : x.diff > 0 ? theme.greenSoft : "#e9f2ee" }}>
                      {fmtPct(x.pct)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 },
  pills: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  pill: { padding: "5px 11px", borderRadius: 999, fontSize: 12.5, fontWeight: 700 },
  callout: { fontSize: 12.5, color: theme.muted, background: "rgba(255,255,255,0.7)", border: `1px solid ${theme.border}`, padding: "5px 11px", borderRadius: 999 },
  filters: { display: "flex", gap: 6, background: "rgba(45,106,95,0.08)", padding: 4, borderRadius: 12 },
  filter: { border: "none", background: "transparent", padding: "7px 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, color: theme.muted, cursor: "pointer", fontFamily: "inherit" },
  filterOn: { background: theme.glassSoft, color: theme.primary, boxShadow: "0 2px 8px rgba(20,50,44,0.08)" },
  legend: { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 },
  legendItem: { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: theme.muted },
  swatch: { width: 12, height: 12, borderRadius: 4 },
  scroll: { overflowX: "auto", paddingBottom: 6 },
  chart: { position: "relative", display: "flex", alignItems: "flex-end", gap: 10, height: HEIGHT + 64 + 34, paddingLeft: 46 },
  grid: { position: "absolute", left: 46, right: 0, borderTop: "1px dashed rgba(20,50,44,0.08)" },
  gridLabel: { position: "absolute", left: -46, top: -8, width: 40, textAlign: "right", fontSize: 10.5, color: theme.faint },
  group: { flex: "1 0 82px", maxWidth: 140, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", zIndex: 1 },
  bars: { display: "flex", alignItems: "flex-end", gap: 5, height: HEIGHT + 22 },
  barCol: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" },
  val: { fontSize: 10.5, fontWeight: 600, color: theme.muted, marginBottom: 4, whiteSpace: "nowrap" },
  bar: { width: 24, borderRadius: "7px 7px 3px 3px", transition: "height .4s ease" },
  label: { height: 64, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, marginTop: 8, textAlign: "center" },
  account: { fontSize: 12, color: theme.text, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  platform: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: theme.muted, whiteSpace: "nowrap" },
  dot: { width: 7, height: 7, borderRadius: "50%" },
  pct: { fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999, marginTop: 2, whiteSpace: "nowrap" },
  empty: { padding: "40px 0", textAlign: "center", color: theme.muted, fontSize: 14 },
};
