// Insights Dashboard API, mounted at /api/insights (after the CRM login check)
import { Router } from "express";
import entryRoutes from "./routes/entryRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import { connectRoutes } from "./meta/routes.js";
import { PLATFORMS, METRIC_KEYS } from "./constants/metrics.js";
import { requireInsights } from "./middleware/access.js";
import { db } from "./db.js";
import { errorHandler, notFoundRoute } from "./middleware/errorHandler.js";

export { ensureDefaultAccounts } from "./services/accountService.js";
export { oauthRoutes as insightsOAuthRoutes } from "./meta/routes.js";
export { startMetaTimer } from "./meta/sync.js";

const router = Router();
router.use(requireInsights);

router.get("/health", (_req, res) => {
  res.json({ ok: true, db: db.readyState === 1 ? "connected" : "disconnected" });
});

// Lists the frontend needs (platforms, metric keys)
router.get("/meta", (_req, res) => res.json({ platforms: PLATFORMS, metrics: METRIC_KEYS }));

router.use("/entries", entryRoutes);
router.use("/accounts", accountRoutes);
router.use("/uploads", uploadRoutes);
router.use("/meta", connectRoutes); // Facebook / Instagram connections + weekly auto-fetch

router.use(notFoundRoute);
router.use(errorHandler);

export default router;
