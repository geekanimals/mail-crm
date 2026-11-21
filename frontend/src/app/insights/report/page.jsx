"use client";

// Platform Report: one company + one platform at a time.
// This week vs last week (or month vs month), every number in plain words, week-by-week bars,
// and what probably caused the change + what the team should do next.
import { useState, useSyncExternalStore } from "react";
import PageHeader from "@/components/insights/PageHeader";
import Card from "@/components/insights/Card";
import Tabs from "@/components/insights/Tabs";
import Select from "@/components/insights/Select";
import MetricScore from "@/components/insights/MetricScore";
import PeriodColumns from "@/components/insights/PeriodColumns";
import Findings from "@/components/insights/Findings";
import { useData } from "@/components/insights/DataProvider";
import { change, endOf, engagementRate, listPeriods, periodTotals } from "@/lib/insights/calc";
import { PLATFORMS, PLATFORM_COLORS, METRICS, metricOf, theme } from "@/lib/insights/constants";
import { fmtDate, fmtRange, fmtValue } from "@/lib/insights/format";
import { PLATFORM_TIPS, diagnose } from "@/lib/insights/diagnose";
import { useScreen } from "@/lib/insights/useScreen";
import { daysBetween, todayISO } from "@/lib/insights/dates";

const noop = () => () => {};
const SHEET = "Task Ledger · Data Entry";
// where a period's numbers came from: the old Task Ledger sheet or uploaded export files
const sourceOf = (rows) => (rows.length && rows.every((r) => (r.sourceFiles || []).includes(SHEET)) ? "the Task Ledger sheet" : "uploaded files");

const VERDICT = {
  up: { bg: "linear-gradient(135deg, #dcfce7, #f0fdf4)", color: "#15803d", mark: "▲" },
  down: { bg: "linear-gradient(135deg, #ffe4e6, #fff1f2)", color: "#be123c", mark: "▼" },
  mixed: { bg: "linear-gradient(135deg, #fef3c7, #fffbeb)", color: "#b45309", mark: "◆" },
  steady: { bg: "linear-gradient(135deg, rgba(50,193,223,0.16), rgba(255,255,255,0.8))", color: "#0b87a5", mark: "●" },
};

