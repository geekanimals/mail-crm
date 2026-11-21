"use client";

// Upload: company + platform + start/end dates → drop export files → check all numbers → save
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import PageHeader from "@/components/insights/PageHeader";
import Card from "@/components/insights/Card";
import Select from "@/components/insights/Select";
import CompanyPicker from "@/components/insights/CompanyPicker";
import DateRange from "@/components/insights/DateRange";
import DropZone from "@/components/insights/DropZone";
import NumberField from "@/components/insights/NumberField";
import { useData } from "@/components/insights/DataProvider";
import { api } from "@/lib/insights/api";
import { presets, todayISO } from "@/lib/insights/dates";
import { DEFAULT_ACCOUNTS, METRICS, PLATFORMS, PLATFORM_COLORS, metricOf, theme } from "@/lib/insights/constants";
import { fmtFull, fmtRange } from "@/lib/insights/format";

const EMPTY = Object.fromEntries(METRICS.map((m) => [m.key, ""]));
const GROUPS = ["Reach", "Engagement", "Audience", "Content", "Money"];
const noop = () => () => {};
const lastWeek = () => {
  const p = presets(todayISO())[0];
  return p.start + "|" + p.end; // string = stable snapshot
};

const HELP = {
  Facebook: "Meta Business Suite → Insights → Export: Views, Viewers, Interactions, Follows, Visits, Link clicks",
  Instagram: "Meta Business Suite → Insights → Export (Instagram): Views, Reach, Interactions, Follows, Visits, Link clicks",
  LinkedIn: "Company page: Analytics → Export (.xls). Personal profile: Analytics → Export (AggregateAnalytics .xlsx)",
  "X / Twitter": "Drop the weekly summary sheet (Week starting, Platform, Account, Views, Likes, Followers) — every week in it is saved — or type the numbers",
  YouTube: "YouTube Studio → Analytics → Advanced mode → Export (Table data + Totals)",
};

