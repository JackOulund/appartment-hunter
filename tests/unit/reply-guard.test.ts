import { describe, expect, it } from "vitest";
import { guardReply } from "../../src/domain/reply-guard.js";

describe("number grounding", () => {
  it("accepts a rent quoted with spaces when the fact uses spaces too", () => {
    const result = guardReply("The rent is 8500 SEK.", ["8 500 SEK"]);
    expect(result).toEqual({ ok: true, text: "The rent is 8500 SEK.", reason: null });
  });

  it("matches separators regardless of which side uses them", () => {
    const spaced = guardReply("It's 9 000 per month", ["9000 SEK/month"]);
    expect(spaced.ok).toBe(true);

    const reversed = guardReply("It's 9000 per month", ["9 000 SEK/month"]);
    expect(reversed.ok).toBe(true);
  });

  it("rejects a number that appears nowhere in the facts", () => {
    const result = guardReply("The rent is 7200 SEK.", ["8500 SEK"]);
    expect(result).toEqual({ ok: false, text: null, reason: "unseen_number" });
  });

  it("lets short digit runs through unconditionally", () => {
    expect(guardReply("the 2nd one looks best", []).ok).toBe(true);
    expect(guardReply("45 minutes is a bit long", []).ok).toBe(true);
  });

  it("expands k-suffix shorthand before comparing", () => {
    const result = guardReply("9k is my max", ["max rent 9000"]);
    expect(result.ok).toBe(true);
  });

  it("grounds a date by its digit runs", () => {
    const result = guardReply("Move-in is 2026-09-01.", ["preferredMoveInDate 2026-09-01"]);
    expect(result.ok).toBe(true);
  });
});

describe("markdown stripping", () => {
  it("removes bold, links and bare urls, leaving plain text", () => {
    const result = guardReply("**Great news!** Check [this](https://x.com) out: https://y.com/z", []);
    expect(result.ok).toBe(true);
    expect(result.text).toBe("Great news! Check this out:");
  });
});

describe("length and emptiness", () => {
  it("rejects a draft longer than maxLength without truncating", () => {
    const draft = "a".repeat(900);
    const result = guardReply(draft, []);
    expect(result).toEqual({ ok: false, text: null, reason: "too_long" });
  });

  it("passes a clean short draft through with whitespace collapsed", () => {
    const result = guardReply("Hi   there,\n\nhow  are you?", []);
    expect(result).toEqual({ ok: true, text: "Hi there, how are you?", reason: null });
  });

  it("rejects an empty or whitespace-only draft", () => {
    expect(guardReply("", [])).toEqual({ ok: false, text: null, reason: "empty" });
    expect(guardReply("   \n\t  ", [])).toEqual({ ok: false, text: null, reason: "empty" });
  });
});
