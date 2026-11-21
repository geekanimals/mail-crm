import { theme } from "@/lib/insights/constants";

// Pill toggle. options: [{ value, label }]
export default function Tabs({ value, onChange, options }) {
  return (
    <div style={s.wrap}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{ ...s.btn, ...(value === o.value ? s.active : {}) }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const s = {
  wrap: {
    display: "inline-flex",
    flexWrap: "wrap",
    background: "#fff",
    border: `1px solid ${theme.border}`,
    padding: 4,
    borderRadius: 14,
    gap: 2,
    boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
  },
  btn: {
    border: "none",
    background: "transparent",
    padding: "8px 14px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    color: theme.muted,
    cursor: "pointer",
  },
  active: { background: theme.gradient, color: "#fff", boxShadow: "0 4px 12px -4px rgba(50,193,223,0.6)" },
};
