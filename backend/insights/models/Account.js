// A company / team whose social accounts are tracked
import mongoose from "mongoose";
import { db } from "../db.js";

const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    key: { type: String, required: true, unique: true }, // lowercase name, blocks duplicates like "geek" vs "GEEK"
  },
  { timestamps: true }
);

accountSchema.set("toJSON", {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.key;
    return ret;
  },
});

export const Account = db.model("Account", accountSchema);
