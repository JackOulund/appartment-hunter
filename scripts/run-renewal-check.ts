/**
 * Runs the renewal check locally, using the same service the protected job route
 * calls. Production should drive POST /internal/jobs/renewal-check from a real
 * scheduler rather than relying on an in-process timer.
 */
import { createApp } from "../src/app.js";
import { runMigrations } from "../src/database/migrate.js";
import { logger } from "../src/utils/logger.js";

const { container } = createApp();
await runMigrations(container.db);

const result = await container.renewal.run();
logger.info(result, "renewal check finished");
console.log(JSON.stringify(result, null, 2));
