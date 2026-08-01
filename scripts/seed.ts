/**
 * Loads the mock catalogue into the database so listing links resolve before the
 * first search runs. Safe to re-run — listings are upserted by provider id.
 */
import { createDatabase } from "../src/database/client.js";
import { runMigrations } from "../src/database/migrate.js";
import { createRepositories } from "../src/database/repositories/index.js";
import { MOCK_LISTINGS } from "../src/integrations/housing/mock-listings.js";
import { logger } from "../src/utils/logger.js";

const db = createDatabase();
await runMigrations(db);

const repos = createRepositories(db);
await repos.listings.upsertMany(MOCK_LISTINGS);

const cities = [...new Set(MOCK_LISTINGS.map((l) => l.city))].sort();
logger.info(
  { listings: MOCK_LISTINGS.length, cities, active: MOCK_LISTINGS.filter((l) => l.isActive).length },
  "seeded mock listings",
);