export default function UploadPage() {
  const { rows, upsertRow, saveRows } = useData();
  const [account, setAccount] = useState(DEFAULT_ACCOUNTS[0]);
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [picked, setPicked] = useState(null);
  const [files, setFiles] = useState([]);
  const [vals, setVals] = useState(EMPTY);
  const [auto, setAuto] = useState([]);
  const [report, setReport] = useState([]);
  const [detected, setDetected] = useState(null);
  const [saved, setSaved] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [weekly, setWeekly] = useState([]); // rows from summary sheets
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Default = last week (computed only in the browser)
  const def = useSyncExternalStore(noop, lastWeek, () => "|");
  const range = picked || { start: def.split("|")[0], end: def.split("|")[1] };
  const validRange = range.start && range.end && range.end >= range.start;

  const prevRow = rows
    .filter((r) => r.account === account && r.platform === platform && r.week < range.start)
    .sort((a, b) => b.week.localeCompare(a.week))[0];
  const exists = rows.find((r) => r.account === account && r.platform === platform && r.week === range.start);

  // Send files to the backend for the given range and fill the form
  const runParse = async (list, r) => {
    setBusy(true);
    setError("");
    try {
      const res = await api.preview(list, { account, platform, week: r.start, end: r.end });
      const next = { ...EMPTY, ...Object.fromEntries(Object.entries(vals).filter(([k]) => !auto.includes(k))) };
      Object.entries(res.values).forEach(([k, v]) => k in next && (next[k] = String(Math.round(v * 100) / 100)));
      setVals(next);
      setAuto(Object.keys(res.values));
      setReport(
        res.report.map((f) => ({
          name: f.name,
          ok: f.ok,
          msg: (f.format ? f.format + " · " : "") + (f.found.length ? "Found: " + f.found.map((k) => metricOf(k)?.label || k).join(", ") : f.message),
        }))
      );
      setDetected(res.detected);
      setWarnings(res.warnings);
      setWeekly(res.rows || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onFiles = (list) => {
    const all = [...files.filter((f) => !list.some((n) => n.name === f.name)), ...list];
    setFiles(all);
    setSaved("");
    runParse(all, range);
  };

  const onRange = (r) => {
    setPicked(r);
    setSaved("");
    if (files.length && r.start && r.end && r.end >= r.start) runParse(files, r);
  };

  const set = (k) => (v) => {
    const next = { ...vals, [k]: v };
    if (k === "newFollowers" && prevRow && v !== "") next.followers = String(prevRow.followers + Number(v));
    setVals(next);
    setAuto(auto.filter((a) => a !== k));
    setSaved("");
  };

  const clear = () => {
    setFiles([]);
    setVals(EMPTY);
    setAuto([]);
    setReport([]);
    setDetected(null);
    setSaved("");
    setWarnings([]);
    setWeekly([]);
    setError("");
  };

  const canSave = !busy && validRange && vals.views !== "" && vals.followers !== "";

  const save = async () => {
    const row = { week: range.start, end: range.end, account, platform, sourceFiles: files.map((f) => f.name) };
    METRICS.forEach((m) => (row[m.key] = Number(vals[m.key]) || 0));
    setBusy(true);
    try {
      const res = await upsertRow(row);
      clear();
      setSaved(`${account} · ${platform} · ${fmtRange(range.start, range.end)} ${res.replaced ? "updated" : "saved"} ✓`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Save every week found in a summary sheet (e.g. X / Twitter)
  const saveWeekly = async () => {
    setBusy(true);
    try {
      const res = await saveRows(weekly);
      clear();
      setSaved(`${res.saved} weekly rows saved ✓` + (res.errors.length ? ` · ${res.errors.length} skipped (${res.errors[0].message})` : ""));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Data" title="Upload Data" subtitle="Choose company, platform and dates → drop the export files → numbers fill in automatically" />

      <Card title="1. Whose data, and for which dates?" subtitle="For files with daily data, only days inside this range are counted">
        <div style={s.row}>
          <CompanyPicker value={account} onChange={(v) => (setAccount(v), clear())} />
          <Select label="Platform" value={platform} onChange={(v) => (setPlatform(v), clear())} options={PLATFORMS} />
        </div>
        <div style={s.divider} />
        <DateRange start={range.start} end={range.end} onChange={onRange} detected={detected} />
        {detected && (
          <div style={s.info}>📅 Files contain data for {fmtRange(detected.start, detected.end)}</div>
        )}
        {warnings.map((w) => (
          <div key={w} style={s.warn}>⚠ {w}{w.includes("no data") ? " — click “Use file dates” or change the dates." : ""}</div>
        ))}
        {exists && (
          <div style={s.warn}>
            ⚠ {fmtRange(exists.week, exists.end)} · {account} · {platform} already exists — saving will replace it.
          </div>
        )}
      </Card>

      <div style={s.grid}>
        <Card
          title="2. Drop export files"
          subtitle={HELP[platform]}
          right={<span style={{ ...s.pill, background: PLATFORM_COLORS[platform] }}>{platform}</span>}
        >
          <DropZone onFiles={onFiles} compact={platform === "X / Twitter"} />
          {busy && <div style={s.busy}>Reading files…</div>}
          {error && <div style={s.errorBox}>⚠ {error}</div>}

          {report.length > 0 && (
            <div style={s.report}>
              {report.map((r) => (
                <div key={r.name} style={s.file}>
                  <span style={{ ...s.status, background: r.ok ? theme.greenSoft : "#fef3c7", color: r.ok ? theme.green : "#b45309" }}>
                    {r.ok ? "✓" : "!"}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={s.fileName}>{r.name}</div>
                    <div style={s.fileMsg}>{r.msg}</div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={clear} style={s.linkBtn}>Remove all files</button>
            </div>
          )}

          {weekly.length > 0 && (
            <div style={s.weekly}>
              <div style={s.weeklyTitle}>{weekly.length} weekly rows found — saved as they are in the sheet</div>
              <div style={s.weeklyScroll}>
                <table style={s.table}>
                  <thead>
                    <tr>{["Week", "Account", "Platform", "Views", "Likes", "Followers"].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {weekly.map((w) => (
                      <tr key={w.week + w.account + w.platform}>
                        <td style={s.td}>{fmtRange(w.week, w.end)}</td>
                        <td style={s.td}>{w.account}</td>
                        <td style={s.td}>{w.platform}</td>
                        <td style={s.td}>{fmtFull(w.views)}</td>
                        <td style={s.td}>{fmtFull(w.likes)}</td>
                        <td style={s.td}>{fmtFull(w.followers)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={saveWeekly} disabled={busy} style={{ ...s.btn, marginTop: 12, ...(busy ? s.btnOff : {}) }}>
                Save all {weekly.length} rows
              </button>
            </div>
          )}
        </Card>

        <Card title="3. Review the numbers" subtitle="Green fields came from your files — you can edit any number">
          {GROUPS.map((g) => (
            <div key={g} style={s.group}>
              <div style={s.groupTitle}>{g}</div>
              <div style={s.fields}>
                {METRICS.filter((m) => m.group === g).map((m) => (
                  <NumberField
                    key={m.key}
                    label={m.full}
                    icon={m.icon}
                    color={m.color}
                    value={vals[m.key]}
                    onChange={set(m.key)}
                    auto={auto.includes(m.key)}
                    step={m.money || m.key === "watchTime" ? "0.01" : "1"}
                    hint={
                      m.key === "followers"
                        ? prevRow
                          ? `Previous total (${fmtRange(prevRow.week, prevRow.end)}): ${fmtFull(prevRow.followers)} · auto-filled from New Followers`
                          : "No previous data — enter the total manually"
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ))}

          <div style={s.footer}>
            <div style={s.summary}>
              {account} · {platform}
              <br />
              <b>{validRange ? fmtRange(range.start, range.end) : "Choose dates"}</b>
            </div>
            <button type="button" onClick={clear} style={s.btnGhost}>Clear</button>
            <button type="button" onClick={save} disabled={!canSave} style={{ ...s.btn, ...(canSave ? {} : s.btnOff) }}>
              Save data
            </button>
          </div>
          {!canSave && <div style={s.needs}>Valid dates, Views and Total Followers are required to save</div>}

          {saved && (
            <div style={s.success}>
              {saved}
              <div style={{ marginTop: 8 }}>
                <Link href="/insights" style={s.link}>View Overview →</Link>
                <Link href="/insights/compare" style={{ ...s.link, marginLeft: 18 }}>Compare →</Link>
                <Link href="/insights/data" style={{ ...s.link, marginLeft: 18 }}>All Data →</Link>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

const s = {
  row: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 260px))", gap: 14 },
  divider: { height: 1, background: theme.border, margin: "20px 0" },
  info: { marginTop: 14, background: "#f0fdf4", color: "#166534", padding: "10px 14px", borderRadius: 12, fontSize: 13, fontWeight: 500 },
  warn: { marginTop: 12, background: "#fffbeb", color: "#92400e", padding: "10px 14px", borderRadius: 12, fontSize: 13, border: "1px solid #fde68a" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(440px, 100%), 1fr))", gap: 16, marginTop: 16, alignItems: "start" },
  pill: { color: "#fff", fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 999 },
  report: { marginTop: 16, display: "flex", flexDirection: "column", gap: 8 },
  file: { display: "flex", gap: 10, alignItems: "center", padding: "9px 12px", background: "#fafbfe", border: `1px solid ${theme.border}`, borderRadius: 12 },
  status: { width: 26, height: 26, borderRadius: 999, display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 },
  fileName: { fontSize: 13, fontWeight: 650, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fileMsg: { fontSize: 12, color: theme.muted },
  busy: { marginTop: 12, fontSize: 13, color: theme.primary, fontWeight: 600 },
  errorBox: { marginTop: 12, background: theme.redSoft, color: theme.red, padding: "10px 14px", borderRadius: 12, fontSize: 13, fontWeight: 600 },
  weekly: { marginTop: 18, paddingTop: 16, borderTop: `1px solid ${theme.border}` },
  weeklyTitle: { fontSize: 13, fontWeight: 700, color: theme.text, marginBottom: 10 },
  weeklyScroll: { overflowX: "auto", maxHeight: 260, overflowY: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 },
  th: { textAlign: "left", padding: "7px 8px", color: theme.faint, fontSize: 11, textTransform: "uppercase", borderBottom: `1px solid ${theme.border}`, whiteSpace: "nowrap" },
  td: { padding: "7px 8px", borderBottom: `1px solid ${theme.border}`, whiteSpace: "nowrap" },
  linkBtn: { alignSelf: "flex-end", border: "none", background: "none", color: theme.red, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 4 },
  group: { marginBottom: 18 },
  groupTitle: { fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: theme.faint, marginBottom: 10 },
  fields: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))", gap: 12 },
  footer: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8, paddingTop: 18, borderTop: `1px solid ${theme.border}` },
  summary: { flex: "1 1 160px", fontSize: 12.5, color: theme.muted, lineHeight: 1.5 },
  btn: {
    background: theme.gradient,
    color: "#fff",
    border: "none",
    padding: "12px 22px",
    borderRadius: 12,
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    boxShadow: "0 10px 20px -10px rgba(50,193,223,0.9)",
  },
  btnOff: { opacity: 0.4, cursor: "not-allowed", boxShadow: "none" },
  btnGhost: { background: "#fff", color: theme.text, border: `1px solid ${theme.border}`, padding: "12px 18px", borderRadius: 12, fontWeight: 600, fontSize: 14, cursor: "pointer" },
  needs: { textAlign: "right", fontSize: 12, color: theme.faint, marginTop: 8 },
  success: { marginTop: 16, background: theme.greenSoft, color: "#166534", padding: "14px 16px", borderRadius: 12, fontSize: 13.5, fontWeight: 600 },
  link: { color: "#166534", fontWeight: 700 },
};
