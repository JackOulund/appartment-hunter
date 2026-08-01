import { describe, expect, it } from "vitest";
import { createActionToken, verifyActionToken, requireActionToken } from "../../src/security/action-tokens.js";
import { signLinqWebhook, verifyLinqWebhook } from "../../src/integrations/linq/webhook-verifier.js";
import { redactEmail, redactObject, redactPhone, previewText } from "../../src/security/redaction.js";
import { renewalSearchDate, parseHumanDate, toIsoDate } from "../../src/utils/dates.js";
import { isAppError } from "../../src/utils/errors.js";

const SECRET = "test-secret-that-is-long-enough";
const NOW = new Date("2026-08-01T12:00:00.000Z");

describe("action tokens", () => {
  const payload = { listingId: "L1", userId: "U1", batchId: "B1" };

  it("round-trips a valid token", () => {
    const token = createActionToken(payload, { secret: SECRET, now: NOW });
    const result = verifyActionToken(token, { secret: SECRET, now: NOW });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.listingId).toBe("L1");
      expect(result.payload.userId).toBe("U1");
      expect(result.payload.nonce).toHaveLength(12);
    }
  });

  it("rejects a token signed with a different secret", () => {
    const token = createActionToken(payload, { secret: SECRET, now: NOW });
    const result = verifyActionToken(token, { secret: "another-secret-entirely", now: NOW });
    expect(result).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("rejects a tampered payload", () => {
    const token = createActionToken(payload, { secret: SECRET, now: NOW });
    const [body, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...payload, userId: "SOMEONE-ELSE", exp: 9_999_999_999, nonce: "x" }),
    ).toString("base64url");
    const result = verifyActionToken(`${forged}.${signature}`, { secret: SECRET, now: NOW });
    expect(result.valid).toBe(false);
    expect(body).not.toBe(forged);
  });

  it("rejects an expired token", () => {
    const token = createActionToken(payload, { secret: SECRET, now: NOW, ttlSeconds: 60 });
    const later = new Date(NOW.getTime() + 61_000);
    expect(verifyActionToken(token, { secret: SECRET, now: later })).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("rejects a malformed token", () => {
    expect(verifyActionToken("not-a-token", { secret: SECRET }).valid).toBe(false);
    expect(verifyActionToken("a.b.c", { secret: SECRET }).valid).toBe(false);
  });

  it("throws a typed error from the strict helper", () => {
    try {
      requireActionToken("garbage");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("token_invalid");
    }
  });
});

describe("webhook signature verification", () => {
  const body = JSON.stringify({ event_id: "evt_1", event_type: "message.received" });
  const secret = `whsec_${Buffer.from("super-secret-key-material").toString("base64")}`;

  it("accepts a correctly signed delivery", () => {
    const headers = signLinqWebhook({ rawBody: body, secret, eventId: "evt_1", timestamp: NOW });
    const result = verifyLinqWebhook({ rawBody: body, headers, secret, now: NOW });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.eventId).toBe("evt_1");
  });

  it("rejects a tampered body", () => {
    const headers = signLinqWebhook({ rawBody: body, secret, eventId: "evt_1", timestamp: NOW });
    const result = verifyLinqWebhook({ rawBody: `${body} `, headers, secret, now: NOW });
    expect(result).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("rejects a signature made with the wrong secret", () => {
    const headers = signLinqWebhook({
      rawBody: body,
      secret: `whsec_${Buffer.from("different-key").toString("base64")}`,
      eventId: "evt_1",
      timestamp: NOW,
    });
    expect(verifyLinqWebhook({ rawBody: body, headers, secret, now: NOW }).valid).toBe(false);
  });

  it("rejects a stale delivery outside the replay window", () => {
    const old = new Date(NOW.getTime() - 10 * 60 * 1000);
    const headers = signLinqWebhook({ rawBody: body, secret, eventId: "evt_1", timestamp: old });
    expect(verifyLinqWebhook({ rawBody: body, headers, secret, now: NOW })).toEqual({
      valid: false,
      reason: "stale",
    });
  });

  it("rejects a delivery with missing headers", () => {
    expect(verifyLinqWebhook({ rawBody: body, headers: {}, secret, now: NOW })).toEqual({
      valid: false,
      reason: "missing_headers",
    });
  });

  it("refuses to verify when no secret is configured", () => {
    const headers = signLinqWebhook({ rawBody: body, secret, eventId: "evt_1", timestamp: NOW });
    expect(verifyLinqWebhook({ rawBody: body, headers, secret: "", now: NOW })).toEqual({
      valid: false,
      reason: "no_secret",
    });
  });
});

describe("redaction", () => {
  it("masks phone numbers and emails", () => {
    expect(redactPhone("+46701234567")).toBe("+46***67");
    expect(redactEmail("jack@example.com")).toBe("j***@example.com");
  });

  it("truncates message previews", () => {
    expect(previewText("hello world", 40)).toBe("hello world");
    expect(previewText("x".repeat(60), 40)).toContain("(+20 chars)");
  });

  it("strips secrets from nested objects", () => {
    const result = redactObject({
      apiKey: "sk-live-123",
      nested: { webhook_secret: "whsec_abc", email: "a@b.com", safe: "keep" },
    }) as Record<string, Record<string, string>>;

    expect(result["apiKey"]).toBe("[redacted]");
    expect(result["nested"]?.["webhook_secret"]).toBe("[redacted]");
    expect(result["nested"]?.["email"]).toBe("a***@b.com");
    expect(result["nested"]?.["safe"]).toBe("keep");
  });
});

describe("renewal timing", () => {
  it("subtracts the lead time from the lease end date", () => {
    const endsAt = new Date("2027-06-30T00:00:00.000Z");
    expect(toIsoDate(renewalSearchDate(endsAt, 30))).toBe("2027-05-31");
    expect(toIsoDate(renewalSearchDate(endsAt, 60))).toBe("2027-05-01");
  });

  it("parses human dates in both languages", () => {
    expect(toIsoDate(parseHumanDate("20 August", NOW)!)).toBe("2026-08-20");
    expect(toIsoDate(parseHumanDate("20 augusti", NOW)!)).toBe("2026-08-20");
    expect(toIsoDate(parseHumanDate("2026-09-15", NOW)!)).toBe("2026-09-15");
  });

  it("returns null rather than guessing an unparseable date", () => {
    expect(parseHumanDate("sometime soon", NOW)).toBeNull();
  });
});
