// Shared lists — keep in sync with frontend/src/lib/constants.js

export const PLATFORMS = ["Facebook", "Instagram", "LinkedIn", "X / Twitter", "YouTube"];

export const DEFAULT_ACCOUNTS = ["GBTG", "GEEK", "SUSTAINIFY", "Mayank"];

// Every number stored for one account + platform + date range
export const METRIC_KEYS = [
  "views", // Views / Impressions
  "reach", // Reach — unique people in the range (Meta API reach, unique impressions)
  "viewers", // Viewers added up day by day (Meta Business Suite "Viewers" file; same person counted every day)
  "likes", // Likes / Reactions only
  "interactions", // All content interactions together (Meta "Content interactions": likes + comments + shares + saves …)
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
