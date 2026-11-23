"use client";

// Insights sidebar — same layout as the Geek CRM sidebar but its own look: Apple-style frosted glass with a
// teal-green tint, deep teal active item, Geek logo + "Geek Insights" name.
// Desktop: icons only, opens on hover. Tablet / mobile: slide-out menu (open = true).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LuArrowLeft, LuArrowLeftRight, LuChartColumn, LuLayoutDashboard, LuLogOut, LuTable, LuTrendingUp, LuUpload, LuX } from "react-icons/lu";
import { setRole, setToken } from "@/lib/api";
import { useSession } from "./Session";

const ICON = process.env.NEXT_PUBLIC_LOGO_ICON_URL || "/fav.png"; // square Geek logo

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
        <span style={{ ...s.brandName, opacity: wide ? 1 : 0 }}>
          Geek <b style={s.brandAccent}>Insights</b>
        </span>
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
    background: "linear-gradient(160deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.34) 55%, rgba(45,106,95,0.16) 100%)",
    backdropFilter: "blur(30px) saturate(190%)",
    WebkitBackdropFilter: "blur(30px) saturate(190%)",
    border: "1px solid rgba(255,255,255,0.8)",
    boxShadow: "0 12px 40px rgba(20,60,50,0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
    transition: "width .3s cubic-bezier(.2,.8,.2,1), transform .25s",
  },
  sideOpen: {
    background: "linear-gradient(160deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.65) 55%, rgba(45,106,95,0.18) 100%)",
    boxShadow: "0 20px 50px rgba(20,60,50,0.18), inset 0 1px 0 rgba(255,255,255,0.9)",
  },
  sideDrawer: { top: 0, left: 0, bottom: 0, width: 240, borderRadius: "0 30px 30px 0", background: "rgba(255,255,255,0.88)" },
  brand: { position: "relative", display: "flex", alignItems: "center", gap: 12, height: 48, padding: "0 4px", marginBottom: 6, flexShrink: 0 },
  brandIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    flexShrink: 0,
    objectFit: "contain",
    background: "#fff",
    boxShadow: "0 8px 18px rgba(45,106,95,0.3)",
  },
  brandName: { color: "#17302b", fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", transition: "opacity .18s", letterSpacing: -0.2 },
  brandAccent: { fontWeight: 800, background: "linear-gradient(135deg, #2d6a5f, #1f4d44)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" },
  close: {
    marginLeft: "auto",
    width: 36,
    height: 36,
    borderRadius: 12,
    border: "none",
    background: "rgba(45,106,95,0.12)",
    color: "#2d6a5f",
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
    color: "#2f4741",
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
    background: "linear-gradient(135deg, #3f8a7b 0%, #2d6a5f 45%, #1f4d44 100%)",
    boxShadow: "0 10px 24px rgba(45,106,95,0.38), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  icon: { width: 24, height: 24, display: "grid", placeItems: "center", flexShrink: 0, fontSize: 21 },
  label: { transition: "opacity .18s" },
  line: { height: 1, background: "rgba(0,0,0,0.08)", margin: "auto 8px 6px", flexShrink: 0 },
  logout: { color: "#d70015" },
};
