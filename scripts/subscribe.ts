/**
 * One-time setup: point Linq's webhooks at your server.
 *
 *   npx tsx scripts/subscribe.ts https://your-tunnel.example.com/webhooks/linq
 *
 * Prints the signing secret — copy it into LINQ_WEBHOOK_SECRET. It is shown
 * once, so save it before the process exits.
 */
import { linq } from "../src/linq.js";

const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error("usage: tsx scripts/subscribe.ts <https-target-url>");
  process.exit(1);
}

// Pin the payload version explicitly — without it the subscription silently
// picks whatever is latest at creation time.
const url = new URL(targetUrl);
url.searchParams.set("version", "2026-02-03");

const subscription = await linq.webhookSubscriptions.create({
  target_url: url.toString(),
  subscribed_events: ["message.received"],
});

console.log(JSON.stringify(subscription, null, 2));
