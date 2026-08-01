export const CONVERSATION_STATES = [
  "NEW",
  "COLLECTING_UNIVERSITY",
  "COLLECTING_PREFERENCES",
  "CONFIRMING_PREFERENCES",
  "READY_TO_SEARCH",
  "SEARCHING",
  "PRESENTING_RESULTS",
  "REVIEWING_RESULTS",
  "AWAITING_MORE_DECISION",
  "AWAITING_CONTACT_SELECTION",
  "AWAITING_CONTACT_DETAILS",
  "AWAITING_CONTACT_CONFIRMATION",
  "CONTACTING",
  "TRACKING_RENTAL",
  "PAUSED",
  "OPTED_OUT",
  "ERROR",
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

export function isConversationState(value: string): value is ConversationState {
  return (CONVERSATION_STATES as readonly string[]).includes(value);
}

/**
 * Explicit adjacency list. Anything not listed here is rejected — the LLM cannot
 * talk the conversation into an irreversible transition.
 */
const TRANSITIONS: Record<ConversationState, readonly ConversationState[]> = {
  NEW: ["COLLECTING_UNIVERSITY", "COLLECTING_PREFERENCES", "OPTED_OUT", "ERROR"],
  COLLECTING_UNIVERSITY: ["COLLECTING_UNIVERSITY", "COLLECTING_PREFERENCES", "PAUSED", "OPTED_OUT", "ERROR"],
  COLLECTING_PREFERENCES: [
    "COLLECTING_PREFERENCES",
    "COLLECTING_UNIVERSITY",
    "CONFIRMING_PREFERENCES",
    "TRACKING_RENTAL",
    "PAUSED",
    "OPTED_OUT",
    "ERROR",
  ],
  CONFIRMING_PREFERENCES: [
    "COLLECTING_PREFERENCES",
    "CONFIRMING_PREFERENCES",
    "READY_TO_SEARCH",
    "TRACKING_RENTAL",
    "PAUSED",
    "OPTED_OUT",
    "ERROR",
  ],
  READY_TO_SEARCH: ["SEARCHING", "COLLECTING_PREFERENCES", "PAUSED", "OPTED_OUT", "ERROR"],
  SEARCHING: ["PRESENTING_RESULTS", "REVIEWING_RESULTS", "READY_TO_SEARCH", "ERROR", "PAUSED", "OPTED_OUT"],
  PRESENTING_RESULTS: ["REVIEWING_RESULTS", "AWAITING_MORE_DECISION", "ERROR", "PAUSED", "OPTED_OUT"],
  REVIEWING_RESULTS: [
    "REVIEWING_RESULTS",
    "AWAITING_MORE_DECISION",
    "AWAITING_CONTACT_SELECTION",
    "SEARCHING",
    "COLLECTING_PREFERENCES",
    "TRACKING_RENTAL",
    "PAUSED",
    "OPTED_OUT",
    "ERROR",
  ],
  AWAITING_MORE_DECISION: [
    "SEARCHING",
    "REVIEWING_RESULTS",
    "AWAITING_CONTACT_SELECTION",
    "COLLECTING_PREFERENCES",
    "TRACKING_RENTAL",
    "PAUSED",
    "OPTED_OUT",
    "ERROR",
  ],
  AWAITING_CONTACT_SELECTION: [
    "AWAITING_CONTACT_DETAILS",
    "AWAITING_CONTACT_CONFIRMATION",
    "REVIEWING_RESULTS",
    "PAUSED",
    "OPTED_OUT",
    "ERROR",
  ],
  AWAITING_CONTACT_DETAILS: [
    "AWAITING_CONTACT_DETAILS",
    "AWAITING_CONTACT_CONFIRMATION",
    "REVIEWING_RESULTS",
    "PAUSED",
    "OPTED_OUT",
    "ERROR",
  ],
  AWAITING_CONTACT_CONFIRMATION: [
    "CONTACTING",
    "REVIEWING_RESULTS",
    "AWAITING_CONTACT_DETAILS",
    "PAUSED",
    "OPTED_OUT",
    "ERROR",
  ],
  CONTACTING: ["REVIEWING_RESULTS", "TRACKING_RENTAL", "ERROR", "PAUSED", "OPTED_OUT"],
  TRACKING_RENTAL: ["TRACKING_RENTAL", "COLLECTING_PREFERENCES", "READY_TO_SEARCH", "PAUSED", "OPTED_OUT", "ERROR"],
  PAUSED: ["REVIEWING_RESULTS", "COLLECTING_PREFERENCES", "READY_TO_SEARCH", "TRACKING_RENTAL", "OPTED_OUT", "ERROR"],
  // Terminal: a user who opted out is only revived by an explicit restart.
  OPTED_OUT: ["NEW", "OPTED_OUT"],
  ERROR: ["COLLECTING_PREFERENCES", "REVIEWING_RESULTS", "READY_TO_SEARCH", "PAUSED", "NEW", "OPTED_OUT"],
};

export function canTransition(from: ConversationState, to: ConversationState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: ConversationState): readonly ConversationState[] {
  return TRANSITIONS[from];
}

export interface TransitionResult {
  state: ConversationState;
  changed: boolean;
}

/**
 * Applies a transition, or falls back to a safe state instead of throwing —
 * a webhook arriving out of order should not wedge the conversation.
 */
export function transition(
  from: ConversationState,
  to: ConversationState,
): TransitionResult & { rejected: boolean } {
  if (from === to) return { state: to, changed: false, rejected: false };
  if (canTransition(from, to)) return { state: to, changed: true, rejected: false };
  return { state: from, changed: false, rejected: true };
}

/** States in which an inbound reaction on a listing is meaningful. */
export function acceptsListingReactions(state: ConversationState): boolean {
  return (
    state === "PRESENTING_RESULTS" ||
    state === "REVIEWING_RESULTS" ||
    state === "AWAITING_MORE_DECISION" ||
    state === "AWAITING_CONTACT_SELECTION"
  );
}
