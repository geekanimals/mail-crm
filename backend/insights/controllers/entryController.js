// HTTP layer for entries — reads the request, calls the service, sends JSON
import * as entries from "../services/entryService.js";
import { entriesToCSV } from "../services/exportService.js";

export async function list(req, res) {
  const data = await entries.listEntries(req.query);
  res.json({ entries: data });
}

export async function save(req, res) {
  const { entry, replaced } = await entries.saveEntry(req.body);
  res.status(replaced ? 200 : 201).json({ entry, replaced });
}

export async function saveBulk(req, res) {
  const { saved, errors } = await entries.saveMany(req.body?.rows);
  res.status(201).json({ saved: saved.length, errors, entries: saved });
}

export async function remove(req, res) {
  await entries.deleteEntry(req.params.id);
  res.json({ deleted: true });
}

export async function exportCSV(req, res) {
  const data = await entries.listEntries(req.query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="insights-data.csv"');
  res.send(entriesToCSV(data));
}

// { ids: [...] } → removed from the database
export async function removeMany(req, res) {
  const deleted = await entries.deleteEntries(req.body?.ids);
  res.json({ deleted });
}
