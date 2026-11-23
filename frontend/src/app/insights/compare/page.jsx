"use client";

// Compare any two weeks or two months
import { useState } from "react";
import PageHeader from "@/components/insights/PageHeader";
import FilterBar from "@/components/insights/FilterBar";
import StatCard from "@/components/insights/StatCard";
import Card from "@/components/insights/Card";
import ChangeTable from "@/components/insights/ChangeTable";
import ChipToggle from "@/components/insights/ChipToggle";
import Select from "@/components/insights/Select";
import Tabs from "@/components/insights/Tabs";
import CompareBars from "@/components/insights/CompareBars";
import UpDownChart from "@/components/insights/UpDownChart";
import ColumnCompare from "@/components/insights/ColumnCompare";
import MissingNote from "@/components/insights/MissingNote";
import { useData } from "@/components/insights/DataProvider";
import { comboChanges, endOf, filterRows, groupCompare, likeForLike, listPeriods, periodTotals } from "@/lib/insights/calc";
import { CORE_METRICS, METRICS, PLATFORM_COLORS, metricOf, theme } from "@/lib/insights/constants";
import { fmtDate, fmtRange } from "@/lib/insights/format";

export default function ComparePage() {
  const { rows, accountColors } = useData();
  const [filters, setFilters] = useState({ account: "All", platform: "All" });
  const [mode, setMode] = useState("week");
  const [prevPick, setPrev] = useState("");
  const [curPick, setCur] = useState("");
  const [cols, setCols] = useState(CORE_METRICS.map((m) => m.key));
  const [metric, setMetric] = useState("views");
  const [by, setBy] = useState("platform");

  const data = filterRows(rows, filters);
  const periods = listPeriods(rows, mode);

  // Default: last two periods (used until the user picks something valid)
  const cur = periods.includes(curPick) ? curPick : periods.at(-1) || "";
  const prev = periods.includes(prevPick) ? prevPick : periods.at(-2) || periods.at(-1) || "";

  const changeMode = (m) => {
    setMode(m);
    setPrev("");
    setCur("");
  };

  const label = (p) => (mode === "week" ? fmtRange(p, endOf(rows, p)) : fmtDate(p));
  const options = [...periods].reverse().map((p) => ({ value: p, label: label(p) }));
  // Only pairs uploaded for the current period are compared (missing ones are listed above)
  const { rows: cmp, missing } = likeForLike(data, mode, prev, cur);
  const prevT = periodTotals(cmp, mode, prev);
  const curT = periodTotals(cmp, mode, cur);
  const word = mode === "week" ? "week" : "month";
  const shownMetrics = METRICS.filter((m) => cols.includes(m.key));

  return (
    <>
      <PageHeader eyebrow="Analytics" title="Compare" subtitle="Pick any two weeks or months to compare">
        <FilterBar filters={filters} setFilters={setFilters} />
      </PageHeader>

      <Card style={{ marginBottom: 18 }}>
        <div style={s.pickers}>
          <Tabs
            value={mode}
            onChange={changeMode}
            options={[
              { value: "week", label: "Week vs Week" },
              { value: "month", label: "Month vs Month" },
            ]}
          />
          <Select label={`Previous ${word}`} value={prev} onChange={setPrev} options={options} />
          <span style={s.vs}>VS</span>
          <Select label={`Current ${word}`} value={cur} onChange={setCur} options={options} />
          <button type="button" style={s.swap} onClick={() => (setPrev(cur), setCur(prev))} title="Swap the two periods">
            ⇄ Swap
          </button>
        </div>
        {mode === "month" && (
          <p style={s.note}>Monthly values are summed across the month. Total Followers uses the latest number available in that month.</p>
        )}
      </Card>

      <MissingNote missing={missing} periodLabel={label(cur)} />

      <div style={s.stats}>
        {shownMetrics.map((m) => (
          <StatCard key={m.key} compact={!m.core} metric={m.key} prev={prevT[m.key]} cur={curT[m.key]} prevLabel={label(prev)} />
        ))}
      </div>

      <Card
        title="Who went up, who dropped"
        subtitle={`${metricOf(metric).full} for every account and platform · ${label(prev)} vs ${label(cur)} · biggest drop first`}
        right={<Select value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.key, label: m.full }))} />}
        style={{ marginBottom: 18 }}
      >
        <ColumnCompare list={comboChanges(cmp, mode, prev, cur)} metric={metric} prevLabel={label(prev)} curLabel={label(cur)} />
      </Card>

      <Card
        title={`${label(prev)} vs ${label(cur)}`}
        subtitle="Side-by-side comparison — see exactly what went up and what went down"
        right={
          <div style={s.chartControls}>
            <Select value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.key, label: m.full }))} />
            <Tabs
              value={by}
              onChange={setBy}
              options={[
                { value: "platform", label: "Platform" },
                { value: "account", label: "Account" },
              ]}
            />
          </div>
        }
        style={{ marginBottom: 18 }}
      >
        <div style={s.chartGrid}>
          <div>
            <div style={s.chartTitle}>{metricOf(metric).full} by {by}</div>
            <CompareBars
              items={groupCompare(cmp, by, mode, prev, cur, metric)}
              colors={by === "platform" ? PLATFORM_COLORS : accountColors}
              metric={metric}
              prevLabel={label(prev)}
              curLabel={label(cur)}
            />
          </div>
          <div>
            <div style={s.chartTitle}>% change per account and platform</div>
            <UpDownChart list={comboChanges(cmp, mode, prev, cur)} metric={metric} />
          </div>
        </div>
      </Card>

      <Card
        title={`Account + Platform wise: ${label(prev)} → ${label(cur)}`}
        subtitle="Choose which metrics to show in the table"
      >
        <div style={{ marginBottom: 16 }}>
          <ChipToggle value={cols} onChange={setCols} options={METRICS.map((m) => ({ value: m.key, label: m.label, color: m.color }))} />
        </div>
        <ChangeTable list={comboChanges(cmp, mode, prev, cur)} metrics={shownMetrics} />
      </Card>
    </>
  );
}

const s = {
  pickers: { display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" },
  vs: {
    marginBottom: 6,
    width: 34,
    height: 34,
    borderRadius: 999,
    background: theme.gradient,
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
    fontSize: 11,
  },
  swap: {
    border: `1px solid ${theme.border}`,
    background: theme.glassSoft,
    padding: "10px 14px",
    borderRadius: 12,
    fontWeight: 600,
    fontSize: 13,
    color: theme.text,
    cursor: "pointer",
  },
  note: { margin: "14px 0 0", fontSize: 12.5, color: theme.muted },
  chartControls: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  chartGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 28 },
  chartTitle: { fontSize: 12, fontWeight: 700, color: theme.faint, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 14, marginBottom: 18 },
};
