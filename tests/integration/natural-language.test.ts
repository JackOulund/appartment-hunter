import { describe, expect, it } from "vitest";
import { completeOnboarding, createHarness, TEST_CHAT_ID, TEST_HANDLE } from "../helpers/harness.js";
import { ConversationService } from "../../src/application/conversation-service.js";

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
