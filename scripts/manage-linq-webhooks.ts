/**
 * Lists or deletes webhook subscriptions.
 *
 *   npm run linq:webhook:list
 *   npm run linq:webhook:delete -- <subscriptionId>
 *
 * Quick tunnels change hostname on every restart, so stale subscriptions pile up
 * and keep retrying against dead hosts for ~25 minutes each. This clears them.
 */
import LinqAPIV3 from "@linqapp/sdk";
import { env } from "../src/config/env.js";

if (!env.linqApiKey) {
  console.error("LINQ_API_KEY (or LINQ_API_V3_API_KEY) must be set in .env first.");
  process.exit(1);
}

const client = new LinqAPIV3({ apiKey: env.linqApiKey });
const [command, id] = process.argv.slice(2);

if (command === "delete") {
  if (!id) {
    console.error("usage: npm run linq:webhook:delete -- <subscriptionId>");
    process.exit(1);
  }
  await client.webhookSubscriptions.delete(id);
  console.log(`Deleted subscription ${id}`);
  process.exit(0);
}

const { subscriptions } = await client.webhookSubscriptions.list();

if (subscriptions.length === 0) {
  console.log("No webhook subscriptions.");
  process.exit(0);
}

console.log(`${subscriptions.length} subscription(s):\n`);
for (const subscription of subscriptions) {
  const path = safePath(subscription.target_url);
  const suspicious = path === "/" || path === "";
  console.log(`  ${subscription.id}`);
  console.log(`    url:    ${subscription.target_url}${suspicious ? "   ← path is '/', deliveries will 404" : ""}`);
  console.log(`    active: ${subscription.is_active}`);
  console.log(`    events: ${subscription.subscribed_events.join(", ")}`);
  console.log("");
}
console.log("Delete one with: npm run linq:webhook:delete -- <id>");

function safePath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return "";
  }
}
