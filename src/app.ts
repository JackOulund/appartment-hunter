import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createContainer, type Container, type ContainerOverrides } from "./application/container.js";
import { healthRoutes } from "./routes/health.js";
import { linqWebhookRoutes } from "./routes/linq-webhook.js";
import { listingRoutes } from "./routes/listings.js";
import { applicationRoutes } from "./routes/applications.js";
import { internalJobRoutes } from "./routes/internal-jobs.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { isAppError } from "./utils/errors.js";

/** Fixed-window limiter for the action routes. In-memory, per process. */
function rateLimit(options: { windowMs: number; max: number; prefixes: string[] }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async (c: { req: { path: string; header: (n: string) => string | undefined }; json: (v: unknown, s?: number) => Response }, next: () => Promise<void>) => {
    if (!options.prefixes.some((prefix) => c.req.path.startsWith(prefix))) return next();

    const key =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "local";
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > options.max) {
      logger.warn({ path: c.req.path }, "rate limit exceeded");
      return c.json({ error: "rate_limited" }, 429);
    }
    return next();
  };
}

export function createApp(overrides: ContainerOverrides = {}): { app: Hono; container: Container } {
  const container = createContainer(overrides);
  const app = new Hono();

  // The inspect view is opened inside Linq's iMessage app, so it must survive
  // being embedded cross-origin: SAMEORIGIN framing and a same-origin resource
  // policy would both block that. It is a read-only page, so nothing is at risk.
  //
  // Everything else keeps the strict defaults — above all the application review
  // page, where framing would be a clickjacking route onto an irreversible SEND.
  const strict = secureHeaders();
  const embeddable = secureHeaders({
    xFrameOptions: false,
    crossOriginResourcePolicy: "cross-origin",
    crossOriginOpenerPolicy: false,
  });
  const isEmbeddable = (path: string) => path.startsWith("/l/") || path === "/card-check";
  app.use("*", (c, next) => (isEmbeddable(c.req.path) ? embeddable(c, next) : strict(c, next)));
  app.use(
    "*",
    rateLimit({
      windowMs: 60_000,
      max: 60,
      prefixes: ["/api/", "/l/", "/applications/"],
    }),
  );

  app.route("/", healthRoutes(container));
  app.route("/", linqWebhookRoutes(container));
  app.route("/", listingRoutes(container));
  app.route("/", applicationRoutes(container));
  app.route("/", internalJobRoutes(container));

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((error, c) => {
    if (isAppError(error)) {
      logger.warn({ code: error.code, message: error.message }, "request failed");
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    logger.error({ error: String(error) }, "unhandled error");
    return c.json({ error: "internal_error" }, 500);
  });

  return { app, container };
}
