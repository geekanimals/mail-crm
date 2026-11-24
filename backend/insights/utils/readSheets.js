// Any uploaded file -> { "Sheet name": rows[][] }
// CSV/TXT are read with our own parser; Excel (.xls/.xlsx) with SheetJS.
import * as XLSX from "xlsx";
import { parseCSV } from "./csv.js";

export function readSheets(file) {
  const name = file.originalname || file.name || "file";

  if (/\.(xlsx?|xlsm)$/i.test(name)) {
    const book = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
    const sheets = {};
    book.SheetNames.forEach((sheetName) => {
      sheets[sheetName] = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, raw: true, defval: "" });
    });
    return sheets;
  }

  return { [name]: parseCSV(decodeText(file.buffer)) };
}

// Text files can come as UTF-8 or UTF-16 (Meta Business Suite exports Views / Viewers / Follows… as UTF-16).
// Look at the byte-order mark (or the zero bytes of UTF-16 text) and decode accordingly.
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le", 2);
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16(); // big-endian → little-endian
    return swapped.toString("utf16le");
  }
  // no mark, but every other byte is zero → UTF-16 LE / BE without a BOM
  const sample = buf.subarray(0, 200);
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) (i % 2 ? oddZero++ : evenZero++);
  if (sample.length > 3 && oddZero > sample.length / 4 && evenZero === 0) return buf.toString("utf16le");
  if (sample.length > 3 && evenZero > sample.length / 4 && oddZero === 0) {
    const swapped = Buffer.from(buf.subarray(0, buf.length - (buf.length % 2)));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buf.toString("utf8").replace(/^\uFEFF/, ""); // drop a UTF-8 byte-order mark
}
