// A company's Facebook Page or Instagram account connected through Meta login — data is fetched from it every week
import mongoose from "mongoose";
import { db } from "../db.js";

const connectionSchema = new mongoose.Schema(
  {
    account: { type: String, required: true, trim: true }, // company in Insights, e.g. GBTG
    platform: { type: String, required: true, enum: ["Facebook", "Instagram", "YouTube"] },
    externalId: { type: String, required: true }, // Facebook Page ID / Instagram user ID / YouTube channel ID
    name: { type: String, default: "" }, // Page name / Instagram @username
    tokenEnc: { type: String, required: true }, // encrypted token (never sent to the browser) — YouTube keeps its refresh token here
    tokenExpiresAt: { type: Date, default: null }, // Instagram tokens last 60 days (refreshed automatically)
    connectedBy: { type: String, default: "" },
    status: { type: String, enum: ["ok", "error"], default: "ok" },
    lastError: { type: String, default: "" },
    lastFetchAt: { type: Date, default: null },
    lastFetchWeek: { type: String, default: "" }, // latest week saved by the automatic fetch
    failures: { type: Number, default: 0 }, // failed tries in a row (automatic retries stop after a few)
  },
  { timestamps: true }
);

connectionSchema.index({ account: 1, platform: 1 }, { unique: true });

connectionSchema.set("toJSON", {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.tokenEnc;
    return ret;
  },
});

export const Connection = db.model("Connection", connectionSchema);
