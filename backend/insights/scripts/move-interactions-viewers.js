// One-time fix for weeks uploaded from Meta Business Suite files before "Interactions" and "Viewers" existed.
// Those files have no likes and no unique reach: "Content interactions" was saved as likes and
// "Viewers" (added up day by day) was saved as reach. This moves them to the right place.
// Nothing is deleted. Safe to run again (a week already moved is skipped).
//
// Usage (from backend/):
//   node insights/scripts/move-interactions-viewers.js           → only shows what would change
//   node insights/scripts/move-interactions-viewers.js --apply   → saves the changes
import "dotenv/config";
import { db } from "../db.js";
import { Entry } from "../models/Entry.js";

const apply = process.argv.includes("--apply");
const base = (f) => f.split(/[\\/]/).pop().toLowerCase();
const isInteractionsFile = (f) => /^(content )?interactions/.test(base(f));
const isViewersFile = (f) => /^viewers/.test(base(f));

await db.asPromise();
console.log(`Database: ${db.name} — ${apply ? "SAVING changes" : "dry run (add --apply to save)"}`);

const weeks = await Entry.find({ platform: { $in: ["Facebook", "Instagram"] } }).sort({ account: 1, platform: 1, week: 1 });
let changed = 0;
for (const e of weeks) {
  const files = e.sourceFiles || [];
  const moves = [];
  if (files.some(isInteractionsFile) && !e.interactions && e.likes) {
    moves.push(`likes ${e.likes} → interactions`);
    e.interactions = e.likes;
    e.likes = 0;
  }
  if (files.some(isViewersFile) && !e.viewers && e.reach) {
    moves.push(`reach ${e.reach} → viewers`);
    e.viewers = e.reach;
    e.reach = 0;
  }
  if (!moves.length) continue;
  changed++;
  console.log(`${e.account} · ${e.platform} · ${e.week}–${e.end}: ${moves.join(", ")}`);
  if (apply) await e.save();
}

console.log(`${changed} week(s) ${apply ? "updated" : "would be updated"}, ${weeks.length - changed} left as they are.`);
await db.close();
