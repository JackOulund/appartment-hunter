import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { runMigrations } from "./database/migrate.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const { app, container } = createApp();

  // Migrations run at boot so a fresh clone works with a single command.
  await runMigrations(container.db);
  logger.info("database migrations applied");

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info(
      {
        port: info.port,
        baseUrl: env.BASE_URL,
        housingProvider: env.HOUSING_PROVIDER,
        llmProvider: env.LLM_PROVIDER,
        linqDryRun: env.LINQ_DRY_RUN,
        contactDryRun: env.CONTACT_DRY_RUN,
      },
      "housing agent listening",
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.fatal({ error: String(error) }, "failed to start");
  process.exit(1);
});
