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

  return { [name]: parseCSV(file.buffer.toString("utf8")) };
}
