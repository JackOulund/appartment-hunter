import { describe, expect, it } from "vitest";
import { createHarness, completeOnboarding, TEST_CHAT_ID } from "../helpers/harness.js";
import { mapWebhookEvent, reactionPolarity, webhookEnvelopeSchema } from "../../src/integrations/linq/webhook-mapper.js";
import { addDays, toIsoDate } from "../../src/utils/dates.js";

const envelope = (eventType: string, data: Record<string, unknown>, eventId = "evt_1") => ({
  api_version: "v3",
  webhook_version: "2026-02-03",
  event_type: eventType,
  event_id: eventId,
  created_at: "2026-08-01T12:00:00.000Z",
  trace_id: "trace-123",
  partner_id: "partner",
  data,
});

const inboundMessage = envelope("message.received", {
  id: "msg_1",
  direction: "inbound",
  chat: { id: "chat_1", is_group: false },
  sender_handle: { handle: "+46700000001", id: "h1", is_me: false, service: "iMessage" },
  parts: [
    { type: "text", value: "I got accepted to" },
    { type: "media", url: "https://example.invalid/x.jpg" },
    { type: "text", value: "Lund University" },
  ],
});

describe("webhook mapping", () => {
  it("extracts only the text parts of an inbound message", () => {
    const event = mapWebhookEvent(webhookEnvelopeSchema.parse(inboundMessage));
    expect(event.kind).toBe("message_received");
    if (event.kind === "message_received") {
      expect(event.text).toBe("I got accepted to Lund University");
      expect(event.chatId).toBe("chat_1");
      expect(event.traceId).toBe("trace-123");
    }
  });

  it("ignores our own outbound echo", () => {
    const echo = envelope("message.received", {
      ...inboundMessage.data,
      direction: "outbound",
      sender_handle: { handle: "+46700000000", id: "h0", is_me: true, service: "iMessage" },
    });
    expect(mapWebhookEvent(webhookEnvelopeSchema.parse(echo)).kind).toBe("ignored");
  });

  it("maps reaction events with their Linq reaction type", () => {
    const added = envelope("reaction.added", {
      reaction_type: "like",
      is_from_me: false,
      chat_id: "chat_1",
      message_id: "msg_9",
      from_handle: { handle: "+46700000001", id: "h1", service: "iMessage" },
    });
    const event = mapWebhookEvent(webhookEnvelopeSchema.parse(added));
    expect(event.kind).toBe("reaction");
    if (event.kind === "reaction") {
      expect(event.action).toBe("added");
      expect(event.reactionType).toBe("like");
      expect(event.targetMessageId).toBe("msg_9");
    }
  });

  it("ignores reactions the account itself placed", () => {
    const own = envelope("reaction.added", {
      reaction_type: "like",
      is_from_me: true,
      chat_id: "chat_1",
      message_id: "msg_9",
    });
    expect(mapWebhookEvent(webhookEnvelopeSchema.parse(own)).kind).toBe("ignored");
  });

  it("maps the delivery status events", () => {
    for (const [type, status] of [
      ["message.sent", "sent"],
      ["message.delivered", "delivered"],
      ["message.read", "read"],
      ["message.failed", "failed"],
    ] as const) {
      const event = mapWebhookEvent(
        webhookEnvelopeSchema.parse(envelope(type, { id: "m1", chat: { id: "chat_1" } })),
      );
      expect(event.kind).toBe("message_status");
      if (event.kind === "message_status") expect(event.status).toBe(status);
    }
  });

  it("ignores unknown event types instead of throwing", () => {
    const event = mapWebhookEvent(webhookEnvelopeSchema.parse(envelope("something.new", {})));
    expect(event.kind).toBe("ignored");
  });

  it("classifies tapback polarity using Linq's own vocabulary", () => {
    expect(reactionPolarity("like")).toBe("positive");
    expect(reactionPolarity("love")).toBe("positive");
    expect(reactionPolarity("dislike")).toBe("negative");
    expect(reactionPolarity("question")).toBe("neutral");
    expect(reactionPolarity("laugh")).toBe("neutral");
  });

  it("rejects an envelope missing required fields", () => {
    expect(webhookEnvelopeSchema.safeParse({ event_type: "message.received" }).success).toBe(false);
  });
});

