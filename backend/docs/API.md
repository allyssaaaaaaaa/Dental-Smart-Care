# SmartCare API reference

Base URL `http://localhost:4000`. JSON in/out. Auth: `HttpOnly` cookie `sc_token` **or** `Authorization: Bearer <token>`.
Errors: `{ "error": { "code": "slot_unavailable", "message": "...", "details": { "field": "reason" } } }`
(`400` bad JSON · `401` not signed in · `403` wrong role · `404` not found · `409` conflict · `422` validation · `429` rate-limited)

Legend: 🌐 public · 🧑 patient · 🛡 clinic administrator

## Auth
| | Endpoint | Notes |
|---|---|---|
| 🌐 | `POST /api/auth/register` | `{fullName,email,password,phone,birthDate?,sex?}` -> creates patient account + profile, signs in |
| 🌐 | `POST /api/auth/login` | `{email,password}` -> `{token,user}`; patient and administrator (clinic dentist) accounts use one sign-in form |
| 🔐 | `POST /api/auth/face-enroll` | Authenticated account with explicit `{consent:true,descriptor:[128 numbers]}`; stores the descriptor encrypted at rest. `DELETE` on the same path removes it. Requires `FACE_DESCRIPTOR_KEY`. |
| 🔐 | `POST /api/auth/face-login` | `{descriptor:[128 numbers]}` -> matching role, redirect URL and HttpOnly session cookie; only active admin/patient accounts are considered. Requires `FACE_DESCRIPTOR_KEY`. |
| 🌐 | `POST /api/auth/demo-login` | `{role}`; development/test utility only, never enable in production |

Face descriptors are sensitive biometric data. Set a private, persistent 32-byte hex `FACE_DESCRIPTOR_KEY` on the backend (see `.env.example`); never expose it to the frontend or commit it. Descriptor matching does not prove liveness and may be vulnerable to replay/spoofing. Do not treat this as high-assurance authentication without adding a tested liveness mechanism and a consent, retention, and recovery policy.
| any | `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/change-password` | |

## Catalog & dentists
| | Endpoint | Notes |
|---|---|---|
| 🌐 | `GET /api/services?category=&q=` | `{items:[{id,name,category,description,pricePhp,durationMin,prepGuidelines}],categories}`; administrators may pass `includeInactive=1` |
| 🌐 | `GET /api/services/:id` | |
| 🛡 | `POST /api/services` · `PATCH /api/services/:id` · `DELETE /api/services/:id` | admin-only management; delete = deactivate |
| 🌐 | `GET /api/dentists` · `GET /api/dentists/:id` | name, specialty, status, weekly schedule |
| 🌐 | `GET /api/dentists/:id/availability?date=YYYY-MM-DD&serviceId=` | `{dayStatus:"open|closed|time_off", slots:[{startTime,endTime,available,reason?}]}` |
| 🌐 | `GET /api/dentists/:id/availability/calendar?month=YYYY-MM&serviceId=` | per-day open-slot counts for the date picker |
| 🌐 | `GET /api/dentists/:id/schedule` | weekly hours + upcoming time off |
| 🛡 | `PUT /api/dentists/:id/schedule` | `{blocks:[{weekday(0=Sun),startTime,endTime}]}`; `:id` may be `me` |
| 🛡 | `POST /api/dentists/:id/time-off` · `DELETE /api/dentists/:id/time-off/:date` | `{date,reason?,force?}` |
| 🛡 | `PATCH /api/dentists/:id/status` | `{status:"available|on_break|off_duty"}` |
| 🛡 | `POST /api/dentists` · `PATCH /api/dentists/:id` · `DELETE /api/dentists/:id` | admin-only directory management; dentist entries do not get individual logins; delete = deactivate; administrators may pass `includeInactive=1` |

Service and dentist create/edit/deactivate actions broadcast `clinic.catalog.updated` to authenticated `/api/stream` clients and the public dentist-directory feed, allowing open booking forms and the landing page to refresh their choices immediately. Directory-only dentists are managed by the clinic administrator and do not receive individual login accounts.

