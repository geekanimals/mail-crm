// Reads every uploaded file, picks the right parser and merges the numbers.
// A number found in two files is taken only once (no double counting).
import { readSheets } from "../utils/readSheets.js";
import { round2 } from "../utils/numbers.js";
import metaDaily from "./metaDaily.js";
import summarySheet from "./summarySheet.js";
import linkedinPersonal from "./linkedinPersonal.js";
import linkedinPage from "./linkedinPage.js";
import metaVideo from "./metaVideo.js";
import metaPosts from "./metaPosts.js";
import youtubeTable from "./youtubeTable.js";
import dailyTable from "./dailyTable.js";

// Order matters: most specific first
export const PARSERS = [metaDaily, summarySheet, linkedinPersonal, linkedinPage, metaVideo, metaPosts, youtubeTable, dailyTable];

// YouTube: "Totals" first (daily → exact dates for views), then "Table data" (likes, subscribers…),
// then "Chart data" (daily per video, only used for what is still missing)
const fileOrder = (f) => {
  const n = f.originalname || "";
  return /total/i.test(n) ? 0 : /table/i.test(n) ? 1 : /chart/i.test(n) ? 3 : 2;
};

// sheets already read → result (used directly by tests)
export function parseSheets(sheets, range, fileName = "") {
  const parser = PARSERS.find((p) => p.detect(sheets, fileName));
  if (!parser) return { format: null, values: {}, dates: [], note: "File format not recognised" };
  return { format: parser.id, label: parser.label, ...parser.parse(sheets, range, fileName) };
}

export function parseFiles(files, range) {
  const merged = {};
  const report = [];
  const dates = [];
  const rows = [];
  let totalFollowers;
  let wholeRange = false;

  [...files].sort((a, b) => fileOrder(a) - fileOrder(b)).forEach((file) => {
    let res;
    try {
      res = parseSheets(readSheets(file), range, file.originalname);
    } catch (err) {
      report.push({ name: file.originalname, ok: false, format: null, found: [], message: "Could not read file: " + err.message });
      return;
    }

    const found = [];
    let duplicate = false;
    Object.entries(res.values || {}).forEach(([k, v]) => {
      if (merged[k] !== undefined) return (duplicate = true);
      merged[k] = round2(v);
      found.push(k);
    });
    dates.push(...(res.dates || []));
    if (res.rows?.length) rows.push(...res.rows);
    if (res.totalFollowers !== undefined) totalFollowers = res.totalFollowers;
    if (res.wholeRange) wholeRange = true;

    const message = res.rows?.length
      ? `Found ${res.rows.length} weekly rows`
      : found.length
      ? "Found: " + found.join(", ")
      : duplicate
      ? "Already taken from another file (no double counting)"
      : res.note || "No usable numbers found";

    report.push({ name: file.originalname, ok: found.length > 0 || Boolean(res.rows?.length), format: res.label || null, found, message, note: res.note || "" });
  });

  dates.sort();
  return {
    values: merged,
    report,
    rows,
    totalFollowers,
    wholeRange,
    detected: dates.length ? { start: dates[0], end: dates.at(-1) } : null,
  };
}
