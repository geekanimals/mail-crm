# Insights Dashboard (inside Geek CRM)

Weekly social media numbers: the team uploads each platform's export files, the API reads them and the
frontend (`/insights`) shows charts and week / month comparisons.

- Mounted at `/api/insights` in `server.js`, behind the CRM login (`requireAuth`).
- Who can use it: the admin and the **Insights login** — `INSIGHTS_USERNAME` / `INSIGHTS_PASSWORD` in `.env`
  (leave empty to turn it off). The same login page decides: admin → CRM, Insights login → `/insights` only;
  every other CRM API answers 403 for it.
- Its own database: `INSIGHTS_MONGODB_URI` in `.env`, separate from the CRM's `MONGODB_URI`
  (not set → a separate database `geek-insights` on the CRM's MongoDB server). CRM data is never touched.
- Moving data from another Insights database: `node insights/scripts/import-old-data.js "<from URI>"`
  (copies into the Insights database, never deletes).

| Folder | What it does |
|---|---|
| `index.js` | all Insights routes + access check + error handler |
| `parsers/` | read each platform's export format (Meta, Instagram, LinkedIn, YouTube, X summary sheet, daily tables) |
| `services/` | entries, companies, uploads, CSV export |
| `controllers/`, `routes/` | HTTP layer |
| `db.js`, `models/` | Insights database connection + MongoDB models |
| `utils/` | dates, numbers, CSV / Excel reading |
| `tests/` | parser tests: `npm run test:insights` |

| Method | Path | |
|---|---|---|
| GET | `/entries` · `/entries/export.csv` | saved rows |
| POST | `/entries` · `/entries/bulk` | save one / many |
| DELETE | `/entries/:id` | |
| GET/POST/PATCH/DELETE | `/accounts` | companies |
| POST | `/uploads/preview` | files → numbers (nothing saved) |
| GET | `/uploads/history` | |
