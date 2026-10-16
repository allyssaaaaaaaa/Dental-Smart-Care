import { createApp } from "./app.js";

const { app, server, close } = createApp();
server.listen(app.config.port, () => {
  console.log(`SmartCare API listening on http://localhost:${app.config.port}`);
  console.log(`  DB: ${app.config.dbPath}  |  demo login: ${app.config.demoMode ? "ON" : "off"}  |  CORS: ${app.config.corsOrigins.join(", ")}`);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => close().then(() => process.exit(0)));
