"use client";

import { theme } from "@/lib/insights/constants";
import { useScreen } from "@/lib/insights/useScreen";

export default function PageHeader({ eyebrow, title, subtitle, children }) {
  const { mobile } = useScreen();
  return (
    <header style={s.wrap}>
      <div>
        {eyebrow && <div style={s.eyebrow}>{eyebrow}</div>}
        <h1 style={{ ...s.title, ...(mobile ? { fontSize: 24 } : {}) }}>{title}</h1>
        {subtitle && <p style={s.sub}>{subtitle}</p>}
      </div>
      {children && <div style={mobile ? s.rightMobile : s.right}>{children}</div>}
    </header>
  );
}

const s = {
  wrap: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 26,
  },
  eyebrow: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: theme.primary,
    marginBottom: 6,
  },
  title: { margin: 0, fontSize: 30, fontWeight: 750, color: theme.text, letterSpacing: -0.8 },
  sub: { margin: "6px 0 0", color: theme.muted, fontSize: 14 },
  rightMobile: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" },
  right: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" },
};
