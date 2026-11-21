// Insights has its own database: INSIGHTS_MONGODB_URI in .env (separate from the CRM's MONGODB_URI).
// Not set → a separate database named "geek-insights" on the CRM's MongoDB server. CRM data is never touched.
import mongoose from "mongoose";
import { config } from "../config.js";

const uri = config.insightsMongoUri || config.mongoUri;
const options = config.insightsMongoUri ? {} : { dbName: "geek-insights" };

export const db = mongoose.createConnection(uri, options);

db.on("connected", () => console.log(`[insights] database connected (${db.name})`));
db.on("error", (e) => console.error("[insights] database error:", e.message));
db.asPromise().catch(() => {}); // a wrong Insights database never stops the CRM
