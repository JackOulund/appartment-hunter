/**
 * Message bodies, phone numbers and email addresses must never reach the logs in
 * full. These helpers are the only sanctioned way to put user data into a log line.
 */

export function redactPhone(value: string | null | undefined): string {
  if (!value) return "(none)";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "***";
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
}

export function redactEmail(value: string | null | undefined): string {
  if (!value) return "(none)";
  const [local, domain] = value.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function redactHandle(value: string | null | undefined): string {
  if (!value) return "(none)";
  return value.includes("@") ? redactEmail(value) : redactPhone(value);
}

/** Keeps a short preview so demo logs stay useful without dumping message content. */
export function previewText(value: string | null | undefined, max = 40): string {
  if (!value) return "(empty)";
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max)}… (+${collapsed.length - max} chars)`;
}

const SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "secret",
  "token",
  "authorization",
  "password",
  "webhooksecret",
  "webhook_secret",
  "signature",
  "actiontoken",
  "confirmationtokenhash",
]);

/** Defence in depth for objects that reach the logger from adapters. */
export function redactObject(input: unknown, depth = 0): unknown {
  if (depth > 4 || input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((item) => redactObject(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[-_]/g, "");
    if (SENSITIVE_KEYS.has(normalized) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      output[key] = "[redacted]";
    } else if (normalized === "phone" || normalized === "contactphone") {
      output[key] = redactPhone(String(value));
    } else if (normalized === "email") {
      output[key] = redactEmail(String(value));
    } else {
      output[key] = redactObject(value, depth + 1);
    }
  }
  return output;
}
