const { Pool } = require("pg");
const logger = require("../lib/logger");
const observability = require("../lib/observability");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined,
});

pool.on("error", (error) => {
  logger.error({ err: error }, "unexpected PostgreSQL pool error");
  observability.captureException(error, { "error.kind": "database_pool", "error.code": error?.code });
});

async function closePool() {
  await pool.end();
}

module.exports = { pool, closePool };