The public landing-page dentist directory listens to `GET /api/catalog/stream`, a read-only SSE feed that only receives clinic catalog change notifications.

| | Endpoint | Notes |
|---|---|---|
| 🧑 | `POST /api/appointments/:id/review` | Patient-only; `{rating:1..5,comment?,isPublic?}`; requires an appointment marked completed; one review per appointment |
| 🧑 | `GET /api/appointments` | Patient results include their own `patientReview` value |
| 🌐 | `GET /api/dentists` · `GET /api/dentists/:id` | Includes public rating averages/counts and up to three comments explicitly approved for public display |

## Booking
All appointments reserve one-hour time slots during the clinic's 8:00 AM–5:00 PM schedule (last start is 4:00 PM). Procedure treatment estimates remain in the service catalog. The opening hours migration preserves each dentist's existing working days while updating them to 8:00 AM–5:00 PM.
| | Endpoint | Notes |
|---|---|---|
| 🧑🛡 | `POST /api/slot-holds` · `DELETE /api/slot-holds/:id` | `{serviceId,dentistId,date,startTime}` -> `{id,expiresAt,secondsLeft}` |
| 🧑🛡 | `POST /api/appointments` | `{serviceId,dentistId,date,startTime,notes?,holdId?}` |
| 🧑🛡 | `GET /api/appointments` | scoped by role. Filters: `scope=upcoming|past`, `status=a,b`, `date`, `from`, `to`, `year`, `q`, `dentistId`/`patientId` (admin), `page`, `pageSize`, `order` |
| 🧑🛡 | `GET /api/appointments/:id` | |
| 🧑🛡 | `PATCH /api/appointments/:id/status` | `{status:"confirmed|declined|cancelled|completed|no_show",reason?}` (role-limited) |
| 🧑 | `POST /api/appointments/:id/reschedule` | `{date,startTime,dentistId?,holdId?}` |

Ortho/orthodontic/braces services can only be booked with the active dentist whose name includes “Petil”.

## Online booking deposits
Patients pay a 50% deposit via PayMongo Checkout before an online booking request can be confirmed. The remaining 50% is collected by the clinic at the visit.
| Endpoint | Notes |
|---|---|
| `GET /api/payments/config` | Reports whether PayMongo checkout is configured and which payment methods are enabled |
| `POST /api/payments/checkout` 🧑 | `{appointmentId}` -> hosted `checkoutUrl` and deposit amount |
| `POST /create-checkout-session` 🧑 | `{appointmentId,totalServiceAmount?}` -> hosted checkout; optional PHP amount is checked against the appointment price, then 50% is converted to centavos on the server. Success/cancel redirect to the patient's appointments page. |
| `GET /api/payments/:appointmentId` 🧑🛡 | Reads and verifies payment status |
| `POST /api/payments/webhook` or `POST /api/webhooks/paymongo` | Signed PayMongo webhook; `checkout_session.payment.paid` verifies the Checkout Session, records its payment ID and deposit amount, and confirms the appointment |

The hosted checkout returns the patient to `/patient/appointments?payment=success&appointmentId=...`; the patient dashboard verifies the stored Checkout Session with PayMongo. Both this redirect verification and the signed webhook use the same idempotent settlement operation. Paid deposits are recorded in `payment_transactions` and automatically confirm pending online appointments. The patient dashboard refreshes on appointment events and shows the remaining over-the-counter balance for paid/confirmed appointments.

## Patients (administrator manages records; patients can read their own)
`GET /api/patients/me` 🧑 · `GET|POST /api/patients` · `GET|PATCH /api/patients/:id` 🛡 (search with `?q=`)

`GET|PATCH /api/patients/:id/dentist-notes` 🛡 is restricted to the administrator/dentist account. These private clinical notes are stored separately from patient-submitted medical information and are not included in patient profile responses. Phone is optional when staff create a walk-in patient profile. Appointment `notes` can be supplied when creating a booking and are shown with the appointment.

