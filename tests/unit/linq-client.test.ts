import { describe, expect, it } from "vitest";
import { LinqClient } from "../../src/integrations/linq/linq-client.js";
import type { OutboundMessageRepository } from "../../src/database/repositories/index.js";

/**
 * outbound is never touched by setContactCard (there is no idempotency dedupe
 * for a contact card), so an unimplemented stand-in is enough here.
 */
const outbound = {} as OutboundMessageRepository;

describe("LinqClient.setContactCard", () => {
  it("in dry-run mode resolves without calling the SDK", async () => {
    const client = new LinqClient({ outbound, dryRun: true });

    const result = await client.setContactCard({
      firstName: "Hjem",
      phoneNumber: "+46700000000",
    });

    expect(result.dryRun).toBe(true);
  });

  it("never constructs a live SDK client while in dry-run mode", async () => {
    const client = new LinqClient({ outbound, dryRun: true, apiKey: "would-be-real-key" });

    // requireSdk() throws when there is no live SDK instance; dry-run must never
    // reach it, so a call that would only succeed via the real SDK must not throw
    // for the wrong reason (network, auth, etc.) — it must simply resolve.
    await expect(
      client.setContactCard({ firstName: "Hjem", phoneNumber: "+46700000000" }),
    ).resolves.toMatchObject({ dryRun: true, isActive: false });
  });
});

describe("LinqClient.shareContactCard", () => {
  it("in dry-run mode resolves without calling the SDK", async () => {
    const client = new LinqClient({ outbound, dryRun: true, apiKey: "would-be-real-key" });

    // requireSdk() throws when there is no live SDK instance; dry-run must
    // never reach it, so this must simply resolve.
    await expect(client.shareContactCard("chat-123")).resolves.toBeUndefined();
  });
});
