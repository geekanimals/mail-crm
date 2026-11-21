"use client";

// "What happened, why, and what to do" cards from diagnose()
import { theme } from "@/lib/insights/constants";

const TONES = {
  down: { mark: "▼", color: theme.red, soft: theme.redSoft, tag: "Needs work" },
  up: { mark: "▲", color: theme.green, soft: theme.greenSoft, tag: "Working" },
  info: { mark: "●", color: "#0b87a5", soft: "rgba(50,193,223,0.12)", tag: "Note" },
};

export default function Findings({ findings }) {
  // problems first, then what worked
  const order = { down: 0, info: 1, up: 2 };
  const list = [...findings].sort((a, b) => order[a.tone] - order[b.tone]);

  return (
    <div style={s.list}>
      {list.map((f, i) => {
        const t = TONES[f.tone] || TONES.info;
        return (
          <div key={i} style={{ ...s.item, borderLeftColor: t.color }}>
            <div style={s.top}>
              <span style={{ ...s.mark, color: t.color, background: t.soft }}>{t.mark}</span>
              <b style={s.title}>{f.title}</b>
              <span style={{ ...s.tag, color: t.color, background: t.soft }}>{t.tag}</span>
            </div>
            <div style={s.row}>
              <span style={s.key}>Why</span>
              <span style={s.text}>{f.why}</span>
            </div>
            <div style={s.row}>
              <span style={{ ...s.key, color: "#0b87a5" }}>Do this</span>
              <span style={{ ...s.text, color: theme.text, fontWeight: 500 }}>{f.todo}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const s = {
  list: { display: "flex", flexDirection: "column", gap: 12 },
  item: {
    background: "rgba(255,255,255,0.8)",
    border: `1px solid ${theme.border}`,
    borderLeftWidth: 4,
    borderLeftStyle: "solid",
    borderRadius: 16,
    padding: "14px 16px",
  },
  top: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 },
  mark: { width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", fontSize: 12, flexShrink: 0 },
  title: { fontSize: 14.5, color: theme.text, flex: 1, minWidth: 180 },
  tag: { fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999 },
  row: { display: "grid", gridTemplateColumns: "64px 1fr", gap: 10, fontSize: 13.5, marginTop: 4, lineHeight: 1.5 },
  key: { fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: theme.faint, paddingTop: 2 },
  text: { color: theme.muted },
};
