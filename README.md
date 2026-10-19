# Geek CRM

Email outreach with automatic follow-ups that **stop the moment someone replies**.

```
crmXgeek/
├── backend/    Node.js + Express + MongoDB   (port 5001)
└── frontend/   Next.js, every page is one .jsx file with its own CSS inside
```

## How it works
1. **Import CSV** → contacts (ClientMagnet subject/body are sent as-is). Existing contacts are skipped, so nobody gets the first email twice.
2. **Create campaign** → first email + follow-ups (default: every 2 days for 10 days).
3. **Start** → emails go out within the daily limit and sending hours.
4. Before every follow-up the inbox is checked (IMAP). **Reply found → all follow-ups stop**, the person shows up under **Replies**.
5. Every email has an **Unsubscribe** link. Unsubscribed people are never emailed again (even if re-imported).
6. **Dashboard** shows sent / opened / replied and **which follow-up brought the replies**.

## Backend (port 5001)
```bash
cd backend
cp .env.example .env     # fill in MongoDB, ADMIN_USERNAME / ADMIN_PASSWORD, JWT_SECRET, SMTP, IMAP
npm install
npm run dev
```
Everything is read from `.env` — including the admin login ID and password.

| File | What it does |
|---|---|
| `server.js` | starts the API |
| `config.js` | reads `.env` |
| `models.js` | all MongoDB models |
| `mail.js` | builds & sends emails (SMTP) |
| `worker.js` | sends due emails every minute, checks replies (IMAP) |
| `routes/` | auth, contacts, campaigns, dashboard (+replies, settings), public (unsubscribe/tracking) |

**Gmail:** turn on 2-step verification → create an App Password → `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `IMAP_HOST=imap.gmail.com`, enable IMAP in Gmail settings.

## Frontend
```bash
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:5001
npm install
npm run dev                        # http://localhost:3000
```

| Page | File |
|---|---|
| Login | `src/app/login/page.jsx` |
| Sidebar + shared styles | `src/app/(app)/layout.jsx` |
| Dashboard | `src/app/(app)/page.jsx` |
| Contacts | `src/app/(app)/contacts/page.jsx` |
| Import CSV | `src/app/(app)/import/page.jsx` |
| Campaigns | `src/app/(app)/campaigns/page.jsx` |
| Replies | `src/app/(app)/replies/page.jsx` |
| Settings | `src/app/(app)/settings/page.jsx` |

Each file has its CSS at the bottom (`const css = ...`). There is no global CSS file.

**Logo:** replace `frontend/public/logo.svg` (or set `NEXT_PUBLIC_LOGO_URL`).

## File format (CSV / Excel)
`name`, `email` (required), `company`, `subject`, `body` → the **first email** for that person.

**Follow-ups** are fixed in `backend/templates.js` (5 emails, only `{{firstName}}` and `{{company}}` change).
They go as "Re: first subject" in the same thread with earlier emails quoted below, only if the person has not replied.
- Gap: picked from the dropdown on the Import page (every 1/2/3/4/5/7/10 **working days**). Default `DEFAULT_FOLLOWUP_INTERVAL_DAYS`.
- `SKIP_WEEKENDS=true`: nothing is sent on Saturday/Sunday and they are not counted (Thursday + 2 working days = Monday).
- CC: `MAIL_CC` in `.env`, or change it in **Settings**, on the Import page, or per campaign.

## Rate limiting
All limits are per IP and set in `.env` (see `backend/limits.js`):
| What | Default |
|---|---|
| Wrong logins | 5 per 15 min, then blocked 15 min |
| Normal app requests | 300 per minute |
| Uploads / run queue / inbox check / start campaign | 20 per minute |
| Test emails | 5 per 10 min |
| Unsubscribe & tracking links | 60 per minute |
| Emails sent | `HOURLY_SEND_LIMIT` (30/hour) and `DAILY_SEND_LIMIT` (100/day) |

## Production
Backend: set `NODE_ENV=production`, `TRUST_PROXY=1`, `PUBLIC_BACKEND_URL=https://your-api`, `FRONTEND_URL=https://your-site`. Run one instance.
Frontend: set `NEXT_PUBLIC_API_URL=https://your-api`.
