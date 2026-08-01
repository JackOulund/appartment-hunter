/**
 * Registers the webhook subscription with Linq.
 *
 *   npm run linq:webhook:register -- https://your-tunnel.example.com
 *   npm run linq:webhook:register -- https://your-tunnel.example.com/webhooks/linq
 *
 * Both forms work — the required path is appended when it is missing, because a
 * subscription pointed at `/` silently 404s on every delivery.
 *
 * Linq returns the signing secret exactly once, at creation. Rather than print
 * it — where it would land in terminal scrollback, CI logs or a screen share —
 * this writes it straight into .env as LINQ_WEBHOOK_SECRET.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import LinqAPIV3 from "@linqapp/sdk";
import { env } from "../src/config/env.js";

const WEBHOOK_PATH = "/webhooks/linq";

const target = process.argv[2];
if (!target) {
  console.error("usage: npm run linq:webhook:register -- <https-tunnel-url>");
  process.exit(1);
}

if (!env.linqApiKey) {
  console.error("LINQ_API_KEY (or LINQ_API_V3_API_KEY) must be set in .env first.");
  process.exit(1);
}

let url: URL;
try {
  url = new URL(target);
} catch {
  console.error(`Not a valid URL: ${target}`);
  process.exit(1);
}

if (url.protocol !== "https:") {
  console.error("Linq requires an HTTPS target URL — a tunnel, not localhost.");
  process.exit(1);
}

// The single most common mistake is passing the bare tunnel origin. Fix it
// rather than warning: a subscription on "/" 404s on every delivery.
if (url.pathname === "/" || url.pathname === "") {
  url.pathname = WEBHOOK_PATH;
  console.log(`Appended the webhook path → ${url.origin}${WEBHOOK_PATH}`);
} else if (url.pathname !== WEBHOOK_PATH) {
  console.error(
    `Refusing to register: path is "${url.pathname}" but this app serves the webhook at "${WEBHOOK_PATH}".`,
  );
  process.exit(1);
}

// Pin the payload version so a future default change cannot alter the shape.
url.searchParams.set("version", env.LINQ_WEBHOOK_VERSION);

const subscribedEvents = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
  "reaction.added",
  "reaction.removed",
] as const;

const client = new LinqAPIV3({ apiKey: env.linqApiKey });

// Quick tunnels get a new hostname on every restart, so stale subscriptions
// accumulate and keep retrying against dead hosts. Surface them.
const existing = await client.webhookSubscriptions.list();
const stale = existing.subscriptions.filter((s) => s.target_url !== url.toString());
if (stale.length > 0) {
  console.log(`\n${stale.length} other subscription(s) already exist:`);
  for (const subscription of stale) {
    console.log(`  ${subscription.id}  ${subscription.target_url}`);
  }
  console.log("Remove them with: npm run linq:webhook:delete -- <id>\n");
}

const subscription = await client.webhookSubscriptions.create({
  target_url: url.toString(),
  subscribed_events: [...subscribedEvents],
});

console.log("Webhook subscription created:");
console.log(`  id:             ${subscription.id}`);
console.log(`  target url:     ${subscription.target_url}`);
console.log(`  pinned version: ${env.LINQ_WEBHOOK_VERSION}`);
console.log(`  active:         ${subscription.is_active}`);
console.log(`  events:         ${subscription.subscribed_events.join(", ")}`);

/** Replaces the value of a key in .env, keeping comments and ordering intact. */
function setEnvValue(contents: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
}

if (!existsSync(".env")) {
  console.error("\n.env not found — cannot store the signing secret. Create it and re-run.");
  process.exit(1);
}

let contents = readFileSync(".env", "utf8");
contents = setEnvValue(contents, "LINQ_WEBHOOK_SECRET", subscription.signing_secret);
// Listing links are built from BASE_URL; on localhost they cannot open on a phone.
contents = setEnvValue(contents, "BASE_URL", url.origin);
contents = setEnvValue(contents, "LINQ_DRY_RUN", "false");
writeFileSync(".env", contents);

console.log("\nWrote to .env (not printed here):");
console.log("  LINQ_WEBHOOK_SECRET  <signing secret from Linq>");
console.log(`  BASE_URL             ${url.origin}`);
console.log("  LINQ_DRY_RUN         false");
console.log("\nRestart the server to pick these up. Messages are now live.");
