import { theme } from "@/lib/insights/constants";

// Green for up, red for down, blue for "New" (pct = null)
export default function ChangeBadge({ pct }) {
  const isNew = pct === null || pct === undefined;
  const up = !isNew && pct > 0;
  const down = !isNew && pct < 0;

  const colors = isNew
    ? [theme.primarySoft, theme.primary]
    : up
    ? [theme.greenSoft, theme.green]
    : down
    ? [theme.redSoft, theme.red]
    : ["#f1f5f9", theme.muted];

  return (
    <span style={{ ...s.badge, background: colors[0], color: colors[1] }}>
      {isNew ? "New" : `${up ? "▲" : down ? "▼" : ""} ${Math.abs(pct).toFixed(1)}%`}
    </span>
  );
}

const s = {
  badge: {
    display: "inline-block",
    padding: "3px 9px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 650,
    whiteSpace: "nowrap",
  },
};
