import fs from "node:fs";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { seedIfEmpty } from "./seed.js";

const config = loadConfig();
if (process.argv.includes("--reset") && config.dbPath !== ":memory:") {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(config.dbPath + suffix, { force: true });
  console.log("Database reset.");
}
const { app, close } = createApp({ seedOnStart: false });
const seeded = seedIfEmpty(app);
console.log(seeded ? "Sample data inserted." : "Database already has data; nothing to do (use `npm run reset` to start over).");
await close();
