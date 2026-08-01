import { describe, expect, it } from "vitest";
import { MockLlmProvider } from "../../src/integrations/llm/mock-llm-provider.js";
import { AnthropicLlmProvider, buildTurnSystemPrompt } from "../../src/integrations/llm/anthropic-llm-provider.js";
import { turnDecisionSchema } from "../../src/integrations/llm/turn-schema.js";
import type { TurnContext } from "../../src/integrations/llm/llm-provider.js";

function context(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    text: "",
    state: "REVIEWING_RESULTS",
    language: "en",
    missingFields: [],
    knownPreferences: {},
    roster: [
      { position: 1, title: "Cozy studio near campus", monthlyRent: 7500, currency: "SEK" },
      { position: 2, title: "Shared flat with balcony", monthlyRent: 8200, currency: "SEK" },
      { position: 3, title: "Bright one-bedroom", monthlyRent: 9100, currency: "SEK" },
    ],
    recentTurns: [],
    ...overrides,
  };
}

const provider = new MockLlmProvider();

describe("MockLlmProvider.decideTurn — more", () => {
  it.each([
    "yeah go on then, show me a few more",
    "more please",
    "SHOW ME more options",
    "ok go on",
  ])("recognises %s as a request for more listings", async (text) => {
    const decision = await provider.decideTurn(context({ text }));
    expect(turnDecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision.command.kind).toBe("more");
    expect(decision.confidence).toBe(0.9);
    expect(decision.reply).toBeNull();
  });
});

describe("MockLlmProvider.decideTurn — reject", () => {
  it("resolves 'the second one's not for me' to position 2", async () => {
    const decision = await provider.decideTurn(context({ text: "the second one's not for me" }));
    expect(turnDecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision.command.kind).toBe("reject");
    expect(decision.command.positions).toEqual([2]);
    expect(decision.confidence).toBe(0.85);
    expect(decision.reply).toBeNull();
  });

  it("resolves ordinal-first negative sentiment", async () => {
    const decision = await provider.decideTurn(context({ text: "the first one, nah" }));
    expect(decision.command.kind).toBe("reject");
    expect(decision.command.positions).toEqual([1]);
  });

  it("resolves negative-first phrasing", async () => {
    const decision = await provider.decideTurn(context({ text: "not for me, the third one" }));
    expect(decision.command.kind).toBe("reject");
    expect(decision.command.positions).toEqual([3]);
  });

  it("resolves Swedish negative sentiment", async () => {
    const decision = await provider.decideTurn(context({ text: "two, inte" }));
    expect(decision.command.kind).toBe("reject");
    expect(decision.command.positions).toEqual([2]);
  });
});

describe("MockLlmProvider.decideTurn — like", () => {
  it("resolves positive sentiment with an ordinal", async () => {
    const decision = await provider.decideTurn(context({ text: "I love the first one" }));
    expect(turnDecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision.command.kind).toBe("like");
    expect(decision.command.positions).toEqual([1]);
    expect(decision.confidence).toBe(0.8);
    expect(decision.reply).toBeNull();
  });

  it("resolves 'keep' as positive sentiment", async () => {
    const decision = await provider.decideTurn(context({ text: "keep the third one" }));
    expect(decision.command.kind).toBe("like");
    expect(decision.command.positions).toEqual([3]);
  });

  it("resolves 'great' as positive sentiment", async () => {
    const decision = await provider.decideTurn(context({ text: "second one is great" }));
    expect(decision.command.kind).toBe("like");
    expect(decision.command.positions).toEqual([2]);
  });
});

describe("MockLlmProvider.decideTurn — change_preference", () => {
  it("parses 'actually let's say 9000 max' as a budget change", async () => {
    const decision = await provider.decideTurn(context({ text: "actually let's say 9000 max" }));
    expect(turnDecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision.command.kind).toBe("change_preference");
    expect(decision.command.field).toBe("maximumMonthlyRent");
    expect(decision.command.value).toBe(9000);
    expect(decision.confidence).toBe(0.85);
    expect(decision.reply).toBeNull();
  });

  it("parses grouped digits", async () => {
    const decision = await provider.decideTurn(context({ text: "9 000 tops" }));
    expect(decision.command.field).toBe("maximumMonthlyRent");
    expect(decision.command.value).toBe(9000);
  });

  it("parses k-shorthand", async () => {
    const decision = await provider.decideTurn(context({ text: "9k budget" }));
    expect(decision.command.field).toBe("maximumMonthlyRent");
    expect(decision.command.value).toBe(9000);
  });

  it("parses a bare 'let's say <amount>'", async () => {
    const decision = await provider.decideTurn(context({ text: "let's say 8500" }));
    expect(decision.command.field).toBe("maximumMonthlyRent");
    expect(decision.command.value).toBe(8500);
  });
});

describe("MockLlmProvider.decideTurn — contact", () => {
  it("extracts positions from 'contact 1 and 3'", async () => {
    const decision = await provider.decideTurn(context({ text: "contact 1 and 3" }));
    expect(turnDecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision.command.kind).toBe("contact");
    expect(decision.command.positions).toEqual([1, 3]);
    expect(decision.reply).toBeNull();
  });

  it("dedupes and sorts contact positions", async () => {
    const decision = await provider.decideTurn(context({ text: "please contact 3, 1 and 1" }));
    expect(decision.command.kind).toBe("contact");
    expect(decision.command.positions).toEqual([1, 3]);
  });
});

describe("MockLlmProvider.decideTurn — chat fallback", () => {
  it("falls back to chat with a non-null reply", async () => {
    const decision = await provider.decideTurn(context({ text: "okay sounds good" }));
    expect(turnDecisionSchema.safeParse(decision).success).toBe(true);
    expect(decision.command.kind).toBe("chat");
    expect(decision.confidence).toBe(0.5);
    expect(decision.reply).not.toBeNull();
  });

  it("reuses preference extraction for chat replies", async () => {
    const decision = await provider.decideTurn(context({ text: "actually I'd prefer somewhere with wifi" }));
    expect(decision.command.kind).toBe("chat");
    expect(decision.preferences.preferredAmenities).toContain("wifi");
  });
});

describe("MockLlmProvider.decideTurn — action branches never carry a reply", () => {
  it.each([
    "show me more",
    "the second one's not for me",
    "I love the first one",
    "let's say 8500",
    "contact 1",
  ])("kind for %s has a null reply", async (text) => {
    const decision = await provider.decideTurn(context({ text }));
    expect(decision.command.kind).not.toBe("chat");
    expect(decision.command.kind).not.toBe("unknown");
    expect(decision.reply).toBeNull();
  });
});

describe("AnthropicLlmProvider.decideTurn", () => {
  it("is implemented on the interface (no network call made)", () => {
    const provider = new AnthropicLlmProvider({ apiKey: "test-key" });
    expect(typeof provider.decideTurn).toBe("function");
  });
});

describe("buildTurnSystemPrompt", () => {
  it("anchors the prompt to today's date so relative dates can be resolved", () => {
    const today = new Date().toISOString().slice(0, 10);
    const prompt = buildTurnSystemPrompt(context({ text: "1 September" }));
    expect(prompt).toContain(`Today is ${today}.`);
  });

  it("states the same preference-extraction rules as extractPreferences", () => {
    const prompt = buildTurnSystemPrompt(context({ text: "1 September" }));
    expect(prompt).toContain("ISO (YYYY-MM-DD)");
    expect(prompt).toContain("whole number");
    expect(prompt).toContain("whole months");
    expect(prompt).toContain("whole minutes");
  });
});
