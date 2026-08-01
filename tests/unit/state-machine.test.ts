import { describe, expect, it } from "vitest";
import {
  acceptsListingReactions,
  allowedTransitions,
  canTransition,
  CONVERSATION_STATES,
  isConversationState,
  transition,
} from "../../src/domain/conversation-state.js";

describe("conversation state machine", () => {
  it("recognises every declared state", () => {
    for (const state of CONVERSATION_STATES) {
      expect(isConversationState(state)).toBe(true);
    }
    expect(isConversationState("NONSENSE")).toBe(false);
  });

  it("declares transitions for every state", () => {
    for (const state of CONVERSATION_STATES) {
      expect(allowedTransitions(state).length).toBeGreaterThan(0);
    }
  });

  it("allows the happy path from acceptance to results", () => {
    const path = [
      "NEW",
      "COLLECTING_UNIVERSITY",
      "COLLECTING_PREFERENCES",
      "CONFIRMING_PREFERENCES",
      "READY_TO_SEARCH",
      "SEARCHING",
      "PRESENTING_RESULTS",
      "REVIEWING_RESULTS",
    ] as const;

    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("allows the contact path only in order", () => {
    expect(canTransition("REVIEWING_RESULTS", "AWAITING_CONTACT_SELECTION")).toBe(true);
    expect(canTransition("AWAITING_CONTACT_SELECTION", "AWAITING_CONTACT_DETAILS")).toBe(true);
    expect(canTransition("AWAITING_CONTACT_DETAILS", "AWAITING_CONTACT_CONFIRMATION")).toBe(true);
    expect(canTransition("AWAITING_CONTACT_CONFIRMATION", "CONTACTING")).toBe(true);
  });

  it("refuses to jump straight from browsing to contacting", () => {
    expect(canTransition("REVIEWING_RESULTS", "CONTACTING")).toBe(false);
    expect(canTransition("NEW", "CONTACTING")).toBe(false);
    expect(canTransition("COLLECTING_PREFERENCES", "CONTACTING")).toBe(false);
  });

  it("refuses to skip preference confirmation before searching", () => {
    expect(canTransition("COLLECTING_PREFERENCES", "SEARCHING")).toBe(false);
  });

  it("recovers rather than throwing on an invalid transition", () => {
    const result = transition("NEW", "CONTACTING");
    expect(result.rejected).toBe(true);
    expect(result.changed).toBe(false);
    // Stays put instead of wedging the conversation.
    expect(result.state).toBe("NEW");
  });

  it("treats a same-state transition as a no-op", () => {
    const result = transition("REVIEWING_RESULTS", "REVIEWING_RESULTS");
    expect(result).toEqual({ state: "REVIEWING_RESULTS", changed: false, rejected: false });
  });

  it("keeps OPTED_OUT terminal except for an explicit restart", () => {
    expect(canTransition("OPTED_OUT", "SEARCHING")).toBe(false);
    expect(canTransition("OPTED_OUT", "REVIEWING_RESULTS")).toBe(false);
    expect(canTransition("OPTED_OUT", "NEW")).toBe(true);
  });

  it("allows pausing from anywhere useful and resuming afterwards", () => {
    expect(canTransition("REVIEWING_RESULTS", "PAUSED")).toBe(true);
    expect(canTransition("PAUSED", "REVIEWING_RESULTS")).toBe(true);
  });

  it("accepts listing reactions only while results are in play", () => {
    expect(acceptsListingReactions("REVIEWING_RESULTS")).toBe(true);
    expect(acceptsListingReactions("PRESENTING_RESULTS")).toBe(true);
    expect(acceptsListingReactions("COLLECTING_PREFERENCES")).toBe(false);
    expect(acceptsListingReactions("OPTED_OUT")).toBe(false);
  });
});
