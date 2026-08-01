/**
 * Sets the iMessage contact card (name + profile photo) for our Linq line, so
 * recipients see "Hjem" with the house avatar instead of a bare phone number.
 *
 *   npm run linq:contact-card
 *   npm run linq:contact-card -- "Some Other Name"
 *
 * This is one-time setup, not a conversational send, but it still writes to a
 * real account — Linq's own guidance is to call the share endpoint after the
 * first outbound activity, not from a test harness. It refuses to run in
 * dry-run mode for the same reason send-test-card.ts does: a dry-run send would
 * prove nothing, and this never prints the API key or any other secret.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../src/database/schema.js";
import { createRepositories } from "../src/database/repositories/index.js";
import { LinqClient } from "../src/integrations/linq/linq-client.js";
import { env } from "../src/config/env.js";

if (env.LINQ_DRY_RUN) {
  console.error("LINQ_DRY_RUN is true — set it to false in .env to set a real contact card.");
  process.exit(1);
}

if (!env.LINQ_FROM_NUMBER) {
  console.error("LINQ_FROM_NUMBER must be set in .env.");
  process.exit(1);
}

const firstName = process.argv[2] ?? "Hjem";
const imageUrl = `${env.BASE_URL}/avatar.png`;

const db = drizzle(createClient({ url: env.DATABASE_URL }), { schema });
const linq = new LinqClient({ outbound: createRepositories(db).outbound });

console.log(`Setting contact card for ${env.LINQ_FROM_NUMBER}`);
console.log(`  first name: ${firstName}`);
console.log(`  image url:  ${imageUrl}`);

try {
  const result = await linq.setContactCard({
    firstName,
    phoneNumber: env.LINQ_FROM_NUMBER,
    imageUrl,
  });
  console.log(`\nDone. Active: ${result.isActive}`);
  console.log("Linq recommends re-triggering the share once a day after the first outbound activity.");
} catch (error) {
  console.error("\nSetting the contact card failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
