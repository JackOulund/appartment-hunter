import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

export interface ActionTokenPayload {
  listingId: string;
  userId: string;
  batchId: string | null;
  /** Unix seconds. */
  exp: number;
  nonce: string;
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Signed, expiring, opaque handle for a listing page. The browser never supplies
 * a listing or user id directly — everything comes out of the verified token.
 */
export function createActionToken(
  payload: Omit<ActionTokenPayload, "exp" | "nonce">,
  options: { ttlSeconds?: number; secret?: string; now?: Date } = {},
): string {
  const now = options.now ?? new Date();
  const full: ActionTokenPayload = {
    ...payload,
    exp: Math.floor(now.getTime() / 1000) + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    nonce: randomBytes(9).toString("base64url"),
  };

  const body = base64url(JSON.stringify(full));
  const signature = createHmac("sha256", options.secret ?? env.ACTION_TOKEN_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export type VerifyTokenResult =
  | { valid: true; payload: ActionTokenPayload }
  | { valid: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyActionToken(
  token: string,
  options: { secret?: string; now?: Date } = {},
): VerifyTokenResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed" };
  const [body, signature] = parts as [string, string];

  const expected = createHmac("sha256", options.secret ?? env.ACTION_TOKEN_SECRET)
    .update(body)
    .digest("base64url");

  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: ActionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ActionTokenPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (typeof payload.listingId !== "string" || typeof payload.userId !== "string") {
    return { valid: false, reason: "malformed" };
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (payload.exp <= nowSeconds) return { valid: false, reason: "expired" };

  return { valid: true, payload };
}

/** Throwing variant for route handlers. */
export function requireActionToken(token: string, now?: Date): ActionTokenPayload {
  const result = verifyActionToken(token, now ? { now } : {});
  if (result.valid) return result.payload;
  throw new AppError(
    result.reason === "expired" ? "token_expired" : "token_invalid",
    result.reason === "expired" ? "This link has expired." : "This link is not valid.",
  );
}

/**
 * Short-lived confirmation token for an irreversible send. Stored hashed on the
 * application row; the plaintext only lives in the review page.
 */
export const CONFIRMATION_TTL_MINUTES = 15;

export function createConfirmationToken(): { token: string; expiresAt: Date } {
  return {
    token: randomBytes(24).toString("base64url"),
    expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MINUTES * 60 * 1000),
  };
}
