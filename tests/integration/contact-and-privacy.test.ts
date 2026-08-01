import { describe, expect, it } from "vitest";
import { completeOnboarding, createHarness, TEST_CHAT_ID, type Harness } from "../helpers/harness.js";
import { MockHousingProvider } from "../../src/integrations/housing/mock-housing-provider.js";
import { MOCK_LISTINGS } from "../../src/integrations/housing/mock-listings.js";
import { isAppError } from "../../src/utils/errors.js";
import { sha256 } from "../../src/utils/ids.js";

/** Runs the flow up to a shortlist plus complete contact details. */
async function readyToContact(h: Harness) {
  await completeOnboarding(h);
  await h.say("SEARCH");
  await h.say("like 1");
  await h.say("contact 1");
  await h.say("Jack Joulund");
  await h.say("jack@example.com");
  await h.say("+46701234567");
  const user = (await h.container.repos.users.findByHandle("+46700000001"))!;
  const application = (await h.container.repos.applications.listByUser(user.id))[0]!;
  return { user, application };
}

describe("contact details", () => {
  it("is never asked for before the user wants to contact a landlord", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");

    const asked = h.linq.texts().join(" ").toLowerCase();
    expect(asked).not.toContain("full name");
    expect(asked).not.toContain("email address");

    const user = await h.container.repos.users.findByHandle("+46700000001");
    expect(user?.fullName).toBeNull();
  });

  it("collects name, email and phone one at a time", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");

    await h.say("contact 1");
    expect(h.linq.lastText()).toContain("full name");
    await h.say("Jack Joulund");
    expect(h.linq.lastText()).toContain("email");
    await h.say("jack@example.com");
    expect(h.linq.lastText()).toContain("phone");
    await h.say("+46701234567");
    expect(h.linq.lastText()).toContain("Review and confirm");
  });

  it("rejects an invalid email and asks again", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");
    await h.say("contact 1");
    await h.say("Jack Joulund");
    await h.say("not-an-email");

    expect(h.linq.lastText()).toContain("valid email");
    const user = await h.container.repos.users.findByHandle("+46700000001");
    expect(user?.email).toBeNull();
  });
});

describe("application drafting", () => {
  it("creates a draft with no fabricated background", async () => {
    const h = await createHarness();
    const { application } = await readyToContact(h);

    const draft = application.draftMessage.toLowerCase();
    expect(draft).toContain("jack joulund");
    expect(draft).toContain("lund university");
    for (const invented of ["income", "salary", "employed", "guarantor", "credit score", "reference"]) {
      expect(draft).not.toContain(invented);
    }
  });

  it("starts as a draft and sends nothing", async () => {
    const h = await createHarness();
    const { application } = await readyToContact(h);
    expect(application.status).toBe("draft");
    expect(application.sentAt).toBeNull();
  });

  it("invalidates an outstanding confirmation when the message is edited", async () => {
    const h = await createHarness();
    const { application, user } = await readyToContact(h);

    await h.container.applications.requestConfirmation(application.id, user.id);
    await h.container.applications.updateDraft(application.id, user.id, "My own wording.");

    const updated = await h.container.repos.applications.findById(application.id);
    expect(updated?.confirmationTokenHash).toBeNull();
    expect(updated?.editedMessage).toBe("My own wording.");
  });
});

