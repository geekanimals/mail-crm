// One saved row = one account + one platform + one date range (week → end)
import mongoose from "mongoose";
import { db } from "../db.js";
import { METRIC_KEYS, PLATFORMS } from "../constants/metrics.js";

const metricFields = Object.fromEntries(METRIC_KEYS.map((k) => [k, { type: Number, default: 0, min: 0 }]));

const entrySchema = new mongoose.Schema(
  {
    week: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // start date
    end: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    account: { type: String, required: true, trim: true },
    platform: { type: String, required: true, enum: PLATFORMS },
    ...metricFields,
    sourceFiles: [{ type: String }],
  },
  { timestamps: true }
);

// Same account + platform + start date can exist only once (re-upload replaces it)
entrySchema.index({ account: 1, platform: 1, week: 1 }, { unique: true });
entrySchema.index({ week: 1 });

// Clean JSON for the frontend: id instead of _id, no internal fields
entrySchema.set("toJSON", {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

export const Entry = db.model("Entry", entrySchema);
