"use client";

// All Data: every saved entry, choose columns, export CSV, delete (one row, ticked rows, a whole week, or everything shown).
// Nothing is deleted automatically — only after the user confirms.
import { useState } from "react";
import PageHeader from "@/components/insights/PageHeader";
import FilterBar from "@/components/insights/FilterBar";
import Card from "@/components/insights/Card";
import ChipToggle from "@/components/insights/ChipToggle";
import { useData } from "@/components/insights/DataProvider";
import { filterRows, toCSV } from "@/lib/insights/calc";
import { CORE_METRICS, PLATFORM_COLORS, metricsFor, theme } from "@/lib/insights/constants";
import { fmtMetric, fmtRange } from "@/lib/insights/format";

export default function DataPage() {
  const { rows, removeRow, removeRows, reload } = useData();
  const [filters, setFilters] = useState({ account: "All", platform: "All" });
  const [cols, setCols] = useState(CORE_METRICS.map((m) => m.key));
  const [confirm, setConfirm] = useState(""); // key waiting for 2nd click
  const [error, setError] = useState("");
  const [picked, setPicked] = useState([]); // ticked entry ids
  const [weekPick, setWeekPick] = useState("");
  const [ask, setAsk] = useState(null); // { ids, what } waiting for "Yes, delete"
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

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
  const listIds = list.map((r) => r.id);
  const pickedNow = picked.filter((id) => listIds.includes(id)); // only rows still on screen
  const allTicked = list.length > 0 && pickedNow.length === list.length;
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleAll = () => setPicked(allTicked ? [] : listIds);

  // weeks that have data (newest first) for "Delete a week"
  const weeks = [...new Set(rows.map((r) => r.week))].sort().reverse();
  const week = weeks.includes(weekPick) ? weekPick : weeks[0] || "";
  const weekRows = rows.filter((r) => r.week === week);
  const weekLabel = week ? fmtRange(week, weekRows[0]?.end) : "";
  const filtered = filters.account !== "All" || filters.platform !== "All";

  const startDelete = (ids, what) => {
    setDone("");
    setError("");
    setAsk({ ids, what });
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      const n = await removeRows(ask.ids);
      setDone(`Deleted ${n} entr${n === 1 ? "y" : "ies"} (${ask.what}). You can upload that data again any time.`);
      setPicked([]);
      setAsk(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const shown = metricsFor(filters.platform).filter((m) => cols.includes(m.key));

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
        {done && <div style={s.done}>✓ {done}</div>}

        {/* delete many: ticked rows · everything shown · one whole week */}
        <div style={s.bulk}>
          <span style={s.bulkTitle}>Delete data</span>
          <button type="button" disabled={!pickedNow.length || busy} onClick={() => startDelete(pickedNow, `${pickedNow.length} selected`)} style={{ ...s.bulkBtn, ...(!pickedNow.length ? s.off : {}) }}>
            Delete selected ({pickedNow.length})
          </button>
          <button type="button" disabled={!list.length || busy} onClick={() => startDelete(listIds, filtered ? `all shown: ${filters.account} · ${filters.platform}` : "all entries")} style={{ ...s.bulkBtn, ...(!list.length ? s.off : {}) }}>
            Delete all shown ({list.length})
          </button>
          <span style={s.bulkSep} />
          <select value={week} onChange={(e) => setWeekPick(e.target.value)} style={s.select} aria-label="Week to delete">
            {weeks.map((w) => {
              const r = rows.find((x) => x.week === w);
              return <option key={w} value={w}>{fmtRange(w, r?.end)} ({rows.filter((x) => x.week === w).length})</option>;
            })}
          </select>
          <button type="button" disabled={!weekRows.length || busy} onClick={() => startDelete(weekRows.map((r) => r.id), `week ${weekLabel}, all companies`)} style={{ ...s.bulkBtn, ...(!weekRows.length ? s.off : {}) }}>
            Delete this week ({weekRows.length})
          </button>
        </div>

        {ask && (
          <div style={s.ask}>
            <div>
              <b>Delete {ask.ids.length} entr{ask.ids.length === 1 ? "y" : "ies"} — {ask.what}?</b>
              <div style={s.askText}>They will be removed from the database and can&apos;t be brought back. You can upload the files for those dates again afterwards.</div>
            </div>
            <div style={s.askBtns}>
              <button type="button" onClick={() => setAsk(null)} disabled={busy} style={s.btnGhost}>Cancel</button>
              <button type="button" onClick={confirmDelete} disabled={busy} style={s.yes}>{busy ? "Deleting…" : "Yes, delete"}</button>
            </div>
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <ChipToggle value={cols} onChange={setCols} options={metricsFor(filters.platform).map((m) => ({ value: m.key, label: m.label, color: m.color }))} />
        </div>

        <div style={s.scroll}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, width: 36, textAlign: "center" }}>
                  <input type="checkbox" checked={allTicked} onChange={toggleAll} aria-label="Select all shown" style={s.check} />
                </th>
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
                <tr key={keyOf(r)} style={picked.includes(r.id) ? s.rowPicked : undefined}>
                  <td style={{ ...s.td, textAlign: "center" }}>
                    <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.account} ${r.platform} ${r.week}`} style={s.check} />
                  </td>
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
  btnGhost: { borderWidth: 1, borderStyle: "solid", borderColor: theme.border, background: theme.glassSoft, color: theme.text, padding: "9px 14px", borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 600 },
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
    background: "rgba(255,255,255,0.35)",
    borderBottom: `1px solid ${theme.border}`,
    whiteSpace: "nowrap",
    textAlign: "right",
  },
  td: { padding: "11px 14px", borderBottom: `1px solid ${theme.border}`, textAlign: "right", color: theme.text, whiteSpace: "nowrap" },
  dot: { display: "inline-block", width: 8, height: 8, borderRadius: 999, marginRight: 8 },
  del: { borderWidth: 1, borderStyle: "solid", borderColor: theme.border, background: theme.glassSoft, color: theme.muted, padding: "5px 11px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  error: { background: theme.redSoft, color: theme.red, padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 14 },
  empty: { padding: 30, textAlign: "center", color: theme.muted },
  done: { background: theme.greenSoft, color: theme.green, padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 14 },
  bulk: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderRadius: 14, background: "rgba(225,29,72,0.04)", border: "1px solid rgba(225,29,72,0.12)", marginBottom: 14 },
  bulkTitle: { fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: theme.red, marginRight: 4 },
  bulkBtn: { borderWidth: 1, borderStyle: "solid", borderColor: "#fecdd3", background: theme.glassSoft, color: theme.red, padding: "7px 12px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" },
  off: { opacity: 0.45, cursor: "not-allowed" },
  bulkSep: { width: 1, height: 22, background: "rgba(225,29,72,0.15)", margin: "0 4px" },
  select: { padding: "7px 10px", borderRadius: 10, borderWidth: 1, borderStyle: "solid", borderColor: theme.border, background: theme.glassSoft, fontSize: 12.5, color: theme.text, fontFamily: "inherit", maxWidth: 230 },
  ask: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", background: theme.redSoft, color: "#9f1239", borderRadius: 14, padding: "12px 16px", marginBottom: 14, fontSize: 13.5 },
  askText: { fontSize: 12.5, marginTop: 2, color: "#9f1239", opacity: 0.85 },
  askBtns: { display: "flex", gap: 8 },
  yes: { background: theme.red, color: "#fff", border: "none", padding: "9px 14px", borderRadius: 11, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  check: { width: 16, height: 16, accentColor: "#2d6a5f", cursor: "pointer" },
  rowPicked: { background: "rgba(45,106,95,0.07)" },
};
