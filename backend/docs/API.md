# SmartCare API reference

Base URL `http://localhost:4000`. JSON in/out. Auth: `HttpOnly` cookie `sc_token` **or** `Authorization: Bearer <token>`.
Errors: `{ "error": { "code": "slot_unavailable", "message": "...", "details": { "field": "reason" } } }`
(`400` bad JSON · `401` not signed in · `403` wrong role · `404` not found · `409` conflict · `422` validation · `429` rate-limited)

Legend: 🌐 public · 🧑 patient · 🛡 dentist/clinic administrator

## Auth
| | Endpoint | Notes |
|---|---|---|
| 🌐 | `POST /api/auth/register` | `{fullName,email,password,phone,birthDate?,sex?}` -> creates patient account + profile, signs in |
| 🌐 | `POST /api/auth/login` | `{email,password}` -> `{token,user}`; patient and admin accounts only |
| 🌐 | `POST /api/auth/demo-login` | `{role}`; only when `DEMO_MODE=true` (test/development use) |
| any | `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/change-password` | |

## Catalog & dentists
| | Endpoint | Notes |
|---|---|---|
| 🌐 | `GET /api/services?category=&q=` | `{items:[{id,name,category,description,pricePhp,durationMin,prepGuidelines}],categories}` |
| 🌐 | `GET /api/services/:id` | |
| 🛡 | `POST /api/services` · `PATCH /api/services/:id` · `DELETE /api/services/:id` | delete = deactivate |
| 🌐 | `GET /api/dentists` · `GET /api/dentists/:id` | name, specialty, status, weekly schedule |
| 🌐 | `GET /api/dentists/:id/availability?date=YYYY-MM-DD&serviceId=` | `{dayStatus:"open|closed|time_off", slots:[{startTime,endTime,available,reason?}]}` |
| 🌐 | `GET /api/dentists/:id/availability/calendar?month=YYYY-MM&serviceId=` | per-day open-slot counts for the date picker |
| 🌐 | `GET /api/dentists/:id/schedule` | weekly hours + upcoming time off |
| 🛡 | `PUT /api/dentists/:id/schedule` | `{blocks:[{weekday(0=Sun),startTime,endTime}]}`; `:id` may be `me` |
| 🛡 | `POST /api/dentists/:id/time-off` · `DELETE /api/dentists/:id/time-off/:date` | `{date,reason?,force?}` |
| 🛡 | `PATCH /api/dentists/:id/status` | `{status:"available|on_break|off_duty"}` |
| 🛡 | `POST /api/dentists` · `PATCH /api/dentists/:id` | create/edit directory entries |

## Booking
| | Endpoint | Notes |
|---|---|---|
| 🧑🛡 | `POST /api/slot-holds` · `DELETE /api/slot-holds/:id` | `{serviceId,dentistId,date,startTime}` -> `{id,expiresAt,secondsLeft}` |
| 🧑🛡 | `POST /api/appointments` | `{serviceId,dentistId,date,startTime,notes?,holdId?}` |
| 🧑🛡 | `GET /api/appointments` | scoped by role. Filters: `scope=upcoming|past`, `status=a,b`, `date`, `from`, `to`, `year`, `q`, `dentistId`/`patientId` (admin), `page`, `pageSize`, `order` |
| 🧑🛡 | `GET /api/appointments/:id` | |
| 🧑🛡 | `PATCH /api/appointments/:id/status` | `{status:"confirmed|declined|cancelled|completed|no_show",reason?}` (role-limited) |
| 🧑 | `POST /api/appointments/:id/reschedule` | `{date,startTime,dentistId?,holdId?}` |

## Patients (administrator manages records; patients can read their own)
`GET /api/patients/me` 🧑 · `GET|POST /api/patients` · `GET|PATCH /api/patients/:id` 🛡 (search with `?q=`)

## Chat (patient & dentist only)
| Endpoint | Notes |
|---|---|
| `GET /api/conversations` | with `unread` counts |
| `POST /api/conversations` | patient `{dentistId}` / dentist `{patientId}`; get-or-create |
| `GET /api/conversations/:id/messages?limit=&before=` or `?after=<id>` | `after` = polling fallback |
| `POST /api/conversations/:id/messages` | `{body}` (<= 2000 chars) |
| `POST /api/conversations/:id/read` | |
| `GET /api/stream` | **SSE**: `message.new`, `message.read`, `appointment.created`, `appointment.updated`, `dentist.status` |

## Admin
`GET /api/admin/analytics?from=&to=` · `GET /api/admin/ledger.csv?date=` (Export Daily Ledger)
