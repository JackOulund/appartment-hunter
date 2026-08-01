import { describe, expect, it } from "vitest";
import { completeOnboarding, createHarness, TEST_CHAT_ID } from "../helpers/harness.js";

describe("onboarding", () => {
  it("congratulates and asks which campus for a multi-campus university", async () => {
    const h = await createHarness();
    await h.say("I got accepted to Lund University");

    expect(h.linq.texts()[0]).toContain("Congratulations");
    expect(h.linq.lastText()).toContain("several campuses");
    // The university is settled, so the conversation is already collecting
    // preferences — the campus is simply the first one being asked about.
    expect(await h.state()).toBe("COLLECTING_PREFERENCES");
  });

  it("does not silently pick a campus", async () => {
    const h = await createHarness();
    await h.say("I got accepted to KTH");
    expect(h.linq.lastText()).toContain("campuses");

    const user = await h.container.repos.users.findByHandle("+46700000001");
    expect(user?.selectedCampusId).toBeNull();
  });

  it("skips the campus question for a single-campus university", async () => {
    const h = await createHarness();
    await h.say("I got accepted to Uppsala University");
    expect(h.linq.lastText()).not.toContain("campuses");
    expect(h.linq.lastText()).toContain("highest monthly rent");
  });

  it("asks one question at a time and ends with a confirmation summary", async () => {
    const h = await createHarness();
    await completeOnboarding(h);

    const summary = h.linq.lastText();
    expect(summary).toContain("I'll search for");
    expect(summary).toContain("Lund");
    expect(summary).toContain("8,000 SEK");
    expect(summary).toContain("Reply SEARCH");
    expect(await h.state()).toBe("CONFIRMING_PREFERENCES");
  });

  it("never asks for sensitive identifiers during onboarding", async () => {
    const h = await createHarness();
    await completeOnboarding(h);

    const everything = h.linq.texts().join(" ").toLowerCase();
    for (const forbidden of ["personal identity", "personnummer", "passport", "bank", "card number", "password"]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  it("lets the user correct a single field in natural language", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("change my budget to 9000");

    expect(h.linq.lastText()).toContain("9,000 SEK");
    const profile = await h.container.repos.searchProfiles.findLatest(
      (await h.container.repos.users.findByHandle("+46700000001"))!.id,
    );
    expect(profile?.maximumMonthlyRent).toBe(9000);
  });
});

describe("search and presentation", () => {
  it("presents exactly three apartments as separate messages", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    h.linq.reset();
    await h.say("SEARCH");

    const summaries = h.linq.listingSummaries();
    expect(summaries).toHaveLength(3);

    // Each apartment gets its own summary, media and rich link message.
    expect(h.linq.sent.filter((m) => m.kind === "media")).toHaveLength(3);
    expect(h.linq.sent.filter((m) => m.kind === "rich_link")).toHaveLength(3);
  });

  it("sends each rich link as its own message, never combined", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");

    for (const message of h.linq.sent.filter((m) => m.kind === "rich_link")) {
      expect(message.body.startsWith("http")).toBe(true);
      expect(message.body).not.toContain("\n");
    }
  });

  it("sends the intro before the apartments and the control message after", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    h.linq.reset();
    await h.say("SEARCH");

    const kinds = h.linq.sent.map((m) => m.body);
    expect(kinds[0]).toContain("three strong matches");
    expect(kinds.at(-1)).toContain("three more");
  });

  it("persists a message id for every presented apartment", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");

    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const presentations = await h.container.repos.batches.listPresentations(conversation!.activeBatchId!);

    expect(presentations).toHaveLength(3);
    for (const presentation of presentations) {
      expect(presentation.summaryMessageId).toBeTruthy();
      expect(presentation.linkMessageId).toBeTruthy();
    }
  });

  it("never repeats an apartment in the next batch", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");

    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const first = (await h.container.repos.batches.listPresentations(conversation!.activeBatchId!)).map(
      (p) => p.listingId,
    );

    await h.say("MORE");
    const updated = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const second = (await h.container.repos.batches.listPresentations(updated!.activeBatchId!)).map(
      (p) => p.listingId,
    );

    expect(second.length).toBeGreaterThan(0);
    expect(second.some((id) => first.includes(id))).toBe(false);
  });

  it("only offers listings inside the stated budget", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");

    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const presentations = await h.container.repos.batches.listPresentations(conversation!.activeBatchId!);
    for (const presentation of presentations) {
      const listing = await h.container.repos.listings.findById(presentation.listingId);
      expect(listing!.monthlyRent).toBeLessThanOrEqual(8000);
    }
  });

  it("tells the user when nothing is left rather than sending an empty batch", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    // Exhaust the catalogue.
    for (let i = 0; i < 8; i += 1) await h.say("MORE");

    expect(h.linq.lastText()).toMatch(/could not find any more|change your budget/i);
  });
});

