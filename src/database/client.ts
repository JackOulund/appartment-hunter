import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

function ensureDirectory(url: string): void {
  if (!url.startsWith("file:")) return;
  const path = url.slice("file:".length);
  if (path === ":memory:") return;
  mkdirSync(dirname(path), { recursive: true });
}

export function createDatabaseClient(url: string = env.DATABASE_URL): Client {
  ensureDirectory(url);
  return createClient({ url });
}

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(client: Client = createDatabaseClient()) {
  return drizzle(client, { schema });
}

let cached: Database | undefined;

/** Single shared connection for the running server. Tests build their own. */
export function getDatabase(): Database {
  cached ??= createDatabase();
  return cached;
}

export { schema };
