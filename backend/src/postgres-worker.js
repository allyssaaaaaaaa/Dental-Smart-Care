import { parentPort, workerData } from "node:worker_threads";
import { Client, types } from "pg";

types.setTypeParser(20, (value) => Number(value));

const state = new Int32Array(workerData.shared);
const output = new Uint8Array(workerData.shared, 8);
const client = new Client({
  connectionString: workerData.connectionString,
  connectionTimeoutMillis: 10_000,
  application_name: "smartcare-api",
});

let ready;
try {
  await client.connect();
  ready = { ok: true };
} catch (error) {
  ready = serializeError(error);
}

function serializeError(error) {
  return {
    ok: false,
    error: {
      message: error.message,
      code: error.code,
      constraint: error.constraint,
    },
  };
}

function notify(response) {
  const bytes = Buffer.from(JSON.stringify(response));
  if (bytes.length > output.length) {
    const tooLarge = Buffer.from(JSON.stringify({
      ok: false,
      error: { message: "PostgreSQL response exceeded the adapter response limit", code: "RESPONSE_TOO_LARGE" },
    }));
    output.set(tooLarge);
    Atomics.store(state, 1, tooLarge.length);
  } else {
    output.set(bytes);
    Atomics.store(state, 1, bytes.length);
  }
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
}

parentPort.on("message", async (request) => {
  if (request.action === "ready") {
    notify(ready);
    return;
  }
  if (request.action === "close") {
    try {
      await client.end();
      notify({ ok: true });
    } catch (error) {
      notify(serializeError(error));
    }
    return;
  }
  if (!ready.ok) {
    notify(ready);
    return;
  }

  try {
    if (request.action === "exec") {
      await client.query(request.sql);
      notify({ ok: true, result: null });
      return;
    }

    const result = await client.query(request.sql, request.values);
    if (request.mode === "all") {
      notify({ ok: true, result: result.rows });
    } else if (request.mode === "get") {
      notify({ ok: true, result: result.rows[0] ?? null });
    } else {
      notify({
        ok: true,
        result: {
          changes: result.rowCount ?? 0,
          lastInsertRowid: result.rows[0]?.id ?? 0,
        },
      });
    }
  } catch (error) {
    notify(serializeError(error));
  }
});
