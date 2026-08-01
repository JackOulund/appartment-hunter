import { describe, expect, it } from "vitest";
import { createHarness, TEST_CHAT_ID } from "../helpers/harness.js";

describe("contact card sharing on new conversations", () => {
  it("shares the contact card exactly once on the first inbound message", async () => {
    const h = await createHarness();

    await h.say("hello");

    expect(h.linq.sharedContactCardChats).toEqual([TEST_CHAT_ID]);
  });

  it("does not re-share on the second and third messages", async () => {
    const h = await createHarness();

    await h.say("hello");
    await h.say("second message");
    await h.say("third message");

    expect(h.linq.sharedContactCardChats).toEqual([TEST_CHAT_ID]);
  });

  it("completes the turn normally and never retries when shareContactCard throws", async () => {
    const h = await createHarness();
    h.linq.shareContactCardError = new Error("no contact card configured");

    await h.say("hello");

    expect(h.linq.sharedContactCardChats).toEqual([]);
    // The rest of the turn still ran — a reply went out despite the failure.
    expect(h.linq.texts().length).toBeGreaterThan(0);

    await h.say("second message");

    // One attempt per conversation, success or not — no retry storm.
    expect(h.linq.sharedContactCardChats).toEqual([]);
  });
});
