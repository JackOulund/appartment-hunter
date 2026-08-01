import { pino } from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "housing-agent" },
  // Belt and braces: even if a caller slips, pino strips these paths.
  redact: {
    paths: [
      "apiKey",
      "secret",
      "token",
      "authorization",
      "req.headers.authorization",
      "req.headers['webhook-signature']",
      "webhookSecret",
      "actionToken",
    ],
    censor: "[redacted]",
  },
  transport: env.isProduction
    ? undefined
    : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
});

export type Logger = typeof logger;

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
