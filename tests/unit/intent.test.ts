import { describe, expect, it } from "vitest";
import { proposedCommandSchema, turnDecisionSchema } from "../../src/integrations/llm/turn-schema.js";
import { ACTION_COMMAND_KINDS, replyFor, toCommand } from "../../src/domain/intent.js";
import type { TurnDecision } from "../../src/integrations/llm/turn-schema.js";

function decision(overrides: Partial<TurnDecision["command"]> & { confidence?: number; reply?: string | null }): TurnDecision {
  return turnDecisionSchema.parse({
    command: {
      kind: overrides.kind ?? "unknown",
      positions: overrides.positions ?? [],
      field: overrides.field ?? null,
      value: overrides.value ?? null,
    },
    preferences: {},
    reply: overrides.reply ?? null,
    confidence: overrides.confidence ?? 0.9,
  });
}

describe("proposedCommandSchema", () => {
  it("does not admit confirm_send or delete_data as valid kinds", () => {
    expect(() => proposedCommandSchema.parse({ kind: "confirm_send" })).toThrow();
    expect(() => proposedCommandSchema.parse({ kind: "delete_data" })).toThrow();
  });
});

describe("toCommand", () => {
  it("maps a valid reject with a single position", () => {
    const d = decision({ kind: "reject", positions: [2] });
    expect(toCommand(d)).toEqual({ kind: "reject", position: 2 });
  });

  it("returns null for like with zero positions", () => {
    const d = decision({ kind: "like", positions: [] });
    expect(toCommand(d)).toBeNull();
  });

  it("returns null for like with two positions", () => {
    const d = decision({ kind: "like", positions: [1, 2] });
    expect(toCommand(d)).toBeNull();
  });

  it("dedupes and sorts contact positions", () => {
    const d = decision({ kind: "contact", positions: [3, 1, 1] });
    expect(toCommand(d)).toEqual({ kind: "contact", positions: [1, 3] });
  });

  it("returns null for contact with no positions", () => {
    const d = decision({ kind: "contact", positions: [] });
    expect(toCommand(d)).toBeNull();
  });

  it("returns null for change_preference with a string value for a numeric field", () => {
    const d = decision({ kind: "change_preference", field: "maximumMonthlyRent", value: "a lot" });
    expect(toCommand(d)).toBeNull();
  });

  it("accepts a valid rent change", () => {
    const d = decision({ kind: "change_preference", field: "maximumMonthlyRent", value: 9000 });
    expect(toCommand(d)).toEqual({ kind: "change_preference", field: "maximumMonthlyRent", value: 9000 });
  });

  it("rejects an out-of-range commute", () => {
    const d = decision({ kind: "change_preference", field: "maxCommuteMinutes", value: 200 });
    expect(toCommand(d)).toBeNull();
  });

  it("accepts a valid furnished preference", () => {
    const d = decision({ kind: "change_preference", field: "furnishedPreference", value: "furnished" });
    expect(toCommand(d)).toEqual({ kind: "change_preference", field: "furnishedPreference", value: "furnished" });
  });

  it("rejects a non-ISO move-in date", () => {
    const d = decision({ kind: "change_preference", field: "preferredMoveInDate", value: "next week" });
    expect(toCommand(d)).toBeNull();
  });

  it("accepts an ISO move-in date", () => {
    const d = decision({ kind: "change_preference", field: "preferredMoveInDate", value: "2026-09-01" });
    expect(toCommand(d)).toEqual({ kind: "change_preference", field: "preferredMoveInDate", value: "2026-09-01" });
  });

  it("returns null below the minimum confidence", () => {
    const d = decision({ kind: "search", confidence: 0.4 });
    expect(toCommand(d)).toBeNull();
  });

  it("returns null for chat", () => {
    const d = decision({ kind: "chat" });
    expect(toCommand(d)).toBeNull();
  });

  it("returns null for unknown", () => {
    const d = decision({ kind: "unknown" });
    expect(toCommand(d)).toBeNull();
  });

  it("maps bare-kind commands directly", () => {
    for (const kind of [
      "more", "stop", "search", "cancel", "start_over",
      "pause", "resume", "got_apartment", "help", "contact_all_liked",
    ] as const) {
      const d = decision({ kind });
      expect(toCommand(d)).toEqual({ kind });
    }
  });

  it("never produces confirm_send or delete_data for any enum kind, even at high confidence", () => {
    const kinds = [
      "like", "reject", "more", "stop", "contact", "contact_all_liked",
      "search", "cancel", "change_preference", "start_over",
      "pause", "resume", "got_apartment", "help", "chat", "unknown",
    ] as const;
    for (const kind of kinds) {
      const d = decision({
        kind,
        positions: [1],
        field: "maximumMonthlyRent",
        value: 9000,
        confidence: 0.99,
      });
      const command = toCommand(d);
      expect(command?.kind).not.toBe("confirm_send");
      expect(command?.kind).not.toBe("delete_data");
    }
  });
});

describe("replyFor", () => {
  it("drops the LLM reply when an action command was produced", () => {
    const d = decision({ kind: "search", reply: "Sure, searching now!" });
    const command = toCommand(d);
    expect(command).not.toBeNull();
    expect(replyFor(d, command)).toBeNull();
  });

  it("keeps the reply for chat, where command is null", () => {
    const d = decision({ kind: "chat", reply: "Just chatting." });
    const command = toCommand(d);
    expect(command).toBeNull();
    expect(replyFor(d, command)).toBe("Just chatting.");
  });

  it.each(ACTION_COMMAND_KINDS)("drops the reply for action kind %s", (kind) => {
    const d = decision({
      kind,
      positions: [1],
      field: "maximumMonthlyRent",
      value: 9000,
      reply: "some draft",
    });
    const command = toCommand(d);
    expect(replyFor(d, command)).toBeNull();
  });
});
