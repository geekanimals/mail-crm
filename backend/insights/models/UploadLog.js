// History of file uploads (what was uploaded, when, and what was found)
import mongoose from "mongoose";
import { db } from "../db.js";

const uploadLogSchema = new mongoose.Schema(
  {
    account: String,
    platform: String,
    week: String,
    end: String,
    files: [
      {
        name: String,
        format: String,
        ok: Boolean,
        message: String,
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

uploadLogSchema.set("toJSON", {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

export const UploadLog = db.model("UploadLog", uploadLogSchema);
