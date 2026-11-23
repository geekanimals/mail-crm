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
    background: "rgba(118,118,128,0.12)",
    border: "1px solid rgba(255,255,255,0.5)",
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
  // Apple-style segmented control: the picked one is a raised white pill
  active: { background: "rgba(255,255,255,0.96)", color: theme.text, boxShadow: "0 3px 8px rgba(0,0,0,0.12), 0 1px 1px rgba(0,0,0,0.04)" },
};
