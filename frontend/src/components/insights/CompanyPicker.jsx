"use client";

// Company dropdown with "+ Add new company" option
import { useState } from "react";
import Select from "./Select";
import { useData } from "@/components/insights/DataProvider";
import { theme } from "@/lib/insights/constants";

const ADD = "__add_new__";

export default function CompanyPicker({ value, onChange }) {
  const { accounts, addAccount } = useData();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) return;
    try {
      onChange(await addAccount(name));
      setName("");
      setAdding(false);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };

  if (adding) {
    return (
      <div style={s.wrap}>
        <span style={s.label}>New company / team</span>
        <div style={s.row}>
          <input
            autoFocus
            value={name}
            placeholder="Company or team name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setAdding(false);
            }}
            style={s.input}
          />
          <button type="button" onClick={save} disabled={!name.trim()} style={{ ...s.add, ...(name.trim() ? {} : s.off) }}>
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} style={s.cancel}>
            Cancel
          </button>
        </div>
        {error && <span style={s.error}>{error}</span>}
      </div>
    );
  }

  return (
    <Select
      label="Company / Account"
      value={value}
      onChange={(v) => (v === ADD ? setAdding(true) : onChange(v))}
      options={[...accounts, { value: ADD, label: "+ Add new company" }]}
    />
  );
}

const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 11, fontWeight: 700, color: theme.faint, textTransform: "uppercase", letterSpacing: 0.8 },
  row: { display: "flex", gap: 6 },
  input: {
    flex: 1,
    minWidth: 0,
    padding: "10px 12px",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: theme.primary,
    fontSize: 14,
    outline: "none",
    boxShadow: "0 0 0 3px rgba(45,106,95,0.15)",
  },
  add: { background: theme.gradient, color: "#fff", border: "none", borderRadius: 10, padding: "0 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  off: { opacity: 0.4, cursor: "not-allowed" },
  error: { fontSize: 12, color: theme.red },
  cancel: { background: theme.glassSoft, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "0 10px", fontSize: 13, color: theme.muted, cursor: "pointer" },
};
