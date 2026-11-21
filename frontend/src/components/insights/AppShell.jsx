"use client";

// Insights page frame — same layout as the Geek CRM: soft cyan background, glass sidebar, glass top bar.
// Desktop: icon sidebar that opens on hover. Tablet / mobile: menu button + slide-out sidebar.
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { LuMenu, LuUpload } from "react-icons/lu";
import Sidebar from "./Sidebar";
import ServerStatus from "./ServerStatus";
import { useSession } from "./Session";
import { useScreen } from "@/lib/insights/useScreen";

const noop = () => () => {};
const todayText = () => new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
const greetingText = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function AppShell({ children }) {
  const { compact, mobile } = useScreen();
  const { user, role } = useSession();
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState(false);
  const today = useSyncExternalStore(noop, todayText, () => "");
  const greeting = useSyncExternalStore(noop, greetingText, () => "Hello");

  const open = compact ? menu : hover;
  const mainLeft = compact ? 0 : (hover ? 220 : 72) + 40;

  return (
    <div style={s.shell}>
      <div style={s.bg} aria-hidden="true">
        <i style={{ ...s.blob, ...s.b1 }} />
        <i style={{ ...s.blob, ...s.b2 }} />
        <i style={{ ...s.blob, ...s.b3 }} />
      </div>

      <Sidebar open={open} drawer={compact} onHover={compact ? undefined : setHover} onClose={() => setMenu(false)} />
      {compact && menu && <div style={s.backdrop} onClick={() => setMenu(false)} />}

      <div style={{ ...s.main, marginLeft: mainLeft }}>
        <header style={{ ...s.top, ...(compact ? { padding: "12px 12px 0" } : {}) }}>
          <div style={{ ...s.topInner, ...(mobile ? s.topInnerMobile : {}) }}>
            {compact && (
              <button type="button" aria-label="Open menu" onClick={() => setMenu(true)} style={s.menuBtn}>
                <LuMenu />
              </button>
            )}
            <div style={s.title}>
              {!mobile && <small style={s.titleSmall}>{today} · Insights</small>}
              <b style={{ ...s.titleBig, ...(mobile ? { fontSize: 16 } : {}) }}>{greeting}, {user}</b>
            </div>
            <div style={s.right}>
              <Link href="/insights/upload" style={s.uploadBtn} aria-label="Upload data">
                <LuUpload />
                {!mobile && <span>Upload data</span>}
              </Link>
              <div style={{ ...s.userChip, ...(mobile ? { padding: 4 } : {}) }}>
                <span style={s.avatar}>{(user || "?").slice(0, 2).toUpperCase()}</span>
                {!mobile && (
                  <div style={s.userText}>
                    <b style={s.userName}>{user}</b>
                    <small style={s.userRole}>{role === "admin" ? "Admin" : "Insights"}</small>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main style={{ ...s.content, ...(mobile ? s.contentMobile : compact ? s.contentTablet : {}) }}>
          <ServerStatus />
          {children}
        </main>
      </div>
    </div>
  );
}

const s = {
  shell: { minHeight: "100vh", position: "relative" },
  bg: { position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", background: "linear-gradient(180deg, #f7fdfe 0%, #eef8fb 100%)", pointerEvents: "none" },
  blob: { position: "absolute", borderRadius: "50%", filter: "blur(110px)" },
  b1: { width: 640, height: 640, background: "rgba(50,193,223,0.22)", top: -280, right: "4%" },
  b2: { width: 520, height: 520, background: "rgba(50,193,223,0.14)", bottom: -260, left: "12%" },
  b3: { width: 380, height: 380, background: "rgba(50,193,223,0.30)", top: "18%", left: -120, filter: "blur(80px)" },
  backdrop: { position: "fixed", inset: 0, background: "rgba(14,42,51,0.2)", backdropFilter: "blur(4px)", zIndex: 25 },
  main: { position: "relative", zIndex: 1, minWidth: 0, transition: "margin-left .3s cubic-bezier(.2,.8,.2,1)" },
  top: { position: "sticky", top: 0, zIndex: 20, padding: "16px 16px 0 0" },
  topInner: {
    height: 68,
    padding: "0 12px 0 22px",
    display: "flex",
    alignItems: "center",
    gap: 14,
    borderRadius: 26,
    background: "linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.45) 45%, rgba(50,193,223,0.12) 100%)",
    backdropFilter: "blur(22px) saturate(200%)",
    WebkitBackdropFilter: "blur(22px) saturate(200%)",
    border: "1px solid rgba(255,255,255,0.9)",
    boxShadow: "0 1px 2px rgba(11,60,75,0.04), 0 10px 32px rgba(11,60,75,0.06)",
  },
  topInnerMobile: { height: 60, padding: "0 8px", borderRadius: 22 },
  menuBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    border: "1px solid rgba(50,193,223,0.14)",
    background: "rgba(255,255,255,0.8)",
    color: "#0b87a5",
    fontSize: 20,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  title: { display: "flex", flexDirection: "column", lineHeight: 1.25, minWidth: 0 },
  titleSmall: { color: "#5d7680", fontSize: 12, fontWeight: 500 },
  titleBig: { color: "#0e2a33", fontSize: 18, fontWeight: 600, letterSpacing: -0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  right: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  uploadBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    padding: "0 16px",
    borderRadius: 15,
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    textDecoration: "none",
    background: "linear-gradient(150deg, #5fd3eb 0%, #32c1df 55%, #1aa9c8 100%)",
    boxShadow: "0 8px 20px rgba(50,193,223,0.35), inset 0 1px 0 rgba(255,255,255,0.4)",
  },
  userChip: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "5px 16px 5px 5px",
    borderRadius: 17,
    background: "rgba(255,255,255,0.75)",
    border: "1px solid rgba(50,193,223,0.14)",
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
    background: "linear-gradient(150deg, #5fd3eb, #32c1df 55%, #1aa9c8)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
    fontSize: 12.5,
    boxShadow: "0 6px 14px rgba(50,193,223,0.35)",
  },
  userText: { display: "flex", flexDirection: "column", lineHeight: 1.2 },
  userName: { fontSize: 13.5, color: "#0e2a33" },
  userRole: { fontSize: 11.5, color: "#5d7680" },
  content: { padding: "26px 24px 56px 0", maxWidth: 1440, margin: "0 auto", width: "100%" },
  contentTablet: { padding: "22px 20px 48px" },
  contentMobile: { padding: "16px 12px 40px" },
};
