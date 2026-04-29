import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is missing. Add a Neon Postgres database URL first.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../db/migrations");
const migrationFiles = (await readdir(migrationsDir))
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort();

const sql = neon(databaseUrl);

for (const fileName of migrationFiles) {
  const migrationPath = path.join(migrationsDir, fileName);
  const migrationSql = await readFile(migrationPath, "utf8");
  const statements = migrationSql
    .split("-- statement-break")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await sql.query(statement);
  }

  console.log(`Applied ${fileName}`);
}

console.log(`Applied ${migrationFiles.length} theme catalog migration(s)`);
