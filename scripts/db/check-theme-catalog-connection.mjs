import { neon } from "@neondatabase/serverless";

import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is missing. Add a Neon Postgres database URL first.");
  process.exit(1);
}

const sql = neon(databaseUrl);
const rows = await sql`select now() as connected_at`;
const connectedAt = rows[0]?.connected_at;

console.log(`Theme catalog database connection OK: ${connectedAt}`);
