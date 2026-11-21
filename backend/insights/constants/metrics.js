// Shared lists — keep in sync with frontend/src/lib/constants.js

export const PLATFORMS = ["Facebook", "Instagram", "LinkedIn", "X / Twitter", "YouTube"];

export const DEFAULT_ACCOUNTS = ["GBTG", "GEEK", "SUSTAINIFY", "Mayank"];

// Every number stored for one account + platform + date range
export const METRIC_KEYS = [
  "views", // Views / Impressions
  "reach", // Reach / Viewers / Unique impressions
  "likes", // Likes / Reactions / Interactions
  "comments",
  "shares", // Shares / Reposts
  "saves",
  "linkClicks",
  "visits", // Profile / Page visits
  "newFollowers",
  "followers", // Total followers at the end of the range
  "watchTime", // hours
  "posts", // Posts published in the range
  "earnings", // USD
];
