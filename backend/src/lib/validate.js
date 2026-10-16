import { invalid } from "./errors.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export const isTime = (s) => typeof s === "string" && TIME_RE.test(s);

/** Philippine mobile number -> +639XXXXXXXXX, or null if invalid. */
export function normalizePhone(p) {
  const s = String(p).replace(/[\s()-]/g, "");
  const m = /^(?:\+?63|0)(9\d{9})$/.exec(s);
  return m ? `+63${m[1]}` : null;
}

function check(rule, v, key) {
  switch (rule.type) {
    case "string": {
      if (typeof v !== "string") return [null, "Must be text"];
      const s = v.trim();
      if (!s.length) return [null, "Cannot be blank"];
      if (rule.min && s.length < rule.min) return [null, `Must be at least ${rule.min} characters`];
      if (s.length > (rule.max ?? 500)) return [null, `Must be at most ${rule.max ?? 500} characters`];
      return [s];
    }
    case "email": {
      if (typeof v !== "string") return [null, "Must be text"];
      const s = v.trim().toLowerCase();
      return s.length <= 254 && EMAIL_RE.test(s) ? [s] : [null, "Invalid email address"];
    }
    case "phone": {
      const n = normalizePhone(v);
      return n ? [n] : [null, "Use a valid PH mobile number, e.g. +63 917 123 4567 or 0917 123 4567"];
    }
    case "password": {
      if (typeof v !== "string" || v.length < 8 || v.length > 128) return [null, "Must be 8-128 characters"];
      if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return [null, "Must contain at least one letter and one number"];
      return [v];
    }
    case "int": {
      const n = typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : v;
      if (!Number.isInteger(n)) return [null, "Must be a whole number"];
      if (rule.min !== undefined && n < rule.min) return [null, `Must be >= ${rule.min}`];
      if (rule.max !== undefined && n > rule.max) return [null, `Must be <= ${rule.max}`];
      return [n];
    }
    case "number": {
      if (typeof v !== "number" || !Number.isFinite(v)) return [null, "Must be a number"];
      if (rule.min !== undefined && v < rule.min) return [null, `Must be >= ${rule.min}`];
      if (rule.max !== undefined && v > rule.max) return [null, `Must be <= ${rule.max}`];
      return [v];
    }
    case "enum":
      return rule.values.includes(v) ? [v] : [null, `Must be one of: ${rule.values.join(", ")}`];
    case "date":
      return isDate(v) ? [v] : [null, "Must be a date in YYYY-MM-DD format"];
    case "birthDate": {
      if (!isDate(v)) return [null, "Must be a date in YYYY-MM-DD format"];
      return v >= "1900-01-01" && v <= new Date().toISOString().slice(0, 10)
        ? [v] : [null, "Birth date is out of range"];
    }
    case "time":
      return isTime(v) ? [v] : [null, "Must be a time in HH:MM (24h) format"];
    case "bool":
      return typeof v === "boolean" ? [v] : [null, "Must be true or false"];
    default:
      throw new Error(`Unknown rule type for ${key}`);
  }
}

/** Validate `input` against a schema; returns a clean object or throws 422 with per-field details. */
export function parse(input, schema) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalid("Request body must be a JSON object");
  }
  const out = {};
  const errors = {};
  for (const [key, rule] of Object.entries(schema)) {
    const v = input[key];
    if (v === undefined || v === null || v === "") {
      if (rule.required) errors[key] = "Required";
      else if (v === null && rule.nullable) out[key] = null;
      else if (rule.default !== undefined) out[key] = rule.default;
      continue;
    }
    const [val, err] = check(rule, v, key);
    if (err) errors[key] = err;
    else out[key] = val;
  }
  if (Object.keys(errors).length) throw invalid("Please correct the highlighted fields", errors);
  return out;
}

export const parseQuery = (query, schema) => parse({ ...query }, schema);