describe("explicit confirmation", () => {
  it("refuses to send without a confirmation", async () => {
    const h = await createHarness();
    const { application, user } = await readyToContact(h);

    await expect(
      h.container.applications.confirmAndSend({
        applicationId: application.id,
        userId: user.id,
        token: "anything",
      }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "confirmation_required");
  });

  it("refuses a wrong confirmation token", async () => {
    const h = await createHarness();
    const { application, user } = await readyToContact(h);
    await h.container.applications.requestConfirmation(application.id, user.id);

    await expect(
      h.container.applications.confirmAndSend({
        applicationId: application.id,
        userId: user.id,
        token: "wrong-token",
      }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "token_invalid");
  });

  it("refuses an expired confirmation", async () => {
    const h = await createHarness();
    const { application, user } = await readyToContact(h);
    const { token } = await h.container.applications.requestConfirmation(application.id, user.id);

    const sixteenMinutesLater = new Date(Date.now() + 16 * 60 * 1000);
    await expect(
      h.container.applications.confirmAndSend({
        applicationId: application.id,
        userId: user.id,
        token,
        now: sixteenMinutesLater,
      }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "confirmation_expired");
  });

  it("stores the confirmation token only as a hash", async () => {
    const h = await createHarness();
    const { application, user } = await readyToContact(h);
    const { token } = await h.container.applications.requestConfirmation(application.id, user.id);

    const row = await h.container.repos.applications.findById(application.id);
    expect(row?.confirmationTokenHash).toBe(sha256(token));
    expect(row?.confirmationTokenHash).not.toBe(token);
  });

  it("refuses to send for a different user", async () => {
    const h = await createHarness();
    const { application } = await readyToContact(h);
    const other = await h.container.repos.users.ensure("+46700009999");

    await expect(
      h.container.applications.confirmAndSend({
        applicationId: application.id,
        userId: other.id,
        token: "x",
      }),
    ).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "forbidden");
  });
});

describe("sending in dry-run", () => {
  /** Forces a specific listing so the contact capability under test is deterministic. */
  const providerWith = (id: string) =>
    new MockHousingProvider(MOCK_LISTINGS.filter((l) => l.id === id));

  it("records the application without contacting anyone", async () => {
    const h = await createHarness({ housing: providerWith("mock-lund-001") });
    const { application, user } = await readyToContact(h);
    const { token } = await h.container.applications.requestConfirmation(application.id, user.id);

    const result = await h.container.applications.confirmAndSend({
      applicationId: application.id,
      userId: user.id,
      token,
    });

    expect(result.status).toBe("sent");
    const row = await h.container.repos.applications.findById(application.id);
    expect(row?.status).toBe("sent");
    expect(row?.externalMessageId).toContain("dryrun-");
    // The provider was never actually invoked.
    expect(h.housing.getContactLog()).toHaveLength(0);
  });

  it("does not fake success when the listing needs a manual handoff", async () => {
    const h = await createHarness({ housing: providerWith("mock-lund-004") });
    const { application, user } = await readyToContact(h);
    const { token } = await h.container.applications.requestConfirmation(application.id, user.id);

    const result = await h.container.applications.confirmAndSend({
      applicationId: application.id,
      userId: user.id,
      token,
    });

    expect(result.status).toBe("manual_required");
    expect(result.manualUrl).toBeTruthy();
    const row = await h.container.repos.applications.findById(application.id);
    expect(row?.status).toBe("manual_handoff");
    expect(row?.sentAt).toBeNull();
  });

  it("reports a simulated provider failure honestly", async () => {
    const h = await createHarness({ housing: providerWith("mock-lund-008") });
    const { application, user } = await readyToContact(h);
    const { token } = await h.container.applications.requestConfirmation(application.id, user.id);

    const result = await h.container.applications.confirmAndSend({
      applicationId: application.id,
      userId: user.id,
      token,
    });

    expect(result.status).toBe("failed");
    const row = await h.container.repos.applications.findById(application.id);
    expect(row?.status).toBe("failed");
    expect(row?.sentAt).toBeNull();
  });

  it("prevents a duplicate send with a replayed token", async () => {
    const h = await createHarness({ housing: providerWith("mock-lund-001") });
    const { application, user } = await readyToContact(h);
    const { token } = await h.container.applications.requestConfirmation(application.id, user.id);

    const first = await h.container.applications.confirmAndSend({
      applicationId: application.id,
      userId: user.id,
      token,
    });
    const second = await h.container.applications.confirmAndSend({
      applicationId: application.id,
      userId: user.id,
      token,
    });

    expect(first.status).toBe("sent");
    // Idempotent: reports the existing result rather than sending again.
    expect(second.status).toBe("sent");
    const row = await h.container.repos.applications.findById(application.id);
    expect(row?.status).toBe("sent");
  });

  it("marks the listing as contacted so reactions can no longer change it", async () => {
    const h = await createHarness({ housing: providerWith("mock-lund-001") });
    const { application, user } = await readyToContact(h);
    const { token } = await h.container.applications.requestConfirmation(application.id, user.id);
    await h.container.applications.confirmAndSend({
      applicationId: application.id,
      userId: user.id,
      token,
    });

    const summary = h.linq.listingSummaries()[0]!;
    await h.react(summary.messageId, "dislike");

    const decision = await h.container.repos.decisions.find(user.id, application.listingId);
    expect(decision?.decision).toBe("contacted");
  });
});

describe("privacy", () => {
  it("requires explicit confirmation before deleting", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("delete my data");

    expect(h.linq.lastText()).toContain("Reply YES");
    const user = await h.container.repos.users.findByHandle("+46700000001");
    expect(user?.deletedAt).toBeNull();
  });

  it("deletes the profile and stops searching once confirmed", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("SEARCH");
    await h.say("delete my data");
    await h.say("yes");

    const user = await h.container.repos.users.findByHandle("+46700000001");
    expect(user).toBeNull(); // handle was rewritten

    const conversation = await h.container.repos.conversations.findByChatId(TEST_CHAT_ID);
    expect(conversation?.currentState).toBe("OPTED_OUT");

    const decisions = await h.container.repos.decisions.listByUser(conversation!.userId);
    expect(decisions).toHaveLength(0);

    const anonymised = await h.container.repos.users.findById(conversation!.userId);
    expect(anonymised?.email).toBeNull();
    expect(anonymised?.fullName).toBeNull();
    expect(anonymised?.deletedAt).not.toBeNull();
  });

  it("cancels deletion when the user declines", async () => {
    const h = await createHarness();
    await completeOnboarding(h);
    await h.say("delete my data");
    await h.say("no");

    expect(h.linq.lastText()).toContain("nothing was deleted");
    const user = await h.container.repos.users.findByHandle("+46700000001");
    expect(user?.deletedAt).toBeNull();
  });
});