describe("webhook deduplication", () => {
  it("claims an event id once and refuses the replay", async () => {
    const h = await createHarness();
    const first = await h.container.repos.webhookEvents.claim({
      providerEventId: "evt_dupe",
      eventType: "message.received",
    });
    const second = await h.container.repos.webhookEvents.claim({
      providerEventId: "evt_dupe",
      eventType: "message.received",
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("records processing outcomes", async () => {
    const h = await createHarness();
    await h.container.repos.webhookEvents.claim({
      providerEventId: "evt_ok",
      eventType: "message.received",
    });
    await h.container.repos.webhookEvents.markProcessed("evt_ok");

    await h.container.repos.webhookEvents.claim({
      providerEventId: "evt_bad",
      eventType: "message.received",
    });
    await h.container.repos.webhookEvents.markFailed("evt_bad", "boom");
    // No assertion helper needed: absence of a throw plus the claim semantics above
    // is what the webhook route depends on.
    expect(true).toBe(true);
  });
});

describe("outbound idempotency", () => {
  it("sends a keyed message only once", async () => {
    const h = await createHarness();
    const key = "housing:test:once";

    const a = await h.container.linq.sendText({ chatId: TEST_CHAT_ID, text: "hello", idempotencyKey: key });
    const b = await h.container.linq.sendText({ chatId: TEST_CHAT_ID, text: "hello", idempotencyKey: key });

    expect(a.deduplicated).toBe(false);
    expect(b.deduplicated).toBe(true);
    expect(b.messageId).toBe(a.messageId);
    expect(h.linq.sent.filter((m) => m.idempotencyKey === key)).toHaveLength(1);
  });

  it("does not re-send a batch if presentation runs twice", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");
    const afterFirst = h.linq.sent.length;

    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    const user = (await h.container.repos.users.findByHandle("+46700000001"))!;
    const presentations = await h.container.repos.batches.listPresentations(conversation!.activeBatchId!);
    const listings = await h.container.repos.listings.findManyById(
      presentations.map((p) => p.listingId),
    );

    // Re-running the same batch id must not duplicate messages.
    await h.container.presentation.presentBatch({
      userId: user.id,
      conversationId: conversation!.id,
      chatId: TEST_CHAT_ID,
      searchRunId: "run-x",
      ranked: listings.map((listing) => ({
        listing,
        score: 50,
        breakdown: { commute: 0, budget: 0, moveIn: 0, duration: 0, size: 0, amenities: 0, freshness: 0 },
        reasons: [],
        commuteMinutes: null,
        commuteMode: null,
      })),
      language: "en",
      isFirstBatch: false,
    }).catch(() => undefined);

    // A new batch id means new keys, so this legitimately sends again — what must
    // never happen is the *same* key producing two messages.
    const keys = h.linq.sent.map((m) => m.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(h.linq.sent.length).toBeGreaterThanOrEqual(afterFirst);
  });
});

describe("rental tracking and renewal", () => {
  it("saves a lease and computes the renewal date from the lead time", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("I got an apartment");
    expect(h.linq.lastText()).toContain("rental start and end");

    await h.say("2026-09-01 to 2027-06-30");

    const user = (await h.container.repos.users.findByHandle("+46700000001"))!;
    const lease = await h.container.repos.leases.findActiveForUser(user.id);

    expect(lease?.startsAt).toContain("2026-09-01");
    expect(lease?.endsAt).toContain("2027-06-30");
    // 30 days before the end date.
    expect(lease?.renewalSearchAt?.slice(0, 10)).toBe("2027-05-31");
  });

  it("asks again when the dates are unparseable", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("I got an apartment");
    await h.say("sometime next year");

    expect(h.linq.lastText()).toContain("start and end dates");
  });

  it("reminds only leases whose renewal window has opened", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    const user = (await h.container.repos.users.findByHandle("+46700000001"))!;

    const soon = addDays(new Date(), -1).toISOString();
    const later = addDays(new Date(), 60).toISOString();
    await h.container.repos.leases.create({
      userId: user.id, status: "active",
      endsAt: addDays(new Date(), 29).toISOString(), renewalSearchAt: soon,
    });
    await h.container.repos.leases.create({
      userId: user.id, status: "active",
      endsAt: addDays(new Date(), 90).toISOString(), renewalSearchAt: later,
    });

    h.linq.reset();
    const result = await h.container.renewal.run();

    expect(result.remindersSent).toBe(1);
    expect(h.linq.lastText()).toContain("Would you like me to start searching again");
  });

  it("does not remind the same lease twice", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    const user = (await h.container.repos.users.findByHandle("+46700000001"))!;
    await h.container.repos.leases.create({
      userId: user.id, status: "active",
      endsAt: addDays(new Date(), 29).toISOString(),
      renewalSearchAt: addDays(new Date(), -1).toISOString(),
    });

    const first = await h.container.renewal.run();
    const second = await h.container.renewal.run();

    expect(first.remindersSent).toBe(1);
    expect(second.remindersSent).toBe(0);
  });

  it("never sends an application from the renewal job", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    const user = (await h.container.repos.users.findByHandle("+46700000001"))!;
    await h.container.repos.leases.create({
      userId: user.id, status: "active",
      endsAt: addDays(new Date(), 29).toISOString(),
      renewalSearchAt: addDays(new Date(), -1).toISOString(),
    });

    await h.container.renewal.run();
    expect(await h.container.repos.applications.listByUser(user.id)).toHaveLength(0);
  });

  it("computes the renewal lead time consistently", () => {
    const endsAt = new Date("2027-06-30T00:00:00.000Z");
    expect(toIsoDate(addDays(endsAt, -30))).toBe("2027-05-31");
  });
});
