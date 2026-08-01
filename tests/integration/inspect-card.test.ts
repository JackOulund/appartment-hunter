import { describe, expect, it } from "vitest";
import { completeOnboarding, createHarness, type Harness } from "../helpers/harness.js";
import { createActionToken } from "../../src/security/action-tokens.js";

/** Walks to a presented batch and returns the cards that were sent. */
async function presentBatch(h: Harness) {
  await completeOnboarding(h);
  await h.say("SEARCH");
  return h.linq.cards();
}

function tokenFrom(url: string): string {
  const match = url.match(/\/l\/([^/?#]+)/);
  if (!match?.[1]) throw new Error(`no token in ${url}`);
  return match[1];
}

describe("inspect view delivered as a Linq app card", () => {
  it("sends one app card per apartment instead of a bare rich link", async () => {
    const h = await createHarness();
    const cards = await presentBatch(h);

    expect(cards).toHaveLength(3);
    expect(h.linq.sent.filter((m) => m.kind === "rich_link")).toHaveLength(0);
  });

  it("puts the deterministic facts on the card, not a generic label", async () => {
    const h = await createHarness();
    const [card] = await presentBatch(h);

    expect(card?.card?.title).toBeTruthy();
    // The subtitle carries the rent, which comes from the listing — never the LLM.
    expect(card?.card?.subtitle).toMatch(/SEK/);
    expect(card?.card?.button).toBe("View");
    expect(card?.card?.url).toMatch(/\/l\/[^/]+$/);
  });

  it("targets the recipient handle, because actions are handle-targeted", async () => {
    const h = await createHarness();
    const [card] = await presentBatch(h);

    expect(card?.toHandle).toBe("+46700000001");
  });

  it("still routes a reaction on the card back to its apartment", async () => {
    const h = await createHarness();
    const cards = await presentBatch(h);
    const first = cards[0];
    if (!first) throw new Error("no card");

    await h.react(first.messageId, "like");

    const user = await h.container.repos.users.findByHandle("+46700000001");
    const presentations = await h.container.repos.batches.listPresentations(
      (await h.container.repos.conversations.findByUserId(user!.id))!.activeBatchId!,
    );
    const decision = await h.container.repos.decisions.find(user!.id, presentations[0]!.listingId);
    expect(decision?.decision).toBe("shortlisted");
  });
});

describe("the page reports back into the conversation", () => {
  it("records what happened in the UI", async () => {
    const h = await createHarness();
    const cards = await presentBatch(h);
    const token = tokenFrom(cards[0]!.card!.url);

    await h.container.experience.recordEvent({ token, event: "opened" });
    await h.container.experience.recordEvent({ token, event: "gallery_viewed" });

    const user = await h.container.repos.users.findByHandle("+46700000001");
    const events = await h.container.repos.viewEvents.listForUser(user!.id);
    expect(events.map((e) => e.event)).toEqual(["opened", "gallery_viewed"]);
  });

  it("follows up in iMessage when the apartment was inspected but not decided", async () => {
    const h = await createHarness();
    const cards = await presentBatch(h);
    const token = tokenFrom(cards[0]!.card!.url);
    const before = h.linq.texts().length;

    await h.container.experience.recordEvent({ token, event: "opened" });
    await h.container.experience.recordEvent({ token, event: "closed" });

    const added = h.linq.texts().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("CONTACT 1");
  });

  it("follows up only once, however many times the page is closed", async () => {
    const h = await createHarness();
    const cards = await presentBatch(h);
    const token = tokenFrom(cards[0]!.card!.url);
    const before = h.linq.texts().length;

    await h.container.experience.recordEvent({ token, event: "opened" });
    await h.container.experience.recordEvent({ token, event: "closed" });
    await h.container.experience.recordEvent({ token, event: "closed" });
    await h.container.experience.recordEvent({ token, event: "closed" });

    expect(h.linq.texts().slice(before)).toHaveLength(1);
  });

  it("stays quiet when the apartment was already rejected", async () => {
    const h = await createHarness();
    const cards = await presentBatch(h);
    const token = tokenFrom(cards[0]!.card!.url);
    await h.say("no 1");
    const before = h.linq.texts().length;

    await h.container.experience.recordEvent({ token, event: "opened" });
    await h.container.experience.recordEvent({ token, event: "closed" });

    expect(h.linq.texts().slice(before)).toHaveLength(0);
  });

  it("stays quiet when the user tapped Contact, because that flow speaks for itself", async () => {
    const h = await createHarness();
    const cards = await presentBatch(h);
    const token = tokenFrom(cards[0]!.card!.url);
    const before = h.linq.texts().length;

    await h.container.experience.recordEvent({ token, event: "opened" });
    await h.container.experience.recordEvent({ token, event: "contact_clicked" });
    await h.container.experience.recordEvent({ token, event: "closed" });

    expect(h.linq.texts().slice(before)).toHaveLength(0);
  });
});

describe("event endpoint is not an open door", () => {
  it("rejects a forged token", async () => {
    const h = await createHarness();
    await presentBatch(h);
    const forged = createActionToken(
      { listingId: "lst_x", userId: "usr_x", batchId: null },
      { secret: "an-attacker-supplied-secret" },
    );

    await expect(
      h.container.experience.recordEvent({ token: forged, event: "opened" }),
    ).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("rejects an event name it does not know", async () => {
    const h = await createHarness();
    const cards = await presentBatch(h);
    const token = tokenFrom(cards[0]!.card!.url);

    await expect(
      h.container.experience.recordEvent({ token, event: "rent_paid" }),
    ).rejects.toMatchObject({ code: "invalid_event" });
  });

  it("records nothing for an expired token", async () => {
    const h = await createHarness();
    await presentBatch(h);
    const user = await h.container.repos.users.findByHandle("+46700000001");
    const expired = createActionToken(
      { listingId: "lst_x", userId: user!.id, batchId: null },
      { ttlSeconds: -10 },
    );

    await expect(
      h.container.experience.recordEvent({ token: expired, event: "opened" }),
    ).rejects.toMatchObject({ code: "token_expired" });
    expect(await h.container.repos.viewEvents.listForUser(user!.id)).toHaveLength(0);
  });
});

describe("delivery mode can be forced to plain links", () => {
  it("sends rich links instead of app cards when configured to", async () => {
    const { PresentationService } = await import("../../src/application/presentation-service.js");
    const h = await createHarness();
    await presentBatch(h);

    const conversation = await h.container.repos.conversations.findByChatId("test-chat");
    const user = (await h.container.repos.users.findByHandle("+46700000001"))!;
    const presentations = await h.container.repos.batches.listPresentations(
      conversation!.activeBatchId!,
    );
    const listings = await h.container.repos.listings.findManyById(
      presentations.map((p) => p.listingId),
    );
    // Reuse the real search run — a made-up id trips the foreign key.
    const batch = await h.container.repos.batches.findById(conversation!.activeBatchId!);
    h.linq.reset();

    const linkOnly = new PresentationService(h.container.repos, h.linq, { delivery: "link" });
    await linkOnly.presentBatch({
      userId: user.id,
      conversationId: conversation!.id,
      chatId: "test-chat",
      searchRunId: batch!.searchRunId,
      ranked: listings.map((listing) => ({
        listing,
        score: 50,
        breakdown: { commute: 0, budget: 0, moveIn: 0, duration: 0, size: 0, amenities: 0, freshness: 0 },
        reasons: [],
        commuteMinutes: null,
        commuteMode: null,
      })),
      language: "en",
      isFirstBatch: true,
    });

    expect(h.linq.cards()).toHaveLength(0);
    expect(h.linq.sent.filter((m) => m.kind === "rich_link")).toHaveLength(3);
  });
});
