import { theme } from "@/lib/insights/constants";

// Multi-select chips. options: [{ value, label, color }], value: array
export default function ChipToggle({ value, onChange, options }) {
  const toggle = (v) => {
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    if (next.length) onChange(next);
  };

  return (
    <div style={s.wrap}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            style={{
              ...s.chip,
              ...(on ? { background: (o.color || theme.primary) + "14", borderColor: o.color || theme.primary, color: theme.text } : {}),
            }}
          >
            <span style={{ ...s.check, ...(on ? { background: o.color || theme.primary, borderColor: o.color || theme.primary } : {}) }}>
              {on ? "✓" : ""}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const s = {
  wrap: { display: "flex", flexWrap: "wrap", gap: 8 },
  chip: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    borderWidth: 1, borderStyle: "solid", borderColor: theme.border,
    background: "#fff",
    color: theme.muted,
    padding: "7px 12px",
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  check: {
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 1.5, borderStyle: "solid", borderColor: "#d1d5e4",
    display: "grid",
    placeItems: "center",
    color: "#fff",
    fontSize: 10,
  },
};
