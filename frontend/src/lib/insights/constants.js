// App-wide constants: platforms, accounts, metrics and colors

export const PLATFORMS = ["Facebook", "Instagram", "LinkedIn", "X / Twitter", "YouTube"];

// Starting companies. More can be added from the Upload page ("+ Add new company").
export const DEFAULT_ACCOUNTS = ["GBTG", "GEEK", "SUSTAINIFY", "Mayank"];

// core: shown as main cards. snapshot: not added up (latest value is used). money: shown as $
export const METRICS = [
  { key: "views", label: "Views", full: "Views / Impressions", icon: "◉", color: "#1aa9c8", group: "Reach", core: true },
  { key: "reach", label: "Reach", full: "Reach / Viewers", icon: "◎", color: "#0ea5e9", group: "Reach" },
  { key: "likes", label: "Likes", full: "Likes / Interactions", icon: "♥", color: "#ec4899", group: "Engagement", core: true },
  { key: "comments", label: "Comments", full: "Comments", icon: "❝", color: "#f97316", group: "Engagement" },
  { key: "shares", label: "Shares", full: "Shares / Reposts", icon: "↻", color: "#14b8a6", group: "Engagement" },
  { key: "saves", label: "Saves", full: "Saves / Bookmarks", icon: "⚑", color: "#0d9488", group: "Engagement" },
  { key: "linkClicks", label: "Link Clicks", full: "Link Clicks", icon: "⌁", color: "#8b5cf6", group: "Engagement" },
  { key: "visits", label: "Visits", full: "Profile / Page Visits", icon: "⌂", color: "#0891b2", group: "Audience" },
  { key: "newFollowers", label: "New Followers", full: "New Followers", icon: "+", color: "#22c55e", group: "Audience" },
  { key: "followers", label: "Followers", full: "Total Followers", icon: "◍", color: "#10b981", group: "Audience", core: true, snapshot: true },
  { key: "watchTime", label: "Watch Time", full: "Watch Time (hours)", icon: "◷", color: "#eab308", group: "Audience" },
  { key: "posts", label: "Posts", full: "Posts Published", icon: "▤", color: "#64748b", group: "Content" },
  { key: "earnings", label: "Earnings", full: "Earnings (USD)", icon: "$", color: "#16a34a", group: "Money", core: true, money: true },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);
export const CORE_METRICS = METRICS.filter((m) => m.core);
export const metricOf = (key) => METRICS.find((m) => m.key === key);

export const PLATFORM_COLORS = {
  Facebook: "#1877F2",
  Instagram: "#E1306C",
  LinkedIn: "#0A66C2",
  "X / Twitter": "#111827",
  YouTube: "#FF0000",
};

const ACCOUNT_PALETTE = ["#32c1df", "#f59e0b", "#10b981", "#ec4899", "#0f766e", "#8b5cf6", "#ef4444", "#84cc16", "#0ea5e9", "#f97316"];

// { accountName: color } — same order always gives the same color
export function accountColors(accounts) {
  return Object.fromEntries(accounts.map((a, i) => [a, ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length]]));
}

// Geek brand colors (same as the CRM): cyan #32c1df, dark teal text, glass cards
export const theme = {
  bg: "#f3fbfd",
  card: "rgba(255,255,255,0.74)",
  border: "rgba(11,60,75,0.08)",
  text: "#0e2a33",
  muted: "#5d7680",
  faint: "#8aa1a9",
  primary: "#0b87a5",
  primarySoft: "rgba(50,193,223,0.12)",
  gradient: "linear-gradient(150deg, #5fd3eb 0%, #32c1df 55%, #1aa9c8 100%)",
  glow: "rgba(50,193,223,0.35)",
  green: "#16a34a",
  greenSoft: "#dcfce7",
  red: "#e11d48",
  redSoft: "#ffe4e6",
  radius: 24,
  shadow: "0 1px 2px rgba(11,60,75,0.04), 0 10px 32px rgba(11,60,75,0.06)",
};

