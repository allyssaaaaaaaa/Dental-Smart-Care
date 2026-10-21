# SmartCare Dental - Backend API

REST API for **SmartCare: Automated Dental Services, Appointment Booking, and Communication Platform** (Group 13).

| Proposal feature | Where |
|---|---|
| Service catalog (procedures, fees ₱, durations, prep guidelines) | `routes/services.js` |
| Online booking against real-time dentist availability | `routes/appointments.js`, `services/scheduling.js` |
| Dentist portal (requests, weekly schedule, time off, duty status) | `routes/dentists.js`, `routes/appointments.js` |
| Real-time patient <-> dentist chat | `routes/messages.js` (REST + Server-Sent Events) |
| Patient records and profiles | `routes/patients.js` |
| Admin analytics, no-show stats, daily ledger CSV | `routes/admin.js` |

Requires **Node 22.13+** (`node -v`). Without `SUPABASE_DB_URL`, the app uses Node's built-in SQLite. When `SUPABASE_DB_URL` is configured, every backend API uses Supabase PostgreSQL through the `pg` package.

## Run it

```bash
cd backend
cp .env.example .env        # optional; defaults work for local dev
npm start                   # http://localhost:4000 (uses Supabase when SUPABASE_DB_URL is set)
npm test                    # 43 end-to-end tests, in-memory DB
npm run reset               # wipe + reseed the database
```

## Supabase schema and data import

The Supabase schema at `supabase/schema.sql` creates all 17 application tables, constraints, and indexes at backend startup. It includes the current face-descriptor consent fields, payment records, patient notes, messages/images, and migration history. Row Level Security is enabled without public policies so the tables are not exposed through the Supabase Data API by default. The backend connects with its private PostgreSQL URI; never put that URI in frontend variables.

To copy the existing SQLite data into an empty Supabase database:

1. In Supabase, open **Project Settings → Database → Connection string** and copy a PostgreSQL connection string. Use the session pooler if your network cannot reach the direct database host.
2. Put the connection string in `backend/.env` as `SUPABASE_DB_URL`. Do not commit this file or share the database password.
3. From `backend`, run `npm run supabase:import`. The script applies the schema, checks that all destination tables are empty, and then imports the existing records in foreign-key order in one transaction. If a destination table already contains data, it stops rather than merging or overwriting records.

Set `SUPABASE_DB_URL` in `backend/.env` to switch the running API from SQLite to Supabase. The import script is only needed once to copy local records; it refuses to import if destination tables already contain rows. The backend tests use isolated in-memory SQLite databases even when this URL is configured.

### Local sample accounts (seeded; password for both: `SmartCare123!`)

| Role | Email |
|---|---|
| Patient (Maria Santos, SC-98214) | `maria.santos@smartcare.test` |
| Dentist and clinic administrator (Dr. Elena Santos) | `admin@smartcare.test` |

Patients can create their own account from the login page. The clinic administrator is also the dentist; administrator sign-in can manage the dentist schedule, appointments, patient records and clinic settings. Legacy staff accounts in an existing database are disabled during startup without deleting their linked patient, appointment or message records. Queue endpoints and screens have been removed; existing queue history is left untouched in old database files.

## Connecting the Next.js frontend

1. Start the API with `npm start` in `backend`, then start the frontend with `npm run dev` in `frontend`. The frontend rewrites `/api/*` to `http://localhost:4000`; set `BACKEND_URL` if the API runs elsewhere. Development accepts HTTP loopback origins on any port. In production set `CORS_ORIGIN` to the exact comma-separated frontend origins; the API will refuse to start without it.
2. Login and patient registration use `/api/auth/login` and `/api/auth/register`. The API sets an `HttpOnly` `sc_token` cookie, and the frontend restores the user session with `/api/auth/me`.
3. `DEMO_MODE` defaults to `false`. Set it to `true` only for API tests or local development that needs `POST /api/auth/demo-login`.
4. **Live updates:** `new EventSource("/api/stream", { withCredentials: true })` and listen for
   `message.new`, `message.read`, `appointment.created|updated`, `dentist.status`.
   If your dev proxy buffers streams, point `EventSource` straight at `http://localhost:4000` (CORS is already configured) or poll `GET /api/conversations/:id/messages?after=<lastId>` every few seconds.

## Business rules implemented

- **Booking requests** from the portal start as `pending`; the dentist confirms or declines. No Facebook API, no online payments (pay-at-counter only; the ledger says so).
- **No double-booking:** overlap check on every create/reschedule (a 60-min procedure blocks both half-hour slots), inside a DB transaction. A patient also can't be booked in two places at once.
- **Slot hold:** `POST /api/slot-holds` reserves a slot for 5 min (the countdown in the booking UI). Other patients see it as booked; it's consumed when you book with `holdId`.
- **Availability** comes from each dentist's weekly hours (split shifts supported, e.g. lunch break) minus time-off, existing appointments, and holds. Past/too-soon times (30-min lead) are returned as `available:false` so the UI can disable them. Bookable up to 90 days ahead. All times are clinic-local (`CLINIC_TZ=Asia/Manila`).
- **Status flow:** `pending -> confirmed | declined | cancelled`, `confirmed -> completed | no_show | cancelled`. Patients may only cancel their own; completed/no-show only for today or earlier.
- **The administrator is the clinic dentist** and manages clinic and patient records (patients can self-register their own account; they can read but not edit their profile).
- **Chat privacy:** only the patient and clinic administrator in a conversation can read it. The administrator can privately contact patients with a clinic booking.

## Security

scrypt password hashing · HS256 signed tokens (12 h) in `HttpOnly; SameSite=Lax` cookies or `Authorization: Bearer` · role checks on every route · patients/dentists can only reach their own records (others get `404`, not `403`, so IDs can't be probed) · parameterized SQL everywhere · input validation with per-field errors · login rate-limit (10 / 15 min) · CORS allow-list + Origin check on writes (CSRF) · body size cap · CSV formula-injection guard · `NODE_ENV=production` refuses to start without `JWT_SECRET` or with demo login on.

**Data Privacy Act (PH):** this stores health-related personal data. Before real use, add HTTPS (`COOKIE_SECURE=true`), a privacy notice/consent on sign-up (your frontend already has `/privacy`), backups, and an access-log policy.

## Known limits / next steps

- SQLite remains the local default. Supabase mode uses one PostgreSQL connection on a worker thread to preserve the API's synchronous database interface; this suits a single backend instance, while higher concurrency deployments should migrate routes to a native asynchronous PostgreSQL API.
- Rate limiter and SSE hub are in-process (fine for one server).
- No email/SMS reminders (not in the proposal); `notify()` in `routes/appointments.js` is the place to hook them in.
- Medical records/inventory/payroll are out of scope per the proposal.
