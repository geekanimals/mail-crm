"use client";

// Banner shown while data loads or when the backend can't be reached
import { useData } from "@/components/insights/DataProvider";
import { theme } from "@/lib/insights/constants";

export default function ServerStatus() {
  const { status, error, reload } = useData();

  if (status === "loading") return <div style={{ ...s.bar, ...s.loading }}>Loading data…</div>;
  if (status !== "error") return null;

  return (
    <div style={{ ...s.bar, ...s.error }}>
      <span>⚠ {error}</span>
      <button type="button" onClick={reload} style={s.btn}>Retry</button>
    </div>
  );
}

const s = {
  bar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600, marginBottom: 18, flexWrap: "wrap" },
  loading: { background: theme.primarySoft, color: theme.primary },
  error: { background: theme.redSoft, color: theme.red },
  btn: { border: "none", background: theme.red, color: "#fff", padding: "6px 14px", borderRadius: 9, fontWeight: 700, cursor: "pointer" },
};
