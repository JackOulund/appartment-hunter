import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Database } from "./client.js";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}
