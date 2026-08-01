/**
 * Sends one app card to a handle you name, so you can confirm the inspect view
 * renders on a real device before demoing.
 *
 *   npm run linq:test-card -- +46700000000
 *   npm run linq:test-card -- +46700000000 https://example.com
 *
 * The second argument is the URL the card opens; it defaults to this app. Pass a
 * known-good public URL to tell "the card is broken" apart from "my host is not
 * reachable from the phone".
 *
 * This sends a real iMessage. It refuses to run in dry-run mode, because a
 * dry-run send would prove nothing — the point is the round trip.
 *
 * The recipient must have texted your Linq number at least once: the shared line
 * only accepts outbound sends into a conversation the other person started, and
 * an action cannot be the first message in a brand-new chat.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../src/database/schema.js";
import { createRepositories } from "../src/database/repositories/index.js";
import { LinqClient } from "../src/integrations/linq/linq-client.js";
import { env } from "../src/config/env.js";

const handle = process.argv[2];
if (!handle) {
  console.error("usage: npm run linq:test-card -- <+E.164 handle> [url]");
  process.exit(1);
}
if (env.LINQ_DRY_RUN) {
  console.error("LINQ_DRY_RUN is true — set it to false in .env to send a real card.");
  process.exit(1);
}

const db = drizzle(createClient({ url: env.DATABASE_URL }), { schema });
const linq = new LinqClient({ outbound: createRepositories(db).outbound });

// Defaults to a real HTML page, not /health — a JSON body in a web view tells you
// nothing about whether the page would have rendered.
const url = process.argv[3] ?? `${env.BASE_URL}/card-check`;
console.log(`Sending a test card to ${handle}`);
console.log(`  url:   ${url}`);
console.log(`  title: Inspect view test`);

try {
  const result = await linq.sendActionCard({
    chatId: "test-card",
    toHandle: handle,
    url,
    title: "Inspect view test",
    subtitle: "If you can see this card, app cards work",
    button: "Open",
    // Timestamped so the script can be run more than once.
    idempotencyKey: `housing:test-card:${Date.now()}`,
  });
  console.log(`\nAccepted. Linq message id: ${result.messageId}`);
  console.log("If no card arrives, check that this handle has texted your Linq number.");
} catch (error) {
  console.error("\nThe card was rejected:");
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\nPresentation falls back to a plain rich link when this happens,");
  console.error("so the demo still works — the apartment just opens in the browser.");
  process.exit(1);
}
