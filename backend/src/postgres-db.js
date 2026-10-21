import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const WORKER_FILE = new URL("./postgres-worker.js", import.meta.url);
const RESPONSE_BYTES = 16 * 1024 * 1024;
const RESPONSE_TIMEOUT_MS = 30_000;
const BASE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function translateSql(source) {
  let sql = source
    .replace(/\bBEGIN\s+IMMEDIATE\b/gi, "BEGIN")
    .replace(/\bdatetime\('now'\)/gi, "to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')")
    .replace(/\bdatetime\(\?\)/gi, "CAST(? AS timestamp)")
    .replace(/datetime\(([^()]*)\)/gi, "CAST($1 AS timestamp)")
    .replace(/strftime\('%w',\s*([^)]+)\)/gi, "EXTRACT(DOW FROM $1::date)")
    .replace(/\bSUM\(([\w.]+)\s*=\s*('[^']*')\)/gi, "COUNT(*) FILTER (WHERE $1 = $2)")
    .replace(/COLLATE\s+NOCASE/gi, "")
    .replace(/\bLIKE\b/gi, "ILIKE");

  sql = sql.replace(
    /INSERT\s+OR\s+IGNORE\s+INTO\s+([\w.]+)\s*/i,
    "INSERT INTO $1 ",
  );
  if (/^\s*INSERT\s+OR\s+IGNORE\b/i.test(source)) {
    sql = sql.replace(/;\s*$/, "");
    if (!/\bON\s+CONFLICT\b/i.test(sql)) sql += " ON CONFLICT DO NOTHING";
  }
  sql = sql.replace(
    /INSERT\s+OR\s+REPLACE\s+INTO\s+dentist_time_off\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
    "INSERT INTO dentist_time_off ($1) VALUES ($2) ON CONFLICT (dentist_id, date) DO UPDATE SET reason = EXCLUDED.reason",
  );

  let index = 0;
  sql = sql.replace(/\?/g, () => `$${++index}`);
  if (/^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql) && !/^\s*INSERT\s+INTO\s+(?:public\.)?schema_migrations\b/i.test(sql)) {
    sql = sql.replace(/;\s*$/, "") + " RETURNING id";
  }
  return sql;
}

function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    if (value.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]));
  }
  return value;
}

export class PostgresDatabase {
  constructor(connectionString) {
    this.shared = new SharedArrayBuffer(RESPONSE_BYTES + 8);
    this.state = new Int32Array(this.shared, 0, 2);
    this.output = new Uint8Array(this.shared, 8);
    this.worker = new Worker(WORKER_FILE, {
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
      workerData: { connectionString, shared: this.shared, responseBytes: RESPONSE_BYTES },
    });
    try {
      this.request({ action: "ready" });
      const schemaPath = path.join(BASE_DIRECTORY, "supabase", "schema.sql");
      this.exec(fs.readFileSync(schemaPath, "utf8"));
    } catch (error) {
      this.worker.terminate();
      throw error;
    }
  }

  request(request) {
    Atomics.store(this.state, 0, 0);
    Atomics.store(this.state, 1, 0);
    this.worker.postMessage(request);
    const result = Atomics.wait(this.state, 0, 0, RESPONSE_TIMEOUT_MS);
    if (result === "timed-out") {
      throw new Error("Timed out waiting for the Supabase PostgreSQL connection");
    }
    const length = Atomics.load(this.state, 1);
    const response = JSON.parse(Buffer.from(this.output.subarray(0, length)).toString("utf8"));
    if (!response.ok) {
      const error = new Error(response.error.message);
      Object.assign(error, response.error);
      throw error;
    }
    return revive(response.result);
  }

  exec(sql) {
    return this.request({ action: "exec", sql: translateSql(sql) });
  }

  prepare(source) {
    const sql = translateSql(source);
    return {
      all: (...values) => this.request({ action: "query", sql, values, mode: "all" }),
      get: (...values) => this.request({ action: "query", sql, values, mode: "get" }) ?? undefined,
      run: (...values) => this.request({ action: "query", sql, values, mode: "run" }),
    };
  }

  close() {
    try {
      this.request({ action: "close" });
    } finally {
      this.worker.terminate();
    }
  }
}