`GET|POST /api/patients/:id/dentist-notes/entries` and `PATCH|DELETE /api/patients/:id/dentist-notes/entries/:noteId` provide private per-patient note history with edit/delete. Changes publish `dentist.note.updated` on `/api/stream` to refresh other open admin workspaces. Existing single-field dentist notes are migrated into this note history.

## Chat (patient & clinic administrator)
| Endpoint | Notes |
|---|---|
| `GET /api/conversations` | with `unread` counts |
| `POST /api/conversations` | patient `{dentistId}` / clinic administrator `{patientId}` (any patient with a clinic booking); get-or-create |
| `GET /api/conversations/:id/messages?limit=&before=` or `?after=<id>` | `after` = polling fallback |
| `POST /api/conversations/:id/messages` | `{body}` (<= 2000 chars) |
| `PATCH /api/conversations/:id/messages/:messageId` | edit your own text message `{body}` |
| `DELETE /api/conversations/:id/messages/:messageId` | delete your own message, including image attachments |
| `POST /api/conversations/:id/images` | `{fileName, contentType, imageBase64}` (JPEG/PNG/WebP, <= 5 MB); saved as a private conversation attachment |
| `GET /api/conversations/:id/images/:imageId` | Authenticated image delivery; only the conversation participants can access |
| `POST /api/conversations/:id/read` | |
| `GET /api/stream` | **SSE**: `message.new`, `message.updated`, `message.deleted`, `message.read`, `appointment.created`, `appointment.updated`, `dentist.status` |

## Admin
`GET /api/admin/insights?from=&to=` provides service volume/revenue, cancellations by hour, demographics by treatment, deposit and clinic balance audit, 30-day demand and schedule-based supply forecasts, monthly booked-value projection, and history-based no-show risk. `POST /api/admin/appointments/:id/settlement` records the full remaining clinic balance for a completed appointment. `GET /api/admin/analytics?from=&to=` provides summary analytics · `GET /api/admin/ledger.csv?date=` exports completed visits with online deposits, recorded OTC collections, and remaining balance.

Legacy over-the-counter balance settlement is not backfilled; an unrecorded balance does not establish whether it was collected. Demand and no-show outputs are historical heuristics, and supply forecasts do not use inventory quantities or per-procedure consumption.
Use `POST /api/patients` followed by `POST /api/appointments` with `patientId` and `source: "walk_in"` to register and book a walk-in. Staff-created walk-in appointments are confirmed immediately.

## Local staff login and PayMongo setup
Set `BOOTSTRAP_ADMIN_PASSWORD` in the backend `.env` to provision the local administrator account configured by `BOOTSTRAP_ADMIN_EMAIL`. Dentist profiles are clinic records, not separate sign-in accounts. Bootstrap account passwords are ignored in production.
Set `PAYMONGO_SECRET_KEY` (a secret key starting with `sk_test_` or `sk_live_`), `PAYMONGO_WEBHOOK_SECRET`, `PAYMONGO_PAYMENT_METHODS`, and `FRONTEND_URL` in the backend environment before enabling online deposits. `PAYMONGO_PAYMENT_METHODS` defaults to `card,gcash,grab_pay,paymaya`; include only methods activated for this PayMongo account. Register `POST /api/webhooks/paymongo` as the PayMongo checkout-session payment webhook. The backend loads its `.env` relative to `backend/src/config.js`, regardless of the process working directory. Never expose these secrets to the frontend.

Seeded demo accounts and their sample appointments are marked as demo data and are excluded from the dentist's real patient messaging contacts. They remain available for local demo/test sign-in; newly registered patient accounts are not marked as demo.
Seeded demo patient profiles and their appointments are also excluded from the admin/dentist appointment list, workspace patient search, analytics, and ledger. They are retained in the database, not deleted.
