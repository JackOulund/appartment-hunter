/**
 * `tsc` only emits JavaScript, so the .sql migrations and their journal have to
 * be copied into dist for the compiled server to be self-contained.
 */
import { cpSync, existsSync } from "node:fs";

const source = "src/database/migrations";
const target = "dist/src/database/migrations";

if (!existsSync(source)) {
  console.error(`No migrations found at ${source}. Run "npm run db:generate" first.`);
  process.exit(1);
}

cpSync(source, target, { recursive: true });
console.log(`Copied migrations to ${target}`);
