import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __proofcamPostgresPool: Pool | undefined;
}

function readDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "Missing DATABASE_URL. Add your Postgres connection string in the server environment.",
    );
  }

  return databaseUrl;
}

function createPool() {
  const connectionString = readDatabaseUrl();
  const shouldUseSsl =
    connectionString.includes("render.com") ||
    connectionString.includes("neon.tech") ||
    connectionString.includes("supabase.co");

  return new Pool({
    connectionString,
    max: 5,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
  });
}

export function getPostgresPool() {
  if (!globalThis.__proofcamPostgresPool) {
    globalThis.__proofcamPostgresPool = createPool();
  }

  return globalThis.__proofcamPostgresPool;
}
