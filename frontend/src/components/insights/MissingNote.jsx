import { theme } from "@/lib/insights/constants";

// Shown when some account + platform pairs have no data yet for the current period
export default function MissingNote({ missing, periodLabel }) {
  if (!missing.length) return null;
  return (
    <div style={s.box}>
      <b>Not uploaded yet for {periodLabel}:</b> {missing.join(", ")}.
      <div style={s.sub}>These are left out of the comparison until their data is uploaded, so nothing shows a false −100%.</div>
    </div>
  );
}

const s = {
  box: {
    background: "rgba(255,204,0,0.14)",
    color: "#8a4b00",
    border: "1px solid rgba(255,179,0,0.35)",
    backdropFilter: theme.blur,
    WebkitBackdropFilter: theme.blur,
    padding: "12px 16px",
    borderRadius: theme.radius - 4,
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 1.55,
  },
  sub: { fontSize: 12, opacity: 0.85, marginTop: 2 },
};
