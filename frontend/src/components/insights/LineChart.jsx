"use client";

// SVG multi-line area chart with hover tooltip (no chart library)
import { useState } from "react";
import { theme } from "@/lib/insights/constants";
import { fmt, fmtShort, fmtMetric, fmtValue } from "@/lib/insights/format";
import { change } from "@/lib/insights/calc";
import { useScreen } from "@/lib/insights/useScreen";

const PAD = { top: 34, right: 30, bottom: 34, left: 58 };

export default function LineChart({ labels, series, colors = {}, metric = "views" }) {
  const [hover, setHover] = useState(null);
  const [numbers, setNumbers] = useState(null); // null = automatic
  const { mobile } = useScreen();
  const W = mobile ? 420 : 820; // narrower drawing on phones = bigger text
  const H = mobile ? 280 : 300;
  if (!labels.length) return <div style={s.empty}>No data yet</div>;

  const max = Math.max(1, ...series.flatMap((x) => x.values));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const step = labels.length > 1 ? innerW / (labels.length - 1) : innerW;
  const color = (name) => colors[name] || theme.primary;
  const gid = (name) => "lg-" + name.replace(/[^a-z0-9]/gi, "");
  const showNums = numbers ?? series.length <= 2; // numbers on points: on by default for 1–2 lines
  const skipLabel = (i) => labels.length > 6 && mobile && i % 2 && i !== labels.length - 1;
  const last = labels.length - 1;
  const pct = (sr) => (last > 0 ? change(sr.values[last - 1], sr.values[last]) : 0);

  return (
    <div style={s.wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} style={s.svg} onMouseLeave={() => setHover(null)}>
        <defs>
          {series.map((sr) => (
            <linearGradient key={sr.name} id={gid(sr.name)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color(sr.name)} stopOpacity={series.length > 2 ? 0.08 : 0.22} />
              <stop offset="100%" stopColor={color(sr.name)} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#eef0f6" />
            <text x={PAD.left - 12} y={y(t) + 4} textAnchor="end" fontSize="11" fill={theme.faint}>
              {fmt(t)}
            </text>
          </g>
        ))}

        {labels.map((l, i) => (labels.length > 6 && mobile && i % 2 && i !== labels.length - 1 ? null :
          <text key={l} x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill={theme.faint} fontWeight={hover === i ? 700 : 400}>
            {fmtShort(l)}
          </text>
        ))}

        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="#c7cbe0" strokeDasharray="4 4" />}

        {series.map((sr) => {
          const pts = sr.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
          return (
            <g key={sr.name}>
              {labels.length > 1 && (
                <polygon points={`${x(0)},${PAD.top + innerH} ${pts} ${x(labels.length - 1)},${PAD.top + innerH}`} fill={`url(#${gid(sr.name)})`} />
              )}
              <polyline fill="none" stroke={color(sr.name)} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" points={pts} />
              {sr.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5.5 : 3.5} fill="#fff" stroke={color(sr.name)} strokeWidth="2.2" />
              ))}
            </g>
          );
        })}

        {showNums &&
          series.map((sr) =>
            sr.values.map((v, i) =>
              skipLabel(i) ? null : (
                <text
                  key={sr.name + i}
                  x={x(i)}
                  y={y(v) - 10}
                  textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}
                  fontSize="10.5"
                  fontWeight="700"
                  fill={color(sr.name)}
                  stroke="#fff"
                  strokeWidth="3"
                  paintOrder="stroke"
                >
                  {fmtValue(metric, v)}
                </text>
              )
            )
          )}

        {labels.map((l, i) => (
          <rect key={l} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>

      {hover !== null && (
        <div style={{ ...s.tip, left: `${(x(hover) / W) * 100}%` }}>
          <div style={s.tipTitle}>{fmtShort(labels[hover])}</div>
          {[...series]
            .sort((a, b) => b.values[hover] - a.values[hover])
            .map((sr) => (
              <div key={sr.name} style={s.tipRow}>
                <span style={{ ...s.dot, background: color(sr.name) }} />
                <span style={{ flex: 1 }}>{sr.name}</span>
                <b>{fmtMetric(metric, sr.values[hover])}</b>
              </div>
            ))}
        </div>
      )}

      <div style={s.legend}>
        {series.map((sr) => {
          const p = pct(sr);
          return (
            <span key={sr.name} style={s.legendItem} title={last > 0 ? `${fmtShort(labels[last - 1])}: ${fmtMetric(metric, sr.values[last - 1])}` : ""}>
              <span style={{ ...s.dot, background: color(sr.name) }} />
              {series.length > 1 && sr.name}
              <b style={{ color: theme.text }}>{fmtValue(metric, sr.values[last])}</b>
              {last > 0 && (
                <span style={{ color: p === null ? theme.primary : p > 0 ? theme.green : p < 0 ? theme.red : theme.muted, fontWeight: 700 }}>
                  {p === null ? "New" : `${p > 0 ? "▲" : p < 0 ? "▼" : ""} ${Math.abs(p).toFixed(1)}%`}
                </span>
              )}
              {series.length === 1 && last > 0 && (
                <span style={{ color: theme.faint }}>vs {fmtValue(metric, sr.values[last - 1])} previous week</span>
              )}
            </span>
          );
        })}
        <button type="button" onClick={() => setNumbers(!showNums)} style={{ ...s.toggle, ...(showNums ? s.toggleOn : {}) }}>
          {showNums ? "✓ " : ""}Numbers on chart
        </button>
      </div>
    </div>
  );
}

const s = {
  wrap: { position: "relative" },
  svg: { width: "100%", height: "auto", display: "block" },
  empty: { padding: 40, textAlign: "center", color: theme.muted },
  tip: {
    position: "absolute",
    top: 6,
    transform: "translateX(-50%)",
    background: "rgba(11,16,32,0.94)",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: 12,
    fontSize: 12,
    pointerEvents: "none",
    whiteSpace: "nowrap",
    zIndex: 5,
    minWidth: 170,
    boxShadow: "0 12px 30px -10px rgba(0,0,0,0.5)",
  },
  tipTitle: { fontWeight: 700, marginBottom: 6, fontSize: 12.5 },
  tipRow: { display: "flex", alignItems: "center", gap: 8, lineHeight: 1.7 },
  dot: { width: 9, height: 9, borderRadius: 999, display: "inline-block", flexShrink: 0 },
  legend: { display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: 12, justifyContent: "center", alignItems: "center" },
  toggle: { border: "1px solid #e5e7f0", background: "#fff", color: "#6b7280", borderRadius: 999, padding: "4px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" },
  toggleOn: { background: "rgba(50,193,223,0.12)", color: "#0b87a5", borderColor: "rgba(50,193,223,0.4)" },
  legendItem: { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: theme.muted, fontWeight: 500 },
};
