import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import type { Container } from "../application/container.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const secret = Buffer.from(expected);
  return provided.length === secret.length && timingSafeEqual(provided, secret);
}

export function internalJobRoutes(container: Container): Hono {
  const app = new Hono();

  app.post("/internal/jobs/renewal-check", async (c) => {
    if (!bearerMatches(c.req.header("authorization"), env.INTERNAL_JOB_SECRET)) {
      logger.warn("rejected renewal-check with bad job secret");
      return c.json({ error: "forbidden" }, 403);
    }

    const result = await container.renewal.run();
    return c.json({ status: "ok", ...result });
  });

  return app;
}
