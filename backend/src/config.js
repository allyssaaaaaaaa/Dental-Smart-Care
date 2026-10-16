import path from "node:path";

try {
  process.loadEnvFile(); // Node >= 20.12 / 22: loads ./.env if present
} catch {
  /* no .env file: fine */
}

export const COOKIE_NAME = "sc_token";

const bool = (v, d) => (v === undefined ? d : ["1", "true", "yes"].includes(String(v).toLowerCase()));
const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

export function loadConfig(overrides = {}) {
  const env = process.env;
  const isProd = env.NODE_ENV === "production";

  const config = {
    isProd,
    port: num(env.PORT, 4000),
    dbPath: env.DB_PATH || path.resolve("data", "smartcare.db"),
    jwtSecret: env.JWT_SECRET || "",
    corsOrigins: (env.CORS_ORIGIN || "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
    clinicTz: env.CLINIC_TZ || "Asia/Manila",
    demoMode: bool(env.DEMO_MODE, false),
    seedOnStart: bool(env.SEED_ON_START, !isProd),
    cookieSecure: bool(env.COOKIE_SECURE, isProd),
    tokenTtlSec: 60 * 60 * 12,
    slotStepMin: num(env.SLOT_STEP_MIN, 30),
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
  return config;
}
