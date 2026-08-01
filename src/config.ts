function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  linqApiKey: required("LINQ_API_V3_API_KEY"),
  linqWebhookSecret: required("LINQ_WEBHOOK_SECRET"),
  /** One of your provisioned Linq numbers, E.164 — used when starting a new chat. */
  linqFromNumber: required("LINQ_FROM_NUMBER"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
};
