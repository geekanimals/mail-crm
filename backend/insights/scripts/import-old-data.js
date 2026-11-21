// Copy Insights data from another database into the Insights database (INSIGHTS_MONGODB_URI).
// Usage (from backend/):  node insights/scripts/import-old-data.js "<from database URI>"
// Safe to run again: rows are matched (account + platform + week), never duplicated, nothing is deleted.
import "dotenv/config";
import mongoose from "mongoose";
import { db } from "../db.js";
import { Entry } from "../models/Entry.js";
import { Account } from "../models/Account.js";

const from = process.argv[2];
if (!from) {
  console.error('Usage: node insights/scripts/import-old-data.js "<from database URI>"');
  process.exit(1);
}

const old = await mongoose.createConnection(from).asPromise();
await db.asPromise();
if (old.host === db.host && old.port === db.port && old.name === db.name) {
  console.log("The source is already the Insights database — nothing to copy.");
  process.exit(0);
}

const oldAccounts = await old.collection("accounts").find().toArray();
const oldEntries = await old.collection("entries").find().toArray();

for (const a of oldAccounts) {
  const key = a.key || a.name.toLowerCase();
  await Account.updateOne({ key }, { $setOnInsert: { name: a.name, key } }, { upsert: true });
}
for (const e of oldEntries) {
  const { _id, __v, createdAt, updatedAt, ...row } = e;
  await Entry.updateOne({ account: row.account, platform: row.platform, week: row.week }, { $set: row }, { upsert: true, runValidators: true });
}

console.log(`Copied ${oldAccounts.length} companies and ${oldEntries.length} entries into ${db.name}.`);
await old.close();
await db.close();
