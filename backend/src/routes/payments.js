import { createHmac, timingSafeEqual } from "node:crypto";
import { tx } from "../db.js";
import { HttpError, conflict, notFound } from "../lib/errors.js";
import { created, requireAuth, requireRole } from "../lib/router.js";
import { getAppointmentRow, requirePatientProfile } from "../services/lookup.js";

function paymentView(row) {
  return {
    appointmentId: row.appointment_id,
    status: row.status,
    paymentStatus: row.status === "paid" ? "Deposit Paid" : row.status,
    bookingStatus: row.appointment_status,
    depositAmountPhp: row.amount_centavos / 100,
    remainingAmountPhp: row.amount_centavos / 100,
    checkoutUrl: row.checkout_url,
    paymentId: row.provider_payment_id ?? null,
    amountPaidPhp: (row.amount_paid_centavos ?? 0) / 100,
  };
}

async function payMongoRequest(config, path, init = {}) {
  if (!/^sk_(test|live)_[A-Za-z0-9_-]+$/.test(config.payMongoSecretKey)) {
    throw new HttpError(
      503,
      "payment_not_configured",
      "The backend needs a valid PayMongo secret API key beginning with sk_test_ or sk_live_.",
    );
  }
  let response;
  try {
    response = await fetch(`https://api.paymongo.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.payMongoSecretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new HttpError(502, "payment_provider_unavailable", "PayMongo could not be reached. Please try again.");
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new HttpError(502, "invalid_payment_response", "PayMongo returned an invalid response.");
  }
  if (!response.ok) {
    const providerError = result?.errors?.[0];
    const detail = typeof providerError?.detail === "string" ? providerError.detail.slice(0, 300) : "";
    console.error("PayMongo request failed", {
      status: response.status,
      code: providerError?.code,
      detail: detail || undefined,
    });
    throw new HttpError(
      502,
      "payment_provider_error",
      detail ? `PayMongo rejected the checkout request: ${detail}` : "PayMongo could not process the payment request.",
    );
  }
  return result.data;
}

function getPayment(ctx, appointmentId) {
  const row = ctx.db.prepare(
    `SELECT ap.*, a.status AS appointment_status,
            pt.provider_payment_id, pt.amount_paid_centavos
     FROM appointment_payments ap
     JOIN appointments a ON a.id = ap.appointment_id
     LEFT JOIN payment_transactions pt ON pt.appointment_id = ap.appointment_id
     WHERE ap.appointment_id = ?`,
  ).get(appointmentId);
  if (!row) throw notFound("Payment");
  return row;
}

function checkoutPaymentId(session) {
  const attributes = session.attributes ?? {};
  return attributes.payments?.[0]?.id
    ?? attributes.payments?.data?.[0]?.id
    ?? session.relationships?.payments?.data?.[0]?.id
    ?? null;
}

function settlePaidDeposit(ctx, row, session) {
  const attributes = session.attributes ?? {};
  const providerPaymentId = checkoutPaymentId(session);
  if (!providerPaymentId) {
    throw new HttpError(502, "missing_payment_id", "PayMongo confirmed payment but did not return a payment ID.");
  }
  const amount = attributes.amount;
  if (Number.isSafeInteger(amount) && amount !== row.amount_centavos) {
    throw new HttpError(409, "payment_amount_mismatch", "The PayMongo payment amount does not match the expected deposit.");
  }

  tx(ctx.db, () => {
    ctx.db.prepare(
      `UPDATE appointment_payments
       SET status = 'paid', paid_at = COALESCE(paid_at, datetime('now')), updated_at = datetime('now')
       WHERE appointment_id = ? AND status = 'pending'`,
    ).run(row.appointment_id);
    ctx.db.prepare(
      `INSERT INTO payment_transactions
       (appointment_id, provider_checkout_id, provider_payment_id, amount_paid_centavos, status)
       VALUES (?,?,?,?, 'paid')
       ON CONFLICT(appointment_id) DO UPDATE SET
         provider_payment_id = COALESCE(payment_transactions.provider_payment_id, excluded.provider_payment_id),
         amount_paid_centavos = excluded.amount_paid_centavos,
         status = 'paid'`,
    ).run(row.appointment_id, row.provider_checkout_id, providerPaymentId, row.amount_centavos);
    ctx.db.prepare(
      `UPDATE appointments SET status = 'confirmed', updated_at = datetime('now')
       WHERE id = ? AND source = 'online_portal' AND status = 'pending'`,
    ).run(row.appointment_id);
  });

  const appointment = ctx.db.prepare(
    "SELECT id, reference, status, date, start_time, patient_id FROM appointments WHERE id = ?",
  ).get(row.appointment_id);
  const patientUserId = ctx.db.prepare("SELECT user_id FROM patients WHERE id = ?").get(appointment.patient_id)?.user_id;
  const payload = {
    id: appointment.id,
    reference: appointment.reference,
    status: appointment.status,
    date: appointment.date,
    startTime: appointment.start_time,
  };
  if (patientUserId) ctx.hub.toUser(patientUserId, "appointment.updated", payload);
  ctx.hub.toRoles(["admin", "clerk"], "appointment.updated", payload);
}

async function syncPayment(ctx, row) {
  if (row.status === "paid") {
    const transaction = ctx.db.prepare("SELECT 1 FROM payment_transactions WHERE appointment_id = ?").get(row.appointment_id);
    if (!transaction) {
      settlePaidDeposit(ctx, row, {
        id: row.provider_checkout_id,
        attributes: { status: "paid", payments: [{ id: row.provider_payment_id }] },
      });
    } else {
      ctx.db.prepare(
        `UPDATE appointments SET status = 'confirmed', updated_at = datetime('now')
         WHERE id = ? AND source = 'online_portal' AND status = 'pending'`,
      ).run(row.appointment_id);
    }
    return getPayment(ctx, row.appointment_id);
  }
  if (row.status !== "pending") return getPayment(ctx, row.appointment_id);
  const session = await payMongoRequest(ctx.config, `/checkout_sessions/${encodeURIComponent(row.provider_checkout_id)}`);
  const providerStatus = session.attributes?.status;
  if (providerStatus === "paid") {
    settlePaidDeposit(ctx, row, session);
  } else if (providerStatus === "expired") {
    ctx.db.prepare(
      "UPDATE appointment_payments SET status = 'expired', updated_at = datetime('now') WHERE appointment_id = ? AND status = 'pending'",
    ).run(row.appointment_id);
  }
  return getPayment(ctx, row.appointment_id);
}

function validWebhookSignature(header, rawBody, secret) {
  if (!header || !secret) return false;
  const values = Object.fromEntries(header.split(",").map((part) => {
    const [key, value] = part.trim().split("=", 2);
    return [key, value];
  }));
  const timestamp = values.t;
  const signatures = [values.li, values.te].filter(Boolean);
  if (!timestamp || !signatures.length) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  return signatures.some((signature) => {
    const receivedBuffer = Buffer.from(signature);
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  });
}

export default function register(router) {
  router.get("/api/payments/config", (ctx) => {
    const validSecret = /^sk_(test|live)_[A-Za-z0-9_-]+$/.test(ctx.config.payMongoSecretKey);
    return {
      enabled: validSecret && ctx.config.payMongoPaymentMethods.length > 0,
      depositPercent: 50,
      paymentMethods: ctx.config.payMongoPaymentMethods,
      ...(validSecret ? {} : {
        message: "The clinic's backend must be configured with a PayMongo secret key beginning with sk_test_ or sk_live_.",
      }),
    };
  });

  const createCheckoutSession = async (ctx) => {
    const { appointmentId, totalServiceAmount } = ctx.body ?? {};
    if (!Number.isSafeInteger(appointmentId) || appointmentId < 1) {
      throw new HttpError(422, "validation_error", "A valid appointmentId is required.");
    }
    const profile = requirePatientProfile(ctx.db, ctx.user);
    const appointment = getAppointmentRow(ctx.db, appointmentId);
    if (appointment.patient_id !== profile.id) throw notFound("Appointment");
    if (appointment.source !== "online_portal" || appointment.status !== "pending") {
      throw conflict("payment_not_available", "Only pending online appointment requests can be paid.");
    }
    if (
      totalServiceAmount !== undefined &&
      (!Number.isSafeInteger(totalServiceAmount) || totalServiceAmount !== appointment.price_php)
    ) {
      throw new HttpError(422, "amount_mismatch", "The service amount does not match the selected appointment.");
    }
    const existing = ctx.db.prepare("SELECT * FROM appointment_payments WHERE appointment_id = ?").get(appointmentId);
    if (existing) {
      if (existing.status === "paid") throw conflict("already_paid", "The booking deposit has already been paid.");
      if (existing.status === "pending") {
        const current = await syncPayment(ctx, existing);
        if (current.status === "paid") throw conflict("already_paid", "The booking deposit has already been paid.");
        if (current.status === "pending") return paymentView(current);
      }
    }

    const amountCentavos = Math.round(appointment.price_php * 100 * 0.5);
    if (amountCentavos < 1) throw conflict("payment_not_required", "This service does not require an online deposit.");
    const successUrl = new URL("/patient/appointments", ctx.config.frontendUrl);
    successUrl.searchParams.set("payment", "success");
    successUrl.searchParams.set("appointmentId", String(appointment.id));
    const cancelUrl = new URL("/patient/appointments", ctx.config.frontendUrl);
    cancelUrl.searchParams.set("payment", "cancelled");
    cancelUrl.searchParams.set("appointmentId", String(appointment.id));

    const checkout = await payMongoRequest(ctx.config, "/checkout_sessions", {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [{
              currency: "PHP",
              amount: amountCentavos,
              description: `50% booking deposit for ${appointment.service_name}`,
              name: appointment.service_name,
              quantity: 1,
            }],
            payment_method_types: ctx.config.payMongoPaymentMethods,
            description: `Appointment ${appointment.reference}`,
            reference_number: appointment.reference,
            success_url: successUrl.toString(),
            cancel_url: cancelUrl.toString(),
            metadata: { appointment_id: String(appointment.id) },
          },
        },
      }),
    });
    if (!checkout.id || !checkout.attributes?.checkout_url) {
      throw new HttpError(502, "invalid_payment_response", "PayMongo did not return a checkout URL.");
    }
    if (existing) {
      ctx.db.prepare(
        `UPDATE appointment_payments SET provider_checkout_id = ?, checkout_url = ?, amount_centavos = ?,
         status = 'pending', paid_at = NULL, updated_at = datetime('now') WHERE appointment_id = ?`,
      ).run(checkout.id, checkout.attributes.checkout_url, amountCentavos, appointment.id);
    } else {
      ctx.db.prepare(
        `INSERT INTO appointment_payments (appointment_id, provider_checkout_id, checkout_url, amount_centavos)
         VALUES (?,?,?,?)`,
      ).run(appointment.id, checkout.id, checkout.attributes.checkout_url, amountCentavos);
    }
    return created(paymentView(getPayment(ctx, appointment.id)));
  };

  router.post("/api/payments/checkout", requireRole("patient"), createCheckoutSession);
  router.post("/api/create-checkout-session", requireRole("patient"), createCheckoutSession);
  router.post("/create-checkout-session", requireRole("patient"), createCheckoutSession);

  router.get("/api/payments/:appointmentId", requireAuth, async (ctx) => {
    const appointment = getAppointmentRow(ctx.db, ctx.params.appointmentId);
    if (ctx.user.role === "patient") {
      if (appointment.patient_id !== requirePatientProfile(ctx.db, ctx.user).id) throw notFound("Appointment");
    } else if (ctx.user.role !== "admin" && ctx.user.role !== "dentist") {
      throw notFound("Appointment");
    }
    const row = getPayment(ctx, appointment.id);
    const current = ctx.user.role === "patient" ? await syncPayment(ctx, row) : row;
    return paymentView(current);
  });

  const handlePayMongoWebhook = async (ctx) => {
    if (!validWebhookSignature(
      ctx.req.headers["paymongo-signature"],
      ctx.rawBody,
      ctx.config.payMongoWebhookSecret,
    )) {
      throw new HttpError(400, "invalid_signature", "PayMongo webhook signature is invalid.");
    }
    const event = ctx.body?.data?.attributes;
    if (!event || typeof event.type !== "string") {
      throw new HttpError(400, "invalid_webhook", "PayMongo webhook payload is invalid.");
    }
    const checkoutId = event?.data?.id;
    if (typeof checkoutId !== "string") {
      throw new HttpError(400, "invalid_webhook", "PayMongo webhook payload is missing its checkout session.");
    }
    const row = ctx.db.prepare("SELECT * FROM appointment_payments WHERE provider_checkout_id = ?").get(checkoutId);
    if (row && event.type === "checkout_session.payment.paid") await syncPayment(ctx, row);
    return { received: true };
  };
  router.post("/api/payments/webhook", handlePayMongoWebhook);
  router.post("/api/webhooks/paymongo", handlePayMongoWebhook);
}
