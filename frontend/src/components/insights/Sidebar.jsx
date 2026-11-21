"use client";

// Insights sidebar — same look as the Geek CRM sidebar: glass panel, Geek logo, cyan active item.
// Desktop: icons only, opens on hover. Tablet / mobile: slide-out menu (open = true).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LuArrowLeft, LuArrowLeftRight, LuChartColumn, LuLayoutDashboard, LuLogOut, LuTable, LuTrendingUp, LuUpload, LuX } from "react-icons/lu";
import { setRole, setToken } from "@/lib/api";
import { useSession } from "./Session";

const ICON = process.env.NEXT_PUBLIC_LOGO_ICON_URL || "/fav.png"; // square Geek logo
const WORDMARK = process.env.NEXT_PUBLIC_BRAND_LOGO_URL || "/logo.png"; // Geek name, shown when the sidebar opens

const LINKS = [
  { href: "/insights", label: "Overview", Icon: LuLayoutDashboard },
  { href: "/insights/report", label: "Platform Report", Icon: LuChartColumn },
  { href: "/insights/trends", label: "Trends", Icon: LuTrendingUp },
  { href: "/insights/compare", label: "Compare", Icon: LuArrowLeftRight },
  { href: "/insights/upload", label: "Upload Data", Icon: LuUpload },
  { href: "/insights/data", label: "All Data", Icon: LuTable },
];

export default function Sidebar({ open, drawer, onHover, onClose }) {
  const path = usePathname();
  const router = useRouter();
  const { role } = useSession();
  const wide = open || drawer;

  const logout = () => {
    setToken(null);
    setRole(null);
    router.replace("/login");
  };

  const item = (active) => ({ ...s.link, ...(active ? s.active : {}) });
  const label = { ...s.label, opacity: wide ? 1 : 0 };

  return (
    <aside
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      style={{
        ...s.side,
        ...(drawer ? s.sideDrawer : { width: open ? 220 : 72 }),
        ...(drawer && !open ? { transform: "translateX(-110%)" } : {}),
        ...(open && !drawer ? s.sideOpen : {}),
      }}
    >
      <div style={s.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ICON} alt="Geek" style={s.brandIcon} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={WORDMARK} alt="" style={{ ...s.brandName, opacity: wide ? 1 : 0 }} />
        {drawer && (
          <button type="button" onClick={onClose} aria-label="Close menu" style={s.close}>
            <LuX />
          </button>
        )}
      </div>

      <nav style={s.nav}>
        {LINKS.map(({ href, label: text, Icon }) => (
          <Link key={href} href={href} onClick={onClose} style={item(path === href)} title={wide ? undefined : text}>
            <span style={s.icon}><Icon /></span>
            <span style={label}>{text}</span>
          </Link>
        ))}
      </nav>

      <span style={s.line} />
      {role === "admin" && (
        <Link href="/" style={item(false)} title={wide ? undefined : "Back to CRM"}>
          <span style={s.icon}><LuArrowLeft /></span>
          <span style={label}>Back to CRM</span>
        </Link>
      )}
      <button type="button" onClick={logout} style={{ ...item(false), ...s.logout }} title={wide ? undefined : "Log out"}>
        <span style={s.icon}><LuLogOut /></span>
        <span style={label}>Log out</span>
      </button>
    </aside>
  );
}

const s = {
  side: {
    position: "fixed",
    left: 16,
    top: 16,
    bottom: 16,
    zIndex: 30,
    overflow: "hidden",
    borderRadius: 36,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: "linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.28) 45%, rgba(50,193,223,0.12) 100%)",
    backdropFilter: "blur(22px) saturate(200%) brightness(1.06)",
    WebkitBackdropFilter: "blur(22px) saturate(200%) brightness(1.06)",
    border: "1px solid rgba(255,255,255,0.9)",
    boxShadow: "0 1px 2px rgba(11,60,75,0.04), 0 10px 32px rgba(11,60,75,0.08)",
    transition: "width .3s cubic-bezier(.2,.8,.2,1), transform .25s",
  },
  sideOpen: {
    background: "linear-gradient(135deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.6) 45%, rgba(50,193,223,0.16) 100%)",
  },
  sideDrawer: {
    top: 0,
    left: 0,
    bottom: 0,
    width: 240,
    borderRadius: "0 30px 30px 0",
    background: "rgba(255,255,255,0.92)",
  },
  brand: { position: "relative", display: "flex", alignItems: "center", gap: 12, height: 48, padding: "0 4px", marginBottom: 6, flexShrink: 0 },
  brandIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    flexShrink: 0,
    objectFit: "contain",
    background: "#fff",
    boxShadow: "0 8px 18px rgba(50,193,223,0.25)",
  },
  brandName: { height: 30, width: "auto", maxWidth: 120, objectFit: "contain", flexShrink: 0, transition: "opacity .18s" },
  close: {
    marginLeft: "auto",
    width: 36,
    height: 36,
    borderRadius: 12,
    border: "none",
    background: "rgba(50,193,223,0.12)",
    color: "#0b87a5",
    fontSize: 18,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  },
  nav: { display: "flex", flexDirection: "column", gap: 8 },
  link: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 14,
    height: 48,
    padding: "0 12px",
    borderRadius: 16,
    color: "#4b6873",
    fontWeight: 500,
    fontSize: 14.5,
    whiteSpace: "nowrap",
    border: "none",
    background: "none",
    cursor: "pointer",
    width: "100%",
    textDecoration: "none",
    flexShrink: 0,
    fontFamily: "inherit",
    transition: "background .2s, color .2s, box-shadow .2s",
  },
  active: {
    color: "#fff",
    background: "linear-gradient(150deg, #5fd3eb 0%, #32c1df 55%, #1aa9c8 100%)",
    boxShadow: "0 10px 24px rgba(50,193,223,0.35), inset 0 1px 0 rgba(255,255,255,0.45)",
  },
  icon: { width: 24, height: 24, display: "grid", placeItems: "center", flexShrink: 0, fontSize: 21 },
  label: { transition: "opacity .18s" },
  line: { height: 1, background: "rgba(11,60,75,0.08)", margin: "auto 8px 6px", flexShrink: 0 },
  logout: { color: "#be123c" },
};
