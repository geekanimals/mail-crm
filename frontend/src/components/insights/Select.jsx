import { theme } from "@/lib/insights/constants";

// options: array of strings or { value, label }
export default function Select({ label, value, onChange, options }) {
  return (
    <label style={s.wrap}>
      {label && <span style={s.label}>{label}</span>}
      <div style={s.box}>
        <select value={value} onChange={(e) => onChange(e.target.value)} style={s.select}>
          {options.map((o) => {
            const opt = typeof o === "string" ? { value: o, label: o } : o;
            return (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            );
          })}
        </select>
        <span style={s.arrow}>▾</span>
      </div>
    </label>
  );
}

const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 6, minWidth: 150 },
  label: { fontSize: 11, fontWeight: 700, color: theme.faint, textTransform: "uppercase", letterSpacing: 0.8 },
  box: { position: "relative" },
  select: {
    appearance: "none",
    WebkitAppearance: "none",
    padding: "10px 36px 10px 14px",
    borderRadius: 12,
    border: `1px solid ${theme.border}`,
    background: "#fff",
    fontSize: 14,
    fontWeight: 500,
    color: theme.text,
    minWidth: 0,
    width: "100%",
    cursor: "pointer",
    outline: "none",
    boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
  },
  arrow: { position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: theme.faint, pointerEvents: "none", fontSize: 12 },
};
