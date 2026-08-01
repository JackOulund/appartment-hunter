import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyInput {
  rawBody: string;
  headers: Record<string, string | undefined>;
  secret: string;
  /** Deliveries older than this are rejected as replays. */
  toleranceSeconds?: number;
  now?: Date;
}

export type VerifyResult =
  | { valid: true; eventId: string; timestamp: Date }
  | { valid: false; reason: "missing_headers" | "bad_timestamp" | "stale" | "bad_signature" | "no_secret" };

const DEFAULT_TOLERANCE_SECONDS = 300;

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  // Node lowercases incoming header names, but be tolerant of other casings.
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

/**
 * Standard Webhooks verification, per Linq's documented scheme:
 * signed content is `{webhook-id}.{webhook-timestamp}.{body}`, HMAC-SHA256 with
 * the base64-decoded secret (minus the `whsec_` prefix), compared in constant time.
 */
export function verifyLinqWebhook(input: VerifyInput): VerifyResult {
  if (!input.secret) return { valid: false, reason: "no_secret" };

  const id = header(input.headers, "webhook-id");
  const timestamp = header(input.headers, "webhook-timestamp");
  const signature = header(input.headers, "webhook-signature");
  if (!id || !timestamp || !signature) return { valid: false, reason: "missing_headers" };

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { valid: false, reason: "bad_timestamp" };

  const now = input.now ?? new Date();
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const driftSeconds = Math.abs(now.getTime() / 1000 - seconds);
  if (driftSeconds > tolerance) return { valid: false, reason: "stale" };

  const secretBody = input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret;
  const key = Buffer.from(secretBody, "base64");
  const signedContent = `${id}.${timestamp}.${input.rawBody}`;
  const expected = createHmac("sha256", key).update(signedContent).digest();

  // The header may carry several space-separated versioned signatures.
  const matched = signature.split(" ").some((candidate) => {
    if (!candidate.startsWith("v1,")) return false;
    try {
      const provided = Buffer.from(candidate.slice(3), "base64");
      return provided.length === expected.length && timingSafeEqual(provided, expected);
    } catch {
      return false;
    }
  });

  if (!matched) return { valid: false, reason: "bad_signature" };
  return { valid: true, eventId: id, timestamp: new Date(seconds * 1000) };
}

/** Test helper — produces headers a real delivery would carry. */
export function signLinqWebhook(input: {
  rawBody: string;
  secret: string;
  eventId: string;
  timestamp?: Date;
}): Record<string, string> {
  const timestamp = Math.floor((input.timestamp ?? new Date()).getTime() / 1000);
  const secretBody = input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret;
  const key = Buffer.from(secretBody, "base64");
  const signature = createHmac("sha256", key)
    .update(`${input.eventId}.${timestamp}.${input.rawBody}`)
    .digest("base64");
  return {
    "webhook-id": input.eventId,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
  };
}
