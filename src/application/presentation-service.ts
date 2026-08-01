import type { Repositories } from "../database/repositories/index.js";
import type { LinqAdapter } from "../integrations/linq/linq-client.js";
import type { Language, RankedListing } from "../domain/entities.js";
import {
  buildBatchControlMessage,
  buildBatchIntro,
  buildListingSummary,
} from "../integrations/linq/message-builder.js";
import { createActionToken } from "../security/action-tokens.js";
import { idempotencyKeys } from "../utils/ids.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export interface PresentBatchInput {
  userId: string;
  conversationId: string;
  chatId: string;
  searchRunId: string;
  ranked: RankedListing[];
  language: Language;
  isFirstBatch: boolean;
}

export interface PresentBatchOutput {
  batchId: string;
  presentedListingIds: string[];
  controlMessageId: string | null;
}

export class PresentationService {
  constructor(
    private readonly repos: Repositories,
    private readonly linq: LinqAdapter,
  ) {}

  /**
   * Sends one intro, then three separate apartments (summary, media, rich link
   * each as their own message), then the batch control message. Message ids are
   * persisted per apartment so a later reaction can be routed back to it.
   */
  async presentBatch(input: PresentBatchInput): Promise<PresentBatchOutput> {
    const batch = await this.repos.batches.create(input.userId, input.searchRunId);

    await this.linq.sendText({
      chatId: input.chatId,
      conversationId: input.conversationId,
      text: buildBatchIntro(input.language, input.isFirstBatch),
      idempotencyKey: idempotencyKeys.batchIntro(batch.id),
    });

    const presentedListingIds: string[] = [];

    for (const [index, ranked] of input.ranked.entries()) {
      const position = index + 1;
      const presentation = await this.repos.batches.addPresentation(batch.id, ranked.listing.id, position);

      const summary = await this.linq.sendText({
        chatId: input.chatId,
        conversationId: input.conversationId,
        text: buildListingSummary(ranked, position, input.ranked.length, input.language),
        idempotencyKey: idempotencyKeys.listingSummary(batch.id, ranked.listing.id),
      });

      let mediaMessageId: string | undefined;
      const heroImage = ranked.listing.imageUrls[0];
      if (heroImage) {
        const media = await this.linq.sendMedia({
          chatId: input.chatId,
          conversationId: input.conversationId,
          imageUrl: heroImage,
          idempotencyKey: idempotencyKeys.listingMedia(batch.id, ranked.listing.id),
        });
        mediaMessageId = media.messageId;
      }

      // A rich link must travel alone to render as a preview card.
      const token = createActionToken({
        listingId: ranked.listing.id,
        userId: input.userId,
        batchId: batch.id,
      });
      const link = await this.linq.sendRichLink({
        chatId: input.chatId,
        conversationId: input.conversationId,
        url: `${env.BASE_URL}/l/${token}`,
        idempotencyKey: idempotencyKeys.listingLink(batch.id, ranked.listing.id),
      });

      await this.repos.batches.setPresentationMessageIds(presentation.id, {
        summaryMessageId: summary.messageId,
        ...(mediaMessageId ? { mediaMessageId } : {}),
        linkMessageId: link.messageId,
      });

      // Mark as seen so the next batch cannot repeat it.
      await this.repos.decisions.record({
        userId: input.userId,
        listingId: ranked.listing.id,
        batchId: batch.id,
        decision: "unseen",
        source: "presentation",
        sourceMessageId: summary.messageId,
      });

      presentedListingIds.push(ranked.listing.id);
    }

    const control = await this.linq.sendText({
      chatId: input.chatId,
      conversationId: input.conversationId,
      text: buildBatchControlMessage(input.language),
      idempotencyKey: idempotencyKeys.batchControl(batch.id),
    });
    await this.repos.batches.setControlMessageId(batch.id, control.messageId);

    await this.repos.conversations.patch(input.conversationId, { activeBatchId: batch.id });

    logger.info(
      { batchId: batch.id, count: presentedListingIds.length },
      "batch presented",
    );

    return {
      batchId: batch.id,
      presentedListingIds,
      controlMessageId: control.messageId,
    };
  }
}
