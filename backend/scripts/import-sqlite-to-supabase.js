import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

try {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  process.loadEnvFile(path.resolve(directory, "..", ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const { Client } = pg;
const directory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(directory, "..");
const databaseUrl = process.env.SUPABASE_DB_URL?.trim().replace(/^['"]|['"]$/g, "");
if (!databaseUrl) {
  throw new Error("Set SUPABASE_DB_URL in backend/.env to your Supabase PostgreSQL connection string.");
}

const sourcePath = path.resolve(backendDirectory, process.env.DB_PATH || "./data/smartcare.db");
if (!fs.existsSync(sourcePath)) {
  throw new Error(`SQLite database not found at ${sourcePath}. Start the backend once to create it.`);
}

const tables = [
  "users",
  "patients",
  "dentist_patient_notes",
  "services",
  "dentists",
  "dentist_schedules",
  "dentist_time_off",
  "appointments",
  "dentist_reviews",
  "appointment_payments",
  "payment_transactions",
  "appointment_counter_payments",
  "slot_holds",
  "conversations",
  "messages",
  "message_images",
  "schema_migrations",
];

const sqlite = new DatabaseSync(sourcePath, { readOnly: true });
const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  try {
    await client.query("BEGIN");
    const schema = fs.readFileSync(path.resolve(backendDirectory, "supabase", "schema.sql"), "utf8");
    await client.query(schema);

    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*)::integer AS count FROM public."${table}"`);
      if (result.rows[0].count > 0) {
        throw new Error(`Supabase table "${table}" is not empty. Import stopped to avoid overwriting or mixing data.`);
      }
    }

    for (const table of tables) {
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const columnSql = columns.map((column) => `"${column}"`).join(", ");
      const valueSql = columns.map((_, index) => `$${index + 1}`).join(", ");
      const insert = `INSERT INTO public."${table}" (${columnSql}) VALUES (${valueSql})`;

      for (const row of rows) {
        const values = columns.map((column) => {
          const value = row[column];
          return table === "message_images" && column === "image_data" && value !== null
            ? Buffer.from(value)
            : value;
        });
        await client.query(insert, values);
      }
      console.log(`Imported ${rows.length} rows from ${table}`);
    }

    for (const table of tables) {
      if (table === "schema_migrations") continue;
      await client.query(
        `SELECT setval(pg_get_serial_sequence('public."${table}"', 'id'),
          COALESCE((SELECT MAX(id) FROM public."${table}"), 1),
          EXISTS (SELECT 1 FROM public."${table}"))`,
      );
    }

    await client.query("COMMIT");
    console.log("SQLite data import completed successfully.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
} finally {
  sqlite.close();
  await client.end();
}
