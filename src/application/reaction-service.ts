import type { Repositories } from "../database/repositories/index.js";
import { reactionPolarity } from "../integrations/linq/webhook-mapper.js";
import { logger } from "../utils/logger.js";

export type ReactionOutcome =
  | { kind: "listing"; listingId: string; batchId: string; decision: "liked" | "rejected" | "unseen" }
  | { kind: "control_more"; batchId: string }
  | { kind: "control_stop"; batchId: string }
  | { kind: "ignored"; reason: string };

export interface ReactionInput {
  userId: string;
  action: "added" | "removed";
  reactionType: string;
  targetMessageId: string | null;
}

export class ReactionService {
  constructor(private readonly repos: Repositories) {}

  /**
   * Routes a tapback to the apartment it belongs to, or to the batch control
   * message. The two are never confused because they are separate message ids.
   */
  async handle(input: ReactionInput): Promise<ReactionOutcome> {
    if (!input.targetMessageId) return { kind: "ignored", reason: "no_target_message" };

    const polarity = reactionPolarity(input.reactionType);
    if (polarity === "neutral") return { kind: "ignored", reason: "neutral_reaction" };

    // Control message first: it is a single row lookup and unambiguous.
    const batch = await this.repos.batches.findBatchByControlMessageId(input.targetMessageId);
    if (batch) {
      if (input.action === "removed") return { kind: "ignored", reason: "control_reaction_removed" };
      return polarity === "positive"
        ? { kind: "control_more", batchId: batch.id }
        : { kind: "control_stop", batchId: batch.id };
    }

    const presentation = await this.repos.batches.findPresentationByMessageId(input.targetMessageId);
    if (!presentation) return { kind: "ignored", reason: "unmapped_message" };

    const existing = await this.repos.decisions.find(input.userId, presentation.listingId);

    // Never let a removed tapback undo something already acted upon.
    if (existing && (existing.decision === "contacted" || existing.decision === "contact_requested")) {
      logger.info(
        { listingId: presentation.listingId, decision: existing.decision },
        "reaction ignored: application already in progress",
      );
      return { kind: "ignored", reason: "application_already_sent" };
    }

    if (input.action === "removed") {
      // Undo back to "seen but undecided".
      await this.repos.decisions.record({
        userId: input.userId,
        listingId: presentation.listingId,
        batchId: presentation.batchId,
        decision: "unseen",
        source: "reaction_removed",
        sourceMessageId: input.targetMessageId,
      });
      return {
        kind: "listing",
        listingId: presentation.listingId,
        batchId: presentation.batchId,
        decision: "unseen",
      };
    }

    const decision = polarity === "positive" ? "liked" : "rejected";
    await this.repos.decisions.record({
      userId: input.userId,
      listingId: presentation.listingId,
      batchId: presentation.batchId,
      decision: decision === "liked" ? "shortlisted" : "rejected",
      source: "reaction",
      sourceMessageId: input.targetMessageId,
    });

    return {
      kind: "listing",
      listingId: presentation.listingId,
      batchId: presentation.batchId,
      decision,
    };
  }
}