export default function ReportPage() {
  const { rows, accounts } = useData();
  const { mobile } = useScreen();
  const today = useSyncExternalStore(noop, todayISO, () => "");
  const [accountPick, setAccount] = useState("");
  const [platformPick, setPlatform] = useState("");
  const [mode, setMode] = useState("week");
  const [curPick, setCur] = useState("");
  const [metricPick, setMetric] = useState("views");

  // company → platform → periods (all derived; picks fall back to something that has data)
  const withData = accounts.filter((a) => rows.some((r) => r.account === a));
  const account = withData.includes(accountPick) ? accountPick : withData[0] || "";
  const own = rows.filter((r) => r.account === account);
  const platformsWithData = PLATFORMS.filter((p) => own.some((r) => r.platform === p));
  const platform = platformsWithData.includes(platformPick) ? platformPick : platformsWithData[0] || "";
  const combo = own.filter((r) => r.platform === platform);

  const periods = listPeriods(combo, mode);
  const cur = periods.includes(curPick) ? curPick : periods.at(-1) || "";
  const prev = periods[periods.indexOf(cur) - 1] || "";
  const label = (k) => (!k ? "" : mode === "week" ? fmtRange(k, endOf(combo, k)) : fmtDate(k));
  const word = mode === "week" ? "week" : "month";

  const curT = periodTotals(combo, mode, cur);
  const prevT = periodTotals(combo, mode, prev);
  const inPeriod = (r, k) => (mode === "week" ? r.week === k : r.week.startsWith(k));
  const prevSource = prev ? sourceOf(combo.filter((r) => inPeriod(r, prev))) : "";
  const curSource = cur ? sourceOf(combo.filter((r) => inPeriod(r, cur))) : "";
  const mixed = Boolean(prev) && prevSource !== curSource;
  // when the two periods come from different sources, only compare numbers both of them have
  // (the sheet has no Reach / Comments / Shares… — that is not a −100% drop)
  const usable = (k) => !mixed || (prevT[k] > 0 && curT[k] > 0);
  const onlyUsable = (t) => Object.fromEntries(Object.entries(t).map(([k, val]) => [k, usable(k) ? val : 0]));

  const present = METRICS.filter((m) => combo.some((r) => r[m.key] > 0));
  const compared = present.filter((m) => usable(m.key));
  const metric = present.some((m) => m.key === metricPick) ? metricPick : present[0]?.key || "views";
  const report = prev ? diagnose(onlyUsable(prevT), onlyUsable(curT), mode) : null;

  // latest period anyone uploaded for this company — warn if this platform is behind
  const latestForCompany = listPeriods(own, mode).at(-1);
  const behind = latestForCompany && cur && latestForCompany !== periods.at(-1);

  // honest notes: unfinished period, a long gap between the two periods, numbers from different sources
  const notes = [];
  if (cur && today) {
    const curEnd = mode === "week" ? endOf(combo, cur) : cur + "-31";
    if (curEnd > today) notes.push(`This ${word} isn't over yet (it ends ${mode === "week" ? fmtDate(curEnd) : "at the end of the month"}), so its numbers are still growing — a drop may just mean the ${word} is not finished.`);
  }
  if (prev && mode === "week") {
    const gap = daysBetween(prev, cur);
    // consecutive weeks are 8 days apart counting both ends; allow a day of shift between sheet and file weeks
    if (gap > 10) notes.push(`There is no data between these two weeks — "last week" here is ${label(prev)}, about ${Math.round((gap - 1) / 7)} weeks earlier. The change covers that whole gap.`);
  }
  if (mixed) {
    notes.push(`${label(prev)} comes from ${prevSource} and ${label(cur)} from ${curSource}. They count some numbers differently, so this change may not be real — compare two ${word}s from the same source. Only numbers both have are compared.`);
  }

  const history = periods.slice(0, periods.indexOf(cur) + 1).slice(-8).map((k) => ({ key: k, label: label(k), value: periodTotals(combo, mode, k)[metric] || 0 }));

  const pickCompany = (a) => {
    setAccount(a);
    setPlatform("");
    setCur("");
  };
  const pickPlatform = (p) => {
    setPlatform(p);
    setCur("");
  };
  const changeMode = (m) => {
    setMode(m);
    setCur("");
  };

  if (!withData.length) {
    return (
      <>
        <PageHeader eyebrow="Report" title="Platform Report" />
        <Card><p style={s.muted}>No data yet. Upload the first week&apos;s files on the Upload page.</p></Card>
      </>
    );
  }

  const v = report ? VERDICT[report.verdict] : VERDICT.steady;

  return (
    <>
      <PageHeader
        eyebrow="Report"
        title="Platform Report"
        subtitle="One company, one platform: what went up, what dropped, why — and what to do next."
      />

      {/* 1. pick company, platform, period */}
      <Card style={{ marginBottom: 18 }}>
        <div style={s.pickRow}>
          <span style={s.step}>1</span>
          <span style={s.pickLabel}>Company</span>
          <Tabs value={account} onChange={pickCompany} options={withData.map((a) => ({ value: a, label: a }))} />
        </div>
        <div style={s.pickRow}>
          <span style={s.step}>2</span>
          <span style={s.pickLabel}>Platform</span>
          <div style={s.platforms}>
            {PLATFORMS.map((p) => {
              const has = platformsWithData.includes(p);
              const on = p === platform;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!has}
                  onClick={() => pickPlatform(p)}
                  title={has ? "" : `No ${p} data for ${account} yet`}
                  style={{ ...s.platformBtn, ...(on ? { background: PLATFORM_COLORS[p], color: "#fff", borderColor: PLATFORM_COLORS[p] } : {}), ...(has ? {} : s.platformOff) }}
                >
                  <span style={{ ...s.dot, background: on ? "#fff" : PLATFORM_COLORS[p] }} />
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ ...s.pickRow, marginBottom: 0 }}>
          <span style={s.step}>3</span>
          <span style={s.pickLabel}>Period</span>
          <Tabs value={mode} onChange={changeMode} options={[{ value: "week", label: "Week vs last week" }, { value: "month", label: "Month vs last month" }]} />
          <Select value={cur} onChange={setCur} options={[...periods].reverse().map((k) => ({ value: k, label: `This ${word}: ${label(k)}` }))} />
        </div>
      </Card>

      {behind && (
        <div style={s.warn}>
          ⚠ {platform} data for <b>{label(latestForCompany)}</b> isn&apos;t uploaded yet for {account}. Showing the latest uploaded {word}: {label(periods.at(-1))}.
        </div>
      )}

      {/* 2. verdict */}
      <div style={{ ...s.verdict, background: v.bg }}>
        <span style={{ ...s.verdictMark, color: v.color }}>{v.mark}</span>
        <div style={{ minWidth: 0 }}>
          <div style={s.verdictTitle}>
            <span style={{ ...s.dot, width: 10, height: 10, background: PLATFORM_COLORS[platform] }} />
            {account} · {platform}
            <span style={s.verdictRange}>
              {prev ? `${label(cur)}  vs  ${label(prev)}` : label(cur)}
            </span>
          </div>
          <div style={{ ...s.verdictText, color: v.color }}>
            {report ? report.headline : `This is the first ${word} uploaded for ${account} · ${platform}. Upload next ${word}'s files to see what changed.`}
          </div>
        </div>
      </div>

      {notes.length > 0 && (
        <div style={s.notes}>
          {notes.map((n) => (
            <div key={n} style={s.note}>⚠ {n}</div>
          ))}
        </div>
      )}

      {/* 3. every number: last vs this */}
      {prev && (
        <>
          <div style={s.sectionTitle}>This {word} vs last {word} — tap a card to see it week by week</div>
          <div style={{ ...s.scores, gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(auto-fill, minmax(190px, 1fr))" }}>
            {compared.map((m) => (
              <MetricScore
                key={m.key}
                metric={m.key}
                label={m.label}
                icon={m.icon}
                color={m.color}
                prev={prevT[m.key] || 0}
                cur={curT[m.key] || 0}
                prevLabel={`Last ${word}`}
                active={metric === m.key}
                onClick={() => setMetric(m.key)}
              />
            ))}
            {curT.views > 0 && prevT.views > 0 && (
              <MetricScore
                metric="er"
                label="Engagement rate"
                icon="%"
                color="#0b87a5"
                suffix="%"
                prev={engagementRate(prevT)}
                cur={engagementRate(curT)}
                prevLabel={`Last ${word}`}
                onClick={() => {}}
              />
            )}
          </div>
        </>
      )}

      {/* 4. week by week */}
      <Card
        title={`${metricOf(metric)?.full} — ${word} by ${word}`}
        subtitle={`Every bar is one ${word}. Green = went up from the ${word} before, red = dropped. Outlined bars are the two being compared.`}
        right={<Select value={metric} onChange={setMetric} options={present.map((m) => ({ value: m.key, label: m.full }))} />}
        style={{ margin: "18px 0" }}
      >
        <PeriodColumns periods={history} metric={metric} focus={[prev, cur]} color={PLATFORM_COLORS[platform]} />
      </Card>

      {/* 5. why + what to do */}
      <div style={{ ...s.twoCol, gridTemplateColumns: mobile ? "1fr" : "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
        <Card title="What happened and what to do" subtitle="Worked out from the numbers above — open the actual posts to confirm before changing the plan">
          {report ? <Findings findings={report.findings} /> : <p style={s.muted}>Upload one more {word} to get the reasons and next steps.</p>}
        </Card>
        <Card title={`Ideas for ${platform}`} subtitle="What usually grows this platform">
          <ol style={s.tips}>
            {(PLATFORM_TIPS[platform] || []).map((t) => (
              <li key={t} style={s.tip}>{t}</li>
            ))}
          </ol>
        </Card>
      </div>

      {/* 6. jump to the company's other platforms */}
      <Card title={`All platforms of ${account}`} subtitle={`Views this ${word} vs last ${word} — tap one to open its report`} style={{ marginTop: 18 }}>
        <div style={s.others}>
          {platformsWithData.map((p) => {
            const rowsP = own.filter((r) => r.platform === p);
            const k = rowsP.some((r) => (mode === "week" ? r.week === cur : r.week.startsWith(cur))) ? cur : null;
            const ps = listPeriods(rowsP, mode);
            const before = k ? ps[ps.indexOf(k) - 1] : null;
            const key = present.some((m) => m.key === "views") ? "views" : metric;
            const now = k ? periodTotals(rowsP, mode, k)[key] || 0 : 0;
            const was = before ? periodTotals(rowsP, mode, before)[key] || 0 : 0;
            const pct = before ? change(was, now) : undefined;
            const down = pct !== undefined && pct !== null && pct < 0;
            const flat = pct === 0;
            return (
              <button key={p} type="button" onClick={() => pickPlatform(p)} style={{ ...s.other, ...(p === platform ? s.otherOn : {}) }}>
                <span style={s.otherHead}>
                  <span style={{ ...s.dot, background: PLATFORM_COLORS[p] }} />
                  {p}
                </span>
                {k ? (
                  <>
                    <b style={s.otherVal}>{fmtValue(key, now)}</b>
                    <span style={{ ...s.otherPct, color: pct === undefined || flat ? theme.muted : down ? theme.red : theme.green }}>
                      {pct === undefined ? "first upload" : pct === null ? "New" : flat ? `No change vs last ${word}` : `${down ? "▼" : "▲"} ${Math.abs(pct).toFixed(0)}% vs last ${word}`}
                    </span>
                  </>
                ) : (
                  <span style={{ ...s.otherPct, color: "#b45309" }}>Not uploaded for {label(cur)}</span>
                )}
              </button>
            );
          })}
        </div>
      </Card>
    </>
  );
}

const s = {
  muted: { margin: 0, color: theme.muted },
  pickRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 },
  step: { width: 24, height: 24, borderRadius: "50%", background: theme.gradient, color: "#fff", fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 },
  pickLabel: { fontSize: 12, fontWeight: 700, color: theme.muted, textTransform: "uppercase", letterSpacing: 0.8, width: 74 },
  platforms: { display: "flex", gap: 8, flexWrap: "wrap" },
  platformBtn: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "8px 14px",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: theme.border,
    background: "#fff",
    fontSize: 13.5,
    fontWeight: 600,
    color: theme.text,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  platformOff: { opacity: 0.4, cursor: "not-allowed" },
  dot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  notes: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 },
  note: { background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 14, padding: "10px 14px", fontSize: 13.5, lineHeight: 1.5 },
  warn: { background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 14, padding: "11px 14px", fontSize: 13.5, marginBottom: 14 },
  verdict: { display: "flex", alignItems: "center", gap: 16, borderRadius: 22, padding: "18px 22px", marginBottom: 18, border: "1px solid rgba(255,255,255,0.9)", boxShadow: theme.shadow },
  verdictMark: { fontSize: 26, fontWeight: 800, width: 48, height: 48, borderRadius: 16, background: "rgba(255,255,255,0.8)", display: "grid", placeItems: "center", flexShrink: 0 },
  verdictTitle: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 17, fontWeight: 750, color: theme.text },
  verdictRange: { fontSize: 13, fontWeight: 600, color: theme.muted, whiteSpace: "pre" },
  verdictText: { fontSize: 14.5, fontWeight: 600, marginTop: 4 },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: theme.faint, textTransform: "uppercase", letterSpacing: 0.8, margin: "4px 0 10px" },
  scores: { display: "grid", gap: 12 },
  twoCol: { display: "grid", gap: 18, alignItems: "start" },
  tips: { margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10 },
  tip: { fontSize: 13.5, color: theme.text, lineHeight: 1.55 },
  others: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 },
  other: {
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px 14px",
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: theme.border,
    background: "rgba(255,255,255,0.8)",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  otherOn: { borderColor: "#32c1df", boxShadow: "0 0 0 2px rgba(50,193,223,0.35)" },
  otherHead: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: theme.muted },
  otherVal: { fontSize: 20, color: theme.text },
  otherPct: { fontSize: 12, fontWeight: 700 },
};
