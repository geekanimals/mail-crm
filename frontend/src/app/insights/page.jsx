"use client";

// Overview: latest period vs previous period
import { useState } from "react";
import PageHeader from "@/components/insights/PageHeader";
import FilterBar from "@/components/insights/FilterBar";
import HeroBanner from "@/components/insights/HeroBanner";
import StatCard from "@/components/insights/StatCard";
import Card from "@/components/insights/Card";
import LineChart from "@/components/insights/LineChart";
import BarList from "@/components/insights/BarList";
import MoversList from "@/components/insights/MoversList";
import Leaderboard from "@/components/insights/Leaderboard";
import Select from "@/components/insights/Select";
import Tabs from "@/components/insights/Tabs";
import CompareBars from "@/components/insights/CompareBars";
import UpDownChart from "@/components/insights/UpDownChart";
import MissingNote from "@/components/insights/MissingNote";
import { useData } from "@/components/insights/DataProvider";
import {
  accountChanges, breakdown, comboChanges, endOf, filterRows, groupCompare, groupSeries,
  likeForLike, listWeeks, movers, periodTotals, totalSeries,
} from "@/lib/insights/calc";
import { CORE_METRICS, METRICS, PLATFORM_COLORS, metricOf } from "@/lib/insights/constants";
import { fmtRange } from "@/lib/insights/format";

export default function OverviewPage() {
  const { rows, accountColors } = useData();
  const [filters, setFilters] = useState({ account: "All", platform: "All" });
  const [metric, setMetric] = useState("views");
  const [by, setBy] = useState("platform");

  const data = filterRows(rows, filters);
  const weeks = listWeeks(data);
  const cur = weeks.at(-1);
  const prev = weeks.at(-2) || cur;
  const curLabel = fmtRange(cur, endOf(data, cur));
  const prevLabel = fmtRange(prev, endOf(data, prev));

  // Comparisons use only pairs uploaded for the current week; the trend chart keeps full history
  const { rows: cmp, missing } = likeForLike(data, "week", prev, cur);
  const curT = periodTotals(cmp, "week", cur);
  const prevT = periodTotals(cmp, "week", prev);
  const extra = METRICS.filter((m) => !m.core && (curT[m.key] || prevT[m.key]));
  const trend = groupSeries(data, "platform", metric);
  const { gainers, losers } = movers(comboChanges(cmp, "week", prev, cur), metric);
  const label = metricOf(metric).full;
  const curCount = cmp.filter((r) => r.week === cur).length;

  if (!cur) {
    return <PageHeader eyebrow="Dashboard" title="Overview" subtitle="No data yet — start from Upload Data" />;
  }

  return (
    <>
      <PageHeader eyebrow="Dashboard" title="Overview" subtitle={`${curLabel} vs ${prevLabel}`}>
        <FilterBar filters={filters} setFilters={setFilters} />
      </PageHeader>

      <MissingNote missing={missing} periodLabel={curLabel} />

      <HeroBanner rangeLabel={curLabel} prevLabel={prevLabel} cur={curT} prev={prevT} entries={curCount} />

      <div style={s.stats}>
        {CORE_METRICS.map((m) => (
          <StatCard key={m.key} metric={m.key} prev={prevT[m.key]} cur={curT[m.key]} prevLabel="Previous" trend={totalSeries(data, m.key)} />
        ))}
      </div>

      {extra.length > 0 && (
        <div style={s.extra}>
          {extra.map((m) => (
            <StatCard key={m.key} compact metric={m.key} prev={prevT[m.key]} cur={curT[m.key]} prevLabel="Previous" />
          ))}
        </div>
      )}

      <Card
        title={`${label} — weekly trend`}
        subtitle="By platform · hover a point to see exact numbers"
        right={<Select value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.key, label: m.full }))} />}
      >
        <LineChart labels={trend.labels} series={trend.series} colors={PLATFORM_COLORS} metric={metric} />
      </Card>

      <div style={s.grid}>
        <Card
          title="Last week vs this week"
          subtitle={`${label} · ${prevLabel} → ${curLabel}`}
          right={
            <Tabs
              value={by}
              onChange={setBy}
              options={[
                { value: "platform", label: "Platform" },
                { value: "account", label: "Account" },
              ]}
            />
          }
        >
          <CompareBars
            items={groupCompare(cmp, by, "week", prev, cur, metric)}
            colors={by === "platform" ? PLATFORM_COLORS : accountColors}
            metric={metric}
            prevLabel={prevLabel}
            curLabel={curLabel}
          />
        </Card>
        <Card title="What went up / down" subtitle={`${label} · % change per account and platform`}>
          <UpDownChart list={comboChanges(cmp, "week", prev, cur)} metric={metric} />
        </Card>
      </div>

      <div style={s.grid}>
        <Card title="📈 Top gainers" subtitle={label}>
          <MoversList items={gainers} metric={metric} emptyText="Nothing grew this period" />
        </Card>
        <Card title="📉 Top decliners" subtitle={label}>
          <MoversList items={losers} metric={metric} emptyText="Nothing declined this period" />
        </Card>
      </div>

      <div style={s.grid}>
        <Card title="🏆 Account leaderboard" subtitle={`${label} · ${curLabel}`}>
          <Leaderboard list={accountChanges(cmp, "week", prev, cur)} metric={metric} colors={accountColors} />
        </Card>
        <Card title="Platform share" subtitle={`${label} · ${curLabel}`}>
          <BarList items={breakdown(data, cur, "platform", metric)} colors={PLATFORM_COLORS} metric={metric} />
        </Card>
      </div>
    </>
  );
}

const s = {
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(230px, 100%), 1fr))", gap: 16, marginBottom: 16 },
  extra: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(190px, 100%), 1fr))", gap: 12, marginBottom: 16 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 16, marginTop: 16 },
};
