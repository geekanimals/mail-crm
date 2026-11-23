"use client";

import { theme } from "@/lib/insights/constants";
import { useScreen } from "@/lib/insights/useScreen";
import { change, engagementRate } from "@/lib/insights/calc";
import { fmt, fmtPct } from "@/lib/insights/format";

// Gradient summary banner at the top of Overview
export default function HeroBanner({ rangeLabel, prevLabel, cur, prev, entries }) {
  const pct = change(prev.views, cur.views);
  const er = engagementRate(cur);
  const erPrev = engagementRate(prev);
  const { mobile } = useScreen();

  return (
    <div style={{ ...s.wrap, ...(mobile ? { padding: "20px 18px", borderRadius: 18 } : {}) }}>
      <div style={s.circle1} />
      <div style={s.circle2} />
      <div style={s.left}>
        <div style={s.eyebrow}>Latest period · {rangeLabel}</div>
        <div style={{ ...s.big, ...(mobile ? { fontSize: 32 } : {}) }}>
          {fmt(cur.views)} <span style={s.unit}>total views</span>
        </div>
        <div style={s.line}>
          <span style={s.pill}>{fmtPct(pct)}</span> vs {prevLabel} ({fmt(prev.views)})
        </div>
      </div>
      <div style={s.stats}>
        <Stat label="Engagement rate" value={er.toFixed(2) + "%"} sub={`previous ${erPrev.toFixed(2)}%`} />
        <Stat label="New followers" value={"+" + fmt(Math.max(0, cur.followers - prev.followers))} sub="based on total" />
        <Stat label="Entries" value={entries} sub="account × platform" />
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={s.stat}>
      <div style={s.statLabel}>{label}</div>
      <div style={s.statValue}>{value}</div>
      <div style={s.statSub}>{sub}</div>
    </div>
  );
}

const s = {
  wrap: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 22,
    padding: "26px 28px",
    background: theme.gradient,
    color: "#fff",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 24,
    flexWrap: "wrap",
    marginBottom: 22,
    boxShadow: "0 20px 40px -20px rgba(45,106,95,0.7)",
  },
  circle1: { position: "absolute", width: 320, height: 320, borderRadius: "50%", background: "rgba(255,255,255,0.10)", right: -80, top: -140 },
  circle2: { position: "absolute", width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.08)", right: 220, bottom: -120 },
  left: { position: "relative" },
  eyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", opacity: 0.85 },
  big: { fontSize: 42, fontWeight: 800, letterSpacing: -1.5, margin: "8px 0 6px" },
  unit: { fontSize: 16, fontWeight: 500, opacity: 0.85, letterSpacing: 0 },
  line: { fontSize: 14, opacity: 0.95 },
  pill: { background: "rgba(255,255,255,0.22)", padding: "3px 10px", borderRadius: 999, fontWeight: 700, marginRight: 6 },
  stats: { display: "flex", gap: 10, position: "relative", flexWrap: "wrap", flex: "1 1 320px", justifyContent: "flex-end" },
  stat: {
    background: "rgba(255,255,255,0.14)",
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: 16,
    padding: "14px 18px",
    minWidth: 130,
    flex: "1 1 130px",
    maxWidth: 200,
    backdropFilter: "blur(6px)",
  },
  statLabel: { fontSize: 12, opacity: 0.85, fontWeight: 600 },
  statValue: { fontSize: 24, fontWeight: 800, margin: "4px 0 2px", letterSpacing: -0.5 },
  statSub: { fontSize: 11.5, opacity: 0.75 },
};
