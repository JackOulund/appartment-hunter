import { describe, expect, it } from "vitest";
import { completeOnboarding, createHarness, TEST_CHAT_ID, TEST_HANDLE } from "../helpers/harness.js";
import { ConversationService } from "../../src/application/conversation-service.js";
import { MockLlmProvider } from "../../src/integrations/llm/mock-llm-provider.js";
import { turnDecisionSchema, type TurnDecision } from "../../src/integrations/llm/turn-schema.js";
import type { LlmProvider, TurnContext } from "../../src/integrations/llm/llm-provider.js";
import type { Language } from "../../src/domain/entities.js";

/**
 * Delegates everything to MockLlmProvider except decideTurn, which always
 * returns a confident "chat" decision with no extracted preferences — the
 * exact shape a real model returned in the Fly logs that caused acceptedUniversityId
 * to never persist. Counts invocations so tests can assert the LLM path was
 * (or was not) actually reached.
 */
class ForcedChatLlmProvider implements LlmProvider {
  readonly name = "forced-chat-stub";
  decideTurnCalls = 0;
  extractPreferencesCalls = 0;
  private readonly mock = new MockLlmProvider();

  constructor(private readonly reply: string = "Congrats on Lund!") {}

  detectLanguage(text: string) {
    return this.mock.detectLanguage(text);
  }
  extractPreferences(text: string, context: { language: Language }) {
    this.extractPreferencesCalls += 1;
    return this.mock.extractPreferences(text, context);
  }
  guessUniversity(text: string) {
    return this.mock.guessUniversity(text);
  }
  writeReply(input: { intent: string; facts: string[]; language: Language }) {
    return this.mock.writeReply(input);
  }
  draftLandlordMessage(input: Parameters<LlmProvider["draftLandlordMessage"]>[0]) {
    return this.mock.draftLandlordMessage(input);
  }
  async decideTurn(_context: TurnContext): Promise<TurnDecision> {
    this.decideTurnCalls += 1;
    return turnDecisionSchema.parse({
      command: { kind: "chat" },
      preferences: {},
      reply: this.reply,
      confidence: 0.9,
    });
  }
}

describe("LLM chat leak does not swallow the university flow", () => {
  it("state NEW: runs resolveUniversity despite a confident forced-chat decision", async () => {
    const stub = new ForcedChatLlmProvider();
    const h = await createHarness({ llm: stub });

    await h.say("Hi I got accepted to Lund university");

    const user = await h.container.repos.users.findByHandle(TEST_HANDLE);
    expect(user?.acceptedUniversityId).toBeTruthy();
    // The deterministic university flow ran instead of the model's chat reply.
    expect(await h.state()).not.toBe("NEW");
    expect(h.linq.texts().join(" ")).not.toContain("Congrats on Lund!");
  });

  it("state COLLECTING_UNIVERSITY: persists the university despite a confident forced-chat decision", async () => {
    const stub = new ForcedChatLlmProvider();
    const h = await createHarness({ llm: stub });

    // First message doesn't name a university, so onboarding parks in
    // COLLECTING_UNIVERSITY without setting acceptedUniversityId.
    await h.say("hello there");
    expect(await h.state()).toBe("COLLECTING_UNIVERSITY");
    let user = await h.container.repos.users.findByHandle(TEST_HANDLE);
    expect(user?.acceptedUniversityId).toBeNull();

    await h.say("Lund university");

    user = await h.container.repos.users.findByHandle(TEST_HANDLE);
    expect(user?.acceptedUniversityId).toBeTruthy();
    expect(h.linq.texts().join(" ")).not.toContain("Congrats on Lund!");
  });
});

describe("LLM path is fully off once a conversation has opted out", () => {
  it("never calls decideTurn and never sends a chat reply in OPTED_OUT", async () => {
    const stub = new ForcedChatLlmProvider();
    const h = await createHarness({ llm: stub });

    await completeOnboarding(h);
    await h.say("SEARCH");
    await h.say("delete my data");
    await h.say("yes");
    expect(await h.state()).toBe("OPTED_OUT");

    const callsBeforeFinalMessage = stub.decideTurnCalls;
    h.linq.reset();

    await h.say("hello again, are you there?");

    expect(stub.decideTurnCalls).toBe(callsBeforeFinalMessage);
    expect(h.linq.texts().join(" ")).not.toContain("Congrats on Lund!");
  });
});

describe("empty combined extraction falls back to a dedicated extractPreferences call", () => {
  it("calls extractPreferences directly when decideTurn's own extraction is empty", async () => {
    const stub = new ForcedChatLlmProvider("Sounds good, let's keep going.");
    const h = await createHarness({ llm: stub });

    await h.say("I got accepted to Lund university");
    await h.say("1"); // campus choice; must not itself trigger extraction
    expect(await h.state()).toBe("COLLECTING_PREFERENCES");

    const callsBeforeBudget = stub.extractPreferencesCalls;
    // Deliberately outside parseCommand's deterministic budget pattern (no
    // "budget"/"rent"/"hyra" keyword), so this only succeeds through the
    // fallback dedicated extractPreferences call.
    await h.say("8000");

    expect(stub.extractPreferencesCalls).toBeGreaterThan(callsBeforeBudget);

    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const payload = h.container.repos.conversations.getPayload<{
      preferences?: { maximumMonthlyRent?: number };
    }>(conversation!);
    expect(payload.preferences?.maximumMonthlyRent).toBe(8000);
  });
});

