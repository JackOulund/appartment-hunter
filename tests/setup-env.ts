/**
 * Runs before any test module is imported, so `src/config/env.ts` validates
 * against a fixed configuration rather than whatever is in the developer's .env.
 * Dry-run and mock providers are forced on: tests never touch a real service.
 */
const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  PORT: "3999",
  BASE_URL: "http://localhost:3999",
  DATABASE_URL: ":memory:",
  LINQ_API_KEY: "",
  LINQ_FROM_NUMBER: "+46700000000",
  LINQ_WEBHOOK_SECRET: "",
  LINQ_DRY_RUN: "true",
  HOUSING_PROVIDER: "mock",
  CONTACT_DRY_RUN: "true",
  LLM_PROVIDER: "mock",
  LLM_API_KEY: "",
  ACTION_TOKEN_SECRET: "test-action-token-secret-value",
  INTERNAL_JOB_SECRET: "test-internal-job-secret",
  ALLOWED_SENDERS: "",
  RENEWAL_LEAD_DAYS: "30",
  LOG_LEVEL: "silent",
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] = value;
}
