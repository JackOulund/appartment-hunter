import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Container } from "../application/container.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { AVATAR_PNG_BASE64 } from "../ui/avatar.js";

const AVATAR_PNG = Buffer.from(AVATAR_PNG_BASE64, "base64");

export function healthRoutes(container: Container): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", service: "housing-agent" }));

  /**
   * Serves the contact-card avatar. Linq's servers fetch this cross-origin when
   * applying the contact card (POST /v3/contact_card `image_url`), so it must be
   * reachable without cookies or referrer checks — a long, public cache is safe
   * because the image is baked into source and only changes on a redeploy.
   */
  app.get("/avatar.png", (c) => {
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(new Uint8Array(AVATAR_PNG), 200, { "Content-Type": "image/png" });
  });

  /**
   * Diagnostic page for the app card. It is plain HTML with no assets, so if a
   * phone can render this, the host is reachable and embeddable — and the hit is
   * logged, which distinguishes "the request never arrived" from "it arrived and
   * the page failed".
   */
  app.get("/card-check", (c) => {
    logger.info(
      { userAgent: c.req.header("user-agent"), referer: c.req.header("referer") },
      "card-check page opened",
    );
    return c.html(
      `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Card check</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;font:600 20px -apple-system,system-ui;background:#111;color:#eee">
<div style="text-align:center"><div style="font-size:56px">✓</div>The card opened this page.</div>`,
    );
  });

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