describe("natural language turns", () => {
  it("presents a new batch when the user asks for more in their own words", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");

    const first = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const firstBatchId = first!.activeBatchId;

    await h.say("yeah go on then, show me a few more");

    const second = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    expect(second!.activeBatchId).toBeTruthy();
    expect(second!.activeBatchId).not.toBe(firstBatchId);

    const presentations = await h.container.repos.batches.listPresentations(second!.activeBatchId!);
    expect(presentations.length).toBeGreaterThan(0);
  });

  it("rejects the position implied by a natural-language dismissal", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");

    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const presentations = await h.container.repos.batches.listPresentations(conversation!.activeBatchId!);
    const user = (await h.container.repos.users.findByHandle(TEST_HANDLE))!;

    await h.say("the second one's not for me");

    const decision = await h.container.repos.decisions.find(user.id, presentations[1]!.listingId);
    expect(decision?.decision).toBe("rejected");
  });

  it("updates the stored search profile budget from a natural-language change", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    expect(await h.state()).toBe("CONFIRMING_PREFERENCES");

    // "9k" is deliberately outside the bare-digit extractor's pattern (it only
    // matches runs of digits/separators), so this only succeeds through the new
    // decideTurn -> change_preference path, not the pre-existing extractPreferences
    // fallback that already handles plain "9000".
    await h.say("actually let's say 9k max");

    const user = (await h.container.repos.users.findByHandle(TEST_HANDLE))!;
    const profile = await h.container.repos.searchProfiles.findLatest(user.id);
    expect(profile?.maximumMonthlyRent).toBe(9000);
  });

  it("does not send an application on a vague affirmation while awaiting explicit confirmation", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");
    await h.say("like 1");
    await h.say("contact 1");
    await h.say("Jack Joulund");
    await h.say("jack@example.com");
    await h.say("+46701234567");

    expect(await h.state()).toBe("AWAITING_CONTACT_CONFIRMATION");
    const user = (await h.container.repos.users.findByHandle(TEST_HANDLE))!;
    const application = (await h.container.repos.applications.listByUser(user.id))[0]!;

    await h.say("okay sounds good");

    const refreshed = await h.container.repos.applications.findById(application.id);
    expect(refreshed?.status).toBe("draft");
    expect(refreshed?.sentAt).toBeNull();
    expect(h.housing.getContactLog()).toHaveLength(0);
    expect(await h.state()).toBe("AWAITING_CONTACT_CONFIRMATION");
  });

  it("never routes a natural-language delete request to actual deletion", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");

    await h.say("please delete all my data now thanks");

    const user = await h.container.repos.users.findByHandle(TEST_HANDLE);
    expect(user).not.toBeNull();
    expect(user?.deletedAt).toBeNull();

    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const payload = h.container.repos.conversations.getPayload<{ awaitingDeleteConfirmation?: boolean }>(
      conversation!,
    );
    expect(payload.awaitingDeleteConfirmation).not.toBe(true);
  });

  it("does nothing natural-language-y when the kill switch is off", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");

    const before = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const summariesBefore = h.linq.listingSummaries().length;

    const deterministicOnly = new ConversationService(
      {
        repos: h.container.repos,
        linq: h.container.linq,
        llm: h.container.llm,
        universities: h.container.universities,
        search: h.container.search,
        presentation: h.container.presentation,
        applications: h.container.applications,
        reactions: h.container.reactions,
      },
      { llmIntent: false },
    );

    await deterministicOnly.handleInboundMessage({
      chatId: TEST_CHAT_ID,
      senderHandle: TEST_HANDLE,
      messageId: "kill-switch-1",
      text: "yeah go on then, show me a few more",
    });

    const after = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    expect(after!.activeBatchId).toBe(before!.activeBatchId);
    expect(h.linq.listingSummaries().length).toBe(summariesBefore);
  });

  it("keeps the recent-turns window capped at six entries", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");
    await h.say("like 1");
    await h.say("reject 2");
    await h.say("MORE");

    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const payload = h.container.repos.conversations.getPayload<{
      recentTurns?: { role: "user" | "agent"; text: string }[];
    }>(conversation!);
    expect(payload.recentTurns).toBeDefined();
    expect(payload.recentTurns!.length).toBeLessThanOrEqual(6);
  });

  it("wipes the recent-turns window when the user deletes their data", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");
    await h.say("delete my data");
    await h.say("yes");

    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const payload = h.container.repos.conversations.getPayload<{
      recentTurns?: { role: "user" | "agent"; text: string }[];
    }>(conversation!);
    expect(payload.recentTurns).toBeUndefined();
  });
});
