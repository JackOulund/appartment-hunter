import { z } from "zod";

const booleanish = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

const csv = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string()));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1).default("file:./data/housing-agent.db"),

  // The Linq SDK reads LINQ_API_V3_API_KEY from the environment; accept both names
  // so an existing .env written against the SDK default keeps working.
  LINQ_API_KEY: z.string().default(""),
  LINQ_API_V3_API_KEY: z.string().default(""),
  LINQ_FROM_NUMBER: z.string().default(""),
  LINQ_WEBHOOK_SECRET: z.string().default(""),
  LINQ_WEBHOOK_VERSION: z.string().default("2026-02-03"),
  LINQ_DRY_RUN: booleanish.default(true),

  // "card" opens the apartment inside Linq's iMessage app; "link" sends a plain
  // rich link, which opens in Safari instead. Switch to "link" if the in-app
  // web view cannot load the page.
  INSPECT_DELIVERY: z.enum(["card", "link"]).default("card"),

  HOUSING_PROVIDER: z.enum(["mock", "qasa"]).default("mock"),
  CONTACT_DRY_RUN: booleanish.default(true),

  LLM_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
  LLM_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default("claude-opus-5"),

  ACTION_TOKEN_SECRET: z.string().min(16).default("dev-only-action-token-secret-change-me"),
  INTERNAL_JOB_SECRET: z.string().min(8).default("dev-only-internal-job-secret"),

  ALLOWED_SENDERS: csv.default([]),
  RENEWAL_LEAD_DAYS: z.coerce.number().int().positive().default(30),
  // "silent" is a real pino level and is what the test suite uses.
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof schema> & {
  linqApiKey: string;
  llmApiKey: string;
  isProduction: boolean;
};

function build(source: NodeJS.ProcessEnv): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }

  const env = parsed.data;
  const linqApiKey = env.LINQ_API_KEY || env.LINQ_API_V3_API_KEY;
  const llmApiKey = env.LLM_API_KEY || env.ANTHROPIC_API_KEY;
  const isProduction = env.NODE_ENV === "production";

  // Live mode needs real credentials; failing here beats failing on the first webhook.
  if (!env.LINQ_DRY_RUN && (!linqApiKey || !env.LINQ_WEBHOOK_SECRET || !env.LINQ_FROM_NUMBER)) {
    throw new Error(
      "LINQ_DRY_RUN=false requires LINQ_API_KEY, LINQ_WEBHOOK_SECRET and LINQ_FROM_NUMBER to be set.",
    );
  }
  if (env.LLM_PROVIDER === "anthropic" && !llmApiKey) {
    throw new Error("LLM_PROVIDER=anthropic requires LLM_API_KEY (or ANTHROPIC_API_KEY).");
  }
  if (isProduction && env.ACTION_TOKEN_SECRET.startsWith("dev-only")) {
    throw new Error("ACTION_TOKEN_SECRET must be set to a real secret in production.");
  }

  return {
    ...env,
    linqApiKey,
    llmApiKey,
    isProduction,
  };
}

export const env: Env = build(process.env);
export const buildEnvForTest = build;
