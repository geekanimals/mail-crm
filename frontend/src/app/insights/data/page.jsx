"use client";

// All Data: every saved entry, choose columns, export CSV, delete
import { useState } from "react";
import PageHeader from "@/components/insights/PageHeader";
import FilterBar from "@/components/insights/FilterBar";
import Card from "@/components/insights/Card";
import ChipToggle from "@/components/insights/ChipToggle";
import { useData } from "@/components/insights/DataProvider";
import { filterRows, toCSV } from "@/lib/insights/calc";
import { CORE_METRICS, METRICS, PLATFORM_COLORS, theme } from "@/lib/insights/constants";
import { fmtMetric, fmtRange } from "@/lib/insights/format";

export default function DataPage() {
  const { rows, removeRow, reload } = useData();
  const [filters, setFilters] = useState({ account: "All", platform: "All" });
  const [cols, setCols] = useState(CORE_METRICS.map((m) => m.key));
  const [confirm, setConfirm] = useState(""); // key waiting for 2nd click
  const [error, setError] = useState("");

  const remove = async (r) => {
    try {
      await removeRow(r);
      setConfirm("");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };

  const list = filterRows(rows, filters).sort(
    (a, b) => b.week.localeCompare(a.week) || a.account.localeCompare(b.account) || a.platform.localeCompare(b.platform)
  );
  const keyOf = (r) => r.week + r.account + r.platform;
  const shown = METRICS.filter((m) => cols.includes(m.key));

  const exportCSV = () => {
    const url = URL.createObjectURL(new Blob([toCSV(list)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "insights-data.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader eyebrow="Data" title="All Data" subtitle={`${list.length} entries across all periods, accounts and platforms`}>
        <FilterBar filters={filters} setFilters={setFilters} />
      </PageHeader>

      <Card
        title="Saved entries"
        subtitle="Choose columns · uploading the same dates again replaces the entry"
        right={
          <div style={s.actions}>
            <button type="button" onClick={exportCSV} style={s.btn}>⇩ Export CSV</button>
            <button type="button" onClick={reload} style={s.btnGhost}>
              ↻ Refresh
            </button>
          </div>
        }
      >
        {error && <div style={s.error}>⚠ {error}</div>}
        <div style={{ marginBottom: 16 }}>
          <ChipToggle value={cols} onChange={setCols} options={METRICS.map((m) => ({ value: m.key, label: m.label, color: m.color }))} />
        </div>

        <div style={s.scroll}>
          <table style={s.table}>
            <thead>
              <tr>
                {["Period", "Account", "Platform"].map((h) => (
                  <th key={h} style={{ ...s.th, textAlign: "left" }}>{h}</th>
                ))}
                {shown.map((m) => (
                  <th key={m.key} style={s.th}>{m.label}</th>
                ))}
                <th style={s.th} />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={keyOf(r)}>
                  <td style={{ ...s.td, textAlign: "left", color: theme.muted }}>{fmtRange(r.week, r.end)}</td>
                  <td style={{ ...s.td, textAlign: "left", fontWeight: 650 }}>{r.account}</td>
                  <td style={{ ...s.td, textAlign: "left" }}>
                    <span style={{ ...s.dot, background: PLATFORM_COLORS[r.platform] }} />
                    {r.platform}
                  </td>
                  {shown.map((m) => (
                    <td key={m.key} style={s.td}>{fmtMetric(m.key, r[m.key])}</td>
                  ))}
                  <td style={s.td}>
                    <button
                      type="button"
                      onClick={() => (confirm === keyOf(r) ? remove(r) : setConfirm(keyOf(r)))}
                      style={{ ...s.del, ...(confirm === keyOf(r) ? s.danger : {}) }}
                    >
                      {confirm === keyOf(r) ? "Confirm?" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <div style={s.empty}>No entries found</div>}
        </div>
      </Card>
    </>
  );
}

const s = {
  actions: { display: "flex", gap: 8 },
  btn: { background: theme.gradient, color: "#fff", border: "none", padding: "9px 14px", borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  btnGhost: { borderWidth: 1, borderStyle: "solid", borderColor: theme.border, background: "#fff", color: theme.text, padding: "9px 14px", borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  danger: { background: theme.redSoft, color: theme.red, borderColor: "#fecdd3" },
  scroll: { overflowX: "auto", margin: "0 -22px", padding: "0 22px" },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 },
  th: {
    padding: "11px 14px",
    color: theme.faint,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    background: "#fafbfe",
    borderBottom: `1px solid ${theme.border}`,
    whiteSpace: "nowrap",
    textAlign: "right",
  },
  td: { padding: "11px 14px", borderBottom: `1px solid ${theme.border}`, textAlign: "right", color: theme.text, whiteSpace: "nowrap" },
  dot: { display: "inline-block", width: 8, height: 8, borderRadius: 999, marginRight: 8 },
  del: { borderWidth: 1, borderStyle: "solid", borderColor: theme.border, background: "#fff", color: theme.muted, padding: "5px 11px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  error: { background: theme.redSoft, color: theme.red, padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 14 },
  empty: { padding: 30, textAlign: "center", color: theme.muted },
};
