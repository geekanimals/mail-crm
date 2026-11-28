// History shown on the Connections page: automatic / manual fetches, and every connect attempt (ok or failed)
import mongoose from "mongoose";
import { db } from "../db.js";

const syncLogSchema = new mongoose.Schema(
  {
    account: String,
    platform: String,
    week: { type: String, default: "" }, // empty for connect attempts
    end: { type: String, default: "" },
    ok: Boolean,
    message: String, // what was saved, or the error in plain words
    trigger: { type: String, enum: ["auto", "manual", "connect"], default: "auto" },
  },
  { timestamps: true }
);

syncLogSchema.index({ createdAt: -1 });

syncLogSchema.set("toJSON", {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

export const SyncLog = db.model("SyncLog", syncLogSchema);
