import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  const configDirectory = path.dirname(fileURLToPath(import.meta.url));
  process.loadEnvFile(path.resolve(configDirectory, "..", ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

export const COOKIE_NAME = "sc_token";

const bool = (v, d) => (v === undefined ? d : ["1", "true", "yes"].includes(String(v).toLowerCase()));
const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
const ALLOWED_PAYMONGO_METHODS = new Set(["card", "gcash", "grab_pay", "paymaya"]);

function parsePayMongoMethods(value) {
  if (value === undefined || value.trim() === "") return ["card", "gcash", "grab_pay", "paymaya"];
  const methods = [...new Set(value.split(",").map((method) => method.trim()).filter(Boolean))];
  const invalid = methods.filter((method) => !ALLOWED_PAYMONGO_METHODS.has(method));
  if (!methods.length || invalid.length) {
    throw new Error(`PAYMONGO_PAYMENT_METHODS must be a comma-separated list of: ${[...ALLOWED_PAYMONGO_METHODS].join(", ")}`);
  }
  return methods;
}

function parseCorsOrigins(value) {
  return value.split(",").map((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return "";
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error(`Invalid CORS_ORIGIN entry: ${trimmed}`);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error(`CORS_ORIGIN must contain HTTP(S) origins: ${trimmed}`);
    }
    return url.origin;
  }).filter(Boolean);
}

export function loadConfig(overrides = {}) {
  const env = process.env;
  const isProd = env.NODE_ENV === "production";

  const config = {
    isProd,
    port: num(env.PORT, 4000),
    dbPath: env.DB_PATH || path.resolve("data", "smartcare.db"),
    supabaseDbUrl: env.SUPABASE_DB_URL || "",
    jwtSecret: env.JWT_SECRET || "",
    faceDescriptorKey: env.FACE_DESCRIPTOR_KEY || "",
    corsOrigins: parseCorsOrigins(env.CORS_ORIGIN || "http://localhost:3000"),
    clinicTz: env.CLINIC_TZ || "Asia/Manila",
    demoMode: bool(env.DEMO_MODE, false),
    seedOnStart: bool(env.SEED_ON_START, !isProd),
    cookieSecure: bool(env.COOKIE_SECURE, isProd),
    bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL || "allyssagrace@gmail.com",
    bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD || "",
    payMongoSecretKey: env.PAYMONGO_SECRET_KEY || "",
    payMongoWebhookSecret: env.PAYMONGO_WEBHOOK_SECRET || "",
    payMongoPaymentMethods: parsePayMongoMethods(env.PAYMONGO_PAYMENT_METHODS),
    frontendUrl: env.FRONTEND_URL || "http://localhost:3000",
    tokenTtlSec: 60 * 60 * 12,
    slotHoldMin: num(env.SLOT_HOLD_MIN, 5),
    minLeadMin: num(env.MIN_LEAD_MIN, 30),
    maxAdvanceDays: num(env.MAX_ADVANCE_DAYS, 90),
    clock: () => new Date(), // overridable in tests
    silent: false,
    ...overrides,
  };

  if (!config.jwtSecret) {
    if (config.isProd) throw new Error("JWT_SECRET is required when NODE_ENV=production");
    config.jwtSecret = "dev-only-secret-do-not-use-in-production";
  }
  if (config.isProd && config.demoMode) {
    throw new Error("DEMO_MODE must be false when NODE_ENV=production");
  }
  if (config.isProd && !env.CORS_ORIGIN) {
    throw new Error("CORS_ORIGIN must list the deployed frontend origin when NODE_ENV=production");
  }
  if (config.isProd && config.bootstrapAdminPassword) {
    throw new Error("Bootstrap account passwords must not be configured in production");
  }
  return config;
}
