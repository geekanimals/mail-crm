// App-wide constants: platforms, accounts, metrics and colors

export const PLATFORMS = ["Facebook", "Instagram", "LinkedIn", "X / Twitter", "YouTube"];

// Starting companies. More can be added from the Upload page ("+ Add new company").
export const DEFAULT_ACCOUNTS = ["GBTG", "GEEK", "SUSTAINIFY", "Mayank"];

// core: shown as main cards. snapshot: not added up (latest value is used). money: shown as $
export const METRICS = [
  { key: "views", label: "Views", full: "Views / Impressions", icon: "◉", color: "#2d6a5f", group: "Reach", core: true },
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

// YouTube calls followers "subscribers" — use these wherever the platform is known
const toSubs = (t) => t.replace(/Followers/g, "Subscribers").replace(/Follows/g, "Subscribers");
const YT_METRICS = METRICS.map((m) => (/Follow/.test(m.full) ? { ...m, label: toSubs(m.label), full: toSubs(m.full) } : m));
export const metricsFor = (platform) => (platform === "YouTube" ? YT_METRICS : METRICS);
export const metricFor = (key, platform) => metricsFor(platform).find((m) => m.key === key);

export const PLATFORM_COLORS = {
  Facebook: "#1877F2",
  Instagram: "#E1306C",
  LinkedIn: "#0A66C2",
  "X / Twitter": "#111827",
  YouTube: "#FF0000",
};

const ACCOUNT_PALETTE = ["#2d6a5f", "#f59e0b", "#10b981", "#ec4899", "#0f766e", "#8b5cf6", "#ef4444", "#84cc16", "#0ea5e9", "#f97316"];

// { accountName: color } — same order always gives the same color
export function accountColors(accounts) {
  return Object.fromEntries(accounts.map((a, i) => [a, ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length]]));
}

// Insights look: Apple-style frosted glass on a soft mint background, deep teal-green accent
export const theme = {
  bg: "#eef5f2",
  card: "rgba(255,255,255,0.55)",
  glass: "rgba(255,255,255,0.55)", // panels
  glassSoft: "rgba(255,255,255,0.62)", // inputs, buttons, tabs
  glassBorder: "rgba(255,255,255,0.75)",
  blur: "blur(28px) saturate(180%)",
  border: "rgba(20,50,44,0.08)",
  text: "#17302b",
  muted: "#5b726c",
  faint: "#93a8a2",
  primary: "#2d6a5f",
  primarySoft: "rgba(45,106,95,0.12)",
  gradient: "linear-gradient(135deg, #3f8a7b 0%, #2d6a5f 45%, #1f4d44 100%)",
  glow: "rgba(45,106,95,0.35)",
  green: "#248a3d",
  greenSoft: "rgba(52,199,89,0.16)",
  red: "#d70015",
  redSoft: "rgba(255,59,48,0.12)",
  radius: 24,
  shadow: "0 8px 32px rgba(20,60,50,0.08), inset 0 1px 0 rgba(255,255,255,0.85)",
};

