import type { Repositories } from "../database/repositories/index.js";
import type { LinqAdapter } from "../integrations/linq/linq-client.js";
import { requireActionToken } from "../security/action-tokens.js";
import { buildInspectFollowUp } from "../integrations/linq/message-builder.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { Language } from "../domain/entities.js";

/**
 * The only events the inspect view may report. An unrecognised name is rejected
 * rather than stored — the beacon endpoint is reachable by anyone holding a link,
 * so it must not become a free-text sink.
 */
export const LISTING_VIEW_EVENTS = [
  "opened",
  "gallery_viewed",
  "reject_clicked",
  "contact_clicked",
  "closed",
] as const;

export type ListingViewEvent = (typeof LISTING_VIEW_EVENTS)[number];

function isListingViewEvent(value: string): value is ListingViewEvent {
  return (LISTING_VIEW_EVENTS as readonly string[]).includes(value);
}

export interface RecordEventResult {
  event: ListingViewEvent;
  followedUp: boolean;
}

/**
 * Closes the loop between the app card's page and the conversation.
 *
 * The page reports what the user did; this service records it and, in exactly one
 * case, says something back in iMessage. It never records a decision, never moves
 * the conversation's state, and never sends anything to a landlord — a beacon is
 * an observation, not consent.
 */
export class ExperienceService {
  constructor(
    private readonly repos: Repositories,
    private readonly linq: LinqAdapter,
  ) {}

  async recordEvent(input: { token: string; event: string }): Promise<RecordEventResult> {
    if (!isListingViewEvent(input.event)) {
      throw new AppError("invalid_event", "Unknown event.", { status: 400 });
    }
    // Throws before anything is written, so a bad token leaves no trace.
    const payload = requireActionToken(input.token);

    const user = await this.repos.users.findById(payload.userId);
    if (!user || user.deletedAt) {
      throw new AppError("forbidden", "This link is no longer available.");
    }

    await this.repos.viewEvents.record({
      userId: payload.userId,
      listingId: payload.listingId,
      batchId: payload.batchId,
      event: input.event,
    });

    const followedUp =
      input.event === "closed"
        ? await this.followUpOnUndecided(payload.userId, payload.listingId, payload.batchId)
        : false;

    return { event: input.event, followedUp };
  }

  /**
   * The user looked at an apartment and left without choosing. Offer the next
   * step once — the idempotency key is what makes "once" survive a reopened page,
   * a duplicated beacon, or a restart.
   */
  private async followUpOnUndecided(
    userId: string,
    listingId: string,
    batchId: string | null,
  ): Promise<boolean> {
    const decision = await this.repos.decisions.find(userId, listingId);
    // "unseen" is the row written when the apartment was presented, so it still
    // counts as undecided; anything else means the user has already acted.
    if (decision && decision.decision !== "unseen") return false;

    const events = await this.repos.viewEvents.listForListing(userId, listingId);
    if (events.some((row) => row.event === "contact_clicked" || row.event === "reject_clicked")) {
      return false;
    }

    const conversation = await this.repos.conversations.findByUserId(userId);
    if (!conversation) return false;
    // Mid-application or paused conversations are not interrupted.
    if (!["PRESENTING_RESULTS", "REVIEWING_RESULTS", "AWAITING_MORE_DECISION"].includes(conversation.currentState)) {
      return false;
    }

    const listing = await this.repos.listings.findById(listingId);
    if (!listing) return false;

    const position = batchId ? await this.positionInBatch(batchId, listingId) : null;
    if (position === null) return false;

    const user = await this.repos.users.findById(userId);
    const language = (user?.preferredLanguage as Language) ?? "en";

    const result = await this.linq.sendText({
      chatId: conversation.linqChatId,
      conversationId: conversation.id,
      text: buildInspectFollowUp(listing.title, position, language),
      idempotencyKey: `housing:${batchId}:${listingId}:inspected`,
    });

    if (!result.deduplicated) {
      logger.info({ listingId, position }, "followed up after an undecided inspect view");
    }
    return !result.deduplicated;
  }

  private async positionInBatch(batchId: string, listingId: string): Promise<number | null> {
    const presentations = await this.repos.batches.listPresentations(batchId);
    const match = presentations.find((row) => row.listingId === listingId);
    return match?.presentationOrder ?? null;
  }
}
