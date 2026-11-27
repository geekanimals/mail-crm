"use client";

// Connections: link each company's Facebook Page and Instagram once (Meta login) — numbers are then fetched
// every week automatically and saved like an upload. Shows status, errors and the fetch history.
import { useCallback, useEffect, useState } from "react";
import { LuFacebook, LuInstagram, LuRefreshCw } from "react-icons/lu";
import PageHeader from "@/components/insights/PageHeader";
import Card from "@/components/insights/Card";
import { useData } from "@/components/insights/DataProvider";
import { api } from "@/lib/insights/api";
import { theme } from "@/lib/insights/constants";
import { fmtRange } from "@/lib/insights/format";
import { useScreen } from "@/lib/insights/useScreen";

const PLATFORMS = [
  { name: "Facebook", Icon: LuFacebook, color: "#1877f2", what: "Facebook Page" },
  { name: "Instagram", Icon: LuInstagram, color: "#e1306c", what: "Instagram professional account" },
];
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const weekLabel = (start) => (start ? fmtRange(start, new Date(Date.parse(start) + 6 * 86400000).toISOString().slice(0, 10)) : "—");

export default function ConnectionsPage() {
  const { accounts, reload } = useData();
  const { mobile } = useScreen();
  // coming back from Meta: ?connected=… / ?error=… / ?pick=… (read once; this page only renders in the browser)
  const [back] = useState(() => (typeof window === "undefined" ? {} : Object.fromEntries(new URLSearchParams(window.location.search))));
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(back.error || "");
  const [note, setNote] = useState(
    back.connected
      ? `${back.connected} connected for ${back.account}${back.name ? " (" + back.name + ")" : ""}.` +
          (back.fetched === "1" ? " Last week's numbers are already saved." : " The first fetch didn't work — see the history below.")
      : ""
  );
  const [busy, setBusy] = useState(""); // what is running, e.g. "GBTG|Instagram"
  const [weeks, setWeeks] = useState("1");
  const [confirm, setConfirm] = useState(""); // connection id waiting for the 2nd Disconnect click
  const [pick, setPick] = useState(null); // { id, account, pages } after Facebook login

  const load = useCallback(() => api.metaStatus().then(setStatus, (e) => setError(e.message)), []);

  useEffect(() => {
    load();
    if (back.connected) reload();
    if (back.pick) api.metaPending(back.pick).then((d) => setPick({ id: back.pick, ...d }), (e) => setError(e.message));
    if (Object.keys(back).length) window.history.replaceState(null, "", "/insights/connections");
  }, [back, load, reload]);

  const run = async (key, fn, done) => {
    setBusy(key);
    setError("");
    setNote("");
    try {
      const r = await fn();
      if (done) setNote(typeof done === "function" ? done(r) : done);
      await Promise.all([load(), reload()]);
      return r;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const connect = (account, platform) =>
    run(`${account}|${platform}|connect`, async () => {
      window.location.href = await api.metaConnect(account, platform); // goes to Meta's login page
    });

  const fetchNow = (body, label) =>
    run(label, () => api.metaSync(body), (r) => {
      const ok = r.results.filter((x) => x.ok).length;
      const bad = r.results.length - ok;
      return `Fetched ${ok} week${ok === 1 ? "" : "s"}${bad ? ` · ${bad} failed (see the history below)` : ""}.`;
    });

  const choose = (pageId) =>
    run("pick", () => api.metaChoosePage(pick.id, pageId), (r) => {
      setPick(null);
      return `Facebook Page "${r.connection.name}" connected for ${r.connection.account}.` + (r.firstFetch?.ok ? " Last week's numbers are already saved." : "");
    });

  const conns = status?.connections || [];
  const find = (account, platform) => conns.find((c) => c.account === account && c.platform === platform);
  const setup = status?.setup;

  return (
    <>
      <PageHeader
        eyebrow="Auto-fetch"
        title="Connections"
        subtitle="Connect each company's Facebook Page and Instagram once — every week the numbers are fetched from Meta and saved automatically."
      />

      {error && <div style={{ ...s.box, ...s.err }}>⚠ {error}</div>}
      {note && <div style={{ ...s.box, ...s.ok }}>✓ {note}</div>}

      {setup && (!setup.facebook || !setup.instagram) && (
        <div style={{ ...s.box, ...s.warn }}>
          <b>Server setup needed before connecting:</b>
          {!setup.facebook && <div>• Facebook: add META_APP_ID, META_APP_SECRET and META_LOGIN_CONFIG_ID to the backend .env</div>}
          {!setup.instagram && <div>• Instagram: add META_IG_APP_ID and META_IG_APP_SECRET to the backend .env</div>}
          <div style={{ marginTop: 6 }}>Redirect URLs to add in the Meta app:</div>
          <code style={s.code}>{setup.redirectUris.facebook}</code>
          <code style={s.code}>{setup.redirectUris.instagram}</code>
        </div>
      )}

      {pick && (
        <Card title={`Which Facebook Page is ${pick.account}?`} subtitle="These are the Pages your Facebook login manages" style={{ marginBottom: 18 }}>
          <div style={s.pages}>
            {pick.pages.map((p) => (
              <button key={p.id} type="button" disabled={busy === "pick"} onClick={() => choose(p.id)} style={s.pageBtn}>
                <LuFacebook style={{ color: "#1877f2" }} /> {p.name}
              </button>
            ))}
            <button type="button" onClick={() => setPick(null)} style={s.ghost}>Cancel</button>
          </div>
        </Card>
      )}

      <Card
        title="Companies"
        subtitle={status ? `Automatic fetch: every week once Meta has finished counting (Tuesday morning). Next week to fetch: ${weekLabel(status.readyWeek?.start)}` : "Loading…"}
        right={
          <div style={s.bulk}>
            <select value={weeks} onChange={(e) => setWeeks(e.target.value)} style={s.select} aria-label="Weeks to fetch">
              {["1", "4", "8", "12"].map((n) => <option key={n} value={n}>{n === "1" ? "Last week" : `Last ${n} weeks`}</option>)}
            </select>
            <button type="button" disabled={!conns.length || Boolean(busy)} onClick={() => fetchNow({ weeks }, "all")} style={{ ...s.primary, ...(!conns.length ? s.off : {}) }}>
              <LuRefreshCw /> {busy === "all" ? "Fetching…" : "Fetch now for all"}
            </button>
          </div>
        }
        style={{ marginBottom: 18 }}
      >
        <div style={{ ...s.grid, gridTemplateColumns: mobile ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {accounts.map((account) => (
            <div key={account} style={s.company}>
              <div style={s.companyName}>{account}</div>
              {PLATFORMS.map(({ name, Icon, color, what }) => {
                const c = find(account, name);
                const key = `${account}|${name}`;
                const chip = !c ? ["Not connected", "#efeff4", theme.muted] : c.status === "error" ? ["Error", theme.redSoft, theme.red] : ["Connected", theme.greenSoft, theme.green];
                return (
                  <div key={name} style={s.row}>
                    <div style={s.rowTop}>
                      <span style={{ ...s.pIcon, color, background: color + "18" }}><Icon /></span>
                      <b style={s.pName}>{name}</b>
                      <span style={{ ...s.chip, background: chip[1], color: chip[2] }}>{chip[0]}</span>
                    </div>
                    {c ? (
                      <>
                        <div style={s.meta}>
                          {c.name || what} · last fetch {when(c.lastFetchAt)}
                          {c.lastFetchWeek && ` · latest week ${weekLabel(c.lastFetchWeek)}`}
                        </div>
                        {c.lastError && <div style={{ ...s.meta, color: c.status === "error" ? theme.red : "#5f6f6a" }}>{c.lastError}</div>}
                        <div style={s.actions}>
                          <button type="button" disabled={Boolean(busy)} onClick={() => fetchNow({ account, platform: name, weeks }, key)} style={s.small}>
                            {busy === key ? "Fetching…" : "Fetch now"}
                          </button>
                          <button type="button" disabled={Boolean(busy)} onClick={() => connect(account, name)} style={s.small}>Reconnect</button>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => (confirm === c.id ? run(key, () => api.metaDisconnect(c.id), `${account} · ${name} disconnected (saved numbers stay).`) : setConfirm(c.id))}
                            style={{ ...s.small, color: theme.red, ...(confirm === c.id ? s.danger : {}) }}
                          >
                            {confirm === c.id ? "Confirm?" : "Disconnect"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={s.actions}>
                        <button type="button" disabled={Boolean(busy) || (name === "Facebook" ? !setup?.facebook : !setup?.instagram)} onClick={() => connect(account, name)} style={s.connect}>
                          Connect {name}
                        </button>
                        <span style={s.hint}>Log in with the account that manages this {what}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Fetch history" subtitle="Every automatic and manual fetch — failures retry every hour (up to 6 times), Fetch now works any time">
        {!status?.logs?.length ? (
          <p style={s.muted}>Nothing fetched yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead>
                <tr>{["When", "Company", "Platform", "Week", "Result", ""].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {status.logs.map((l) => (
                  <tr key={l.id}>
                    <td style={s.td}>{when(l.createdAt)}</td>
                    <td style={s.td}>{l.account}</td>
                    <td style={s.td}>{l.platform}</td>
                    <td style={s.td}>{fmtRange(l.week, l.end)}</td>
                    <td style={{ ...s.td, color: l.ok ? theme.green : theme.red, whiteSpace: "normal", minWidth: 260 }}>{l.ok ? "✓ " : "⚠ "}{l.message}</td>
                    <td style={{ ...s.td, color: theme.faint }}>{l.trigger}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

const s = {
  box: { padding: "11px 14px", borderRadius: 14, fontSize: 13.5, marginBottom: 16, lineHeight: 1.55, backdropFilter: theme.blur, WebkitBackdropFilter: theme.blur },
  err: { background: theme.redSoft, color: theme.red, fontWeight: 600 },
  ok: { background: theme.greenSoft, color: theme.green, fontWeight: 600 },
  warn: { background: "rgba(255,204,0,0.14)", border: "1px solid rgba(255,179,0,0.35)", color: "#8a4b00" },
  code: { display: "block", fontSize: 12.5, marginTop: 4, padding: "4px 8px", borderRadius: 8, background: "rgba(255,255,255,0.6)", wordBreak: "break-all" },
  pages: { display: "flex", gap: 10, flexWrap: "wrap" },
  pageBtn: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 12, border: `1px solid ${theme.glassBorder}`, background: theme.glassSoft, cursor: "pointer", fontSize: 14, fontWeight: 600, color: theme.text, fontFamily: "inherit" },
  ghost: { padding: "10px 14px", borderRadius: 12, border: "none", background: "transparent", cursor: "pointer", color: theme.muted, fontFamily: "inherit" },
  bulk: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  select: { padding: "8px 10px", borderRadius: 10, border: `1px solid ${theme.glassBorder}`, background: theme.glassSoft, fontSize: 13, color: theme.text, fontFamily: "inherit" },
  primary: { display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 11, border: "none", background: theme.gradient, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  off: { opacity: 0.5, cursor: "not-allowed" },
  grid: { display: "grid", gap: 14 },
  company: { borderRadius: 18, border: `1px solid ${theme.glassBorder}`, background: "rgba(255,255,255,0.45)", padding: 14 },
  companyName: { fontSize: 15, fontWeight: 800, color: theme.text, marginBottom: 8 },
  row: { padding: "10px 0", borderTop: `1px solid ${theme.border}` },
  rowTop: { display: "flex", alignItems: "center", gap: 8 },
  pIcon: { width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", fontSize: 15 },
  pName: { fontSize: 14, color: theme.text, flex: 1 },
  chip: { fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999 },
  meta: { fontSize: 12.5, color: theme.muted, marginTop: 6, lineHeight: 1.45 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 },
  small: { padding: "6px 11px", borderRadius: 9, border: `1px solid ${theme.glassBorder}`, background: theme.glassSoft, fontSize: 12.5, fontWeight: 600, color: theme.text, cursor: "pointer", fontFamily: "inherit" },
  danger: { background: theme.red, color: "#fff", borderColor: theme.red },
  connect: { padding: "7px 13px", borderRadius: 10, border: "none", background: theme.gradient, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  hint: { fontSize: 12, color: theme.faint },
  muted: { margin: 0, color: theme.muted, fontSize: 14 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", fontSize: 11.5, color: theme.faint, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${theme.border}`, whiteSpace: "nowrap" },
  td: { padding: "9px 10px", borderBottom: `1px solid ${theme.border}`, color: theme.text, whiteSpace: "nowrap", verticalAlign: "top" },
};
