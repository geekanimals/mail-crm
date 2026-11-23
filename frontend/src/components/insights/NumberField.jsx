import { theme } from "@/lib/insights/constants";

export default function NumberField({ label, icon, color = theme.primary, value, onChange, hint, step = "1", auto }) {
  return (
    <label style={s.wrap}>
      <span style={s.label}>
        {icon && <span style={{ ...s.icon, background: color + "1a", color }}>{icon}</span>}
        <span style={s.text} title={label}>{label}</span>
        {auto && <span style={s.auto}>from file</span>}
      </span>
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value)}
        style={{ ...s.input, ...(auto ? s.inputAuto : {}) }}
      />
      {hint && <span style={s.hint}>{hint}</span>}
    </label>
  );
}

const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 },
  label: { fontSize: 12.5, fontWeight: 600, color: theme.muted, display: "flex", alignItems: "center", gap: 8 },
  icon: { width: 22, height: 22, borderRadius: 7, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  text: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
  auto: { marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: theme.green, background: theme.greenSoft, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0 },
  input: {
    padding: "11px 13px",
    borderRadius: 12,
    borderWidth: 1, borderStyle: "solid", borderColor: theme.border,
    fontSize: 15,
    fontWeight: 650,
    color: theme.text,
    outline: "none",
    width: "100%",
    background: theme.glassSoft,
  },
  inputAuto: { borderColor: "#bbf7d0", background: "#f7fef9" },
  hint: { fontSize: 11.5, color: theme.faint },
};
