import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Container } from "../application/container.js";
import { env } from "../config/env.js";

export function healthRoutes(container: Container): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", service: "housing-agent" }));

  /** Readiness includes the database, so a broken migration surfaces here. */
  app.get("/ready", async (c) => {
    try {
      await container.db.run(sql`select 1`);
      return c.json({
        status: "ready",
        database: "ok",
        housingProvider: env.HOUSING_PROVIDER,
        llmProvider: env.LLM_PROVIDER,
        linqDryRun: env.LINQ_DRY_RUN,
        contactDryRun: env.CONTACT_DRY_RUN,
      });
    } catch (error) {
      return c.json({ status: "degraded", database: "unavailable", error: String(error) }, 503);
    }
  });

  return app;
}
