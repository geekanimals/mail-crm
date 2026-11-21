"use client";

// Trends: week-by-week line chart, grouped by platform or account
import { useState } from "react";
import PageHeader from "@/components/insights/PageHeader";
import FilterBar from "@/components/insights/FilterBar";
import Card from "@/components/insights/Card";
import LineChart from "@/components/insights/LineChart";
import BarList from "@/components/insights/BarList";
import Tabs from "@/components/insights/Tabs";
import Select from "@/components/insights/Select";
import { useData } from "@/components/insights/DataProvider";
import { breakdown, endOf, filterRows, groupSeries, listWeeks } from "@/lib/insights/calc";
import { METRICS, PLATFORM_COLORS, metricOf } from "@/lib/insights/constants";
import { fmtRange } from "@/lib/insights/format";

export default function TrendsPage() {
  const { rows, accountColors } = useData();
  const [filters, setFilters] = useState({ account: "All", platform: "All" });
  const [metric, setMetric] = useState("views");
  const [by, setBy] = useState("platform");

  const data = filterRows(rows, filters);
  const { labels, series } = groupSeries(data, by, metric);
  const colors = by === "platform" ? PLATFORM_COLORS : accountColors;
  const weeks = listWeeks(data);
  const [week, setWeek] = useState("");
  const shown = weeks.includes(week) ? week : weeks.at(-1);
  const label = metricOf(metric).full;
  const total = { name: "Total", values: labels.map((_, i) => series.reduce((s, sr) => s + sr.values[i], 0)) };

  return (
    <>
      <PageHeader eyebrow="Analytics" title="Trends" subtitle="Week-by-week performance — see where you grew and where you dropped">
        <FilterBar filters={filters} setFilters={setFilters} />
      </PageHeader>

      <div style={s.controls}>
        <Select label="Metric" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.key, label: m.full }))} />
        <Tabs
          value={by}
          onChange={setBy}
          options={[
            { value: "platform", label: "By platform" },
            { value: "account", label: "By account" },
          ]}
        />
      </div>

      <Card title={`${label} — by ${by === "platform" ? "platform" : "account"}`} subtitle="Each line is one platform / account">
        <LineChart labels={labels} series={series} colors={colors} metric={metric} />
      </Card>

      <Card title={`${label} — total trend`} subtitle="All combined" style={{ marginTop: 16 }}>
        <LineChart labels={labels} series={[total]} colors={{ Total: metricOf(metric).color }} metric={metric} />
      </Card>

      <div style={s.grid}>
        <Card
          title="Breakdown"
          subtitle={label}
          right={
            <Select
              value={shown || ""}
              onChange={setWeek}
              options={[...weeks].reverse().map((w) => ({ value: w, label: fmtRange(w, endOf(data, w)) }))}
            />
          }
        >
          <BarList items={breakdown(data, shown, by, metric)} colors={colors} metric={metric} />
        </Card>
      </div>
    </>
  );
}

const s = {
  controls: { display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" },
  grid: { display: "grid", gridTemplateColumns: "1fr", gap: 16, marginTop: 16 },
};
