// Who can use Insights: the admin and the Insights login (both set in .env)
export function requireInsights(req, res, next) {
  if (req.role === "admin" || req.role === "insights") return next();
  res.status(403).json({ error: "You don't have access to Insights" });
}
