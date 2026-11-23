import { theme } from "@/lib/insights/constants";

export default function Card({ title, subtitle, right, children, style }) {
  return (
    <section style={{ ...s.card, ...style }}>
      {(title || right) && (
        <div style={s.head}>
          <div>
            <h3 style={s.title}>{title}</h3>
            {subtitle && <div style={s.sub}>{subtitle}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

const s = {
  card: {
    background: theme.glass,
    border: `1px solid ${theme.glassBorder}`,
    borderRadius: theme.radius,
    padding: 22,
    boxShadow: theme.shadow,
    backdropFilter: theme.blur,
    WebkitBackdropFilter: theme.blur,
    minWidth: 0,
  },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, gap: 12, flexWrap: "wrap" },
  title: { margin: 0, fontSize: 15.5, fontWeight: 700, color: theme.text, letterSpacing: -0.2 },
  sub: { fontSize: 12.5, color: theme.muted, marginTop: 3 },
};
