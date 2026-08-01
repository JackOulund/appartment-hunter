/** Applies pending migrations. The server also does this at boot. */
import { createDatabase } from "../src/database/client.js";
import { runMigrations } from "../src/database/migrate.js";
import { env } from "../src/config/env.js";

const db = createDatabase();
await runMigrations(db);
console.log(`Migrations applied to ${env.DATABASE_URL}`);