describe("reactions", () => {
  const setup = async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");
    const summaries = h.linq.listingSummaries();
    const control = h.linq.controlMessages().at(-1)!;
    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const presentations = await h.container.repos.batches.listPresentations(conversation!.activeBatchId!);
    const user = (await h.container.repos.users.findByHandle("+46700000001"))!;
    return { h, summaries, control, presentations, user };
  };

  it("routes a thumbs-up to the apartment it was placed on", async () => {
    const { h, summaries, presentations, user } = await setup();
    await h.react(summaries[1]!.messageId, "like");

    const decision = await h.container.repos.decisions.find(user.id, presentations[1]!.listingId);
    expect(decision?.decision).toBe("shortlisted");

    // The other two are untouched.
    const other = await h.container.repos.decisions.find(user.id, presentations[0]!.listingId);
    expect(other?.decision).toBe("unseen");
  });

  it("routes a thumbs-down to a rejection", async () => {
    const { h, summaries, presentations, user } = await setup();
    await h.react(summaries[0]!.messageId, "dislike");

    const decision = await h.container.repos.decisions.find(user.id, presentations[0]!.listingId);
    expect(decision?.decision).toBe("rejected");
  });

  it("does not confuse a control reaction with an apartment reaction", async () => {
    const { h, control, presentations, user } = await setup();
    await h.react(control.messageId, "like");

    // No listing decision changed…
    for (const presentation of presentations) {
      const decision = await h.container.repos.decisions.find(user.id, presentation.listingId);
      expect(decision?.decision).toBe("unseen");
    }
    // …and a new batch was sent instead.
    expect(h.linq.listingSummaries().length).toBeGreaterThan(3);
  });

  it("pauses the search on a thumbs-down to the control message", async () => {
    const { h, control } = await setup();
    await h.react(control.messageId, "dislike");
    expect(h.linq.lastText()).toMatch(/Search paused|saved apartments/i);
  });

  it("undoes a like when the reaction is removed", async () => {
    const { h, summaries, presentations, user } = await setup();
    await h.react(summaries[0]!.messageId, "like");
    await h.react(summaries[0]!.messageId, "like", "removed");

    const decision = await h.container.repos.decisions.find(user.id, presentations[0]!.listingId);
    expect(decision?.decision).toBe("unseen");
  });

  it("ignores a reaction on an unknown message", async () => {
    const { h } = await setup();
    const before = h.linq.sent.length;
    await h.react("no-such-message", "like");
    expect(h.linq.sent.length).toBe(before);
  });

  it("ignores a neutral reaction", async () => {
    const { h, summaries, presentations, user } = await setup();
    await h.react(summaries[0]!.messageId, "question");
    const decision = await h.container.repos.decisions.find(user.id, presentations[0]!.listingId);
    expect(decision?.decision).toBe("unseen");
  });

  it("supports text fallbacks for users who do not use tapbacks", async () => {
    const { h, presentations, user } = await setup();
    await h.say("like 1");
    await h.say("reject 2");

    expect((await h.container.repos.decisions.find(user.id, presentations[0]!.listingId))?.decision).toBe(
      "shortlisted",
    );
    expect((await h.container.repos.decisions.find(user.id, presentations[1]!.listingId))?.decision).toBe(
      "rejected",
    );
  });
});
