import type { Repositories } from "../database/repositories/index.js";
import type { LinqAdapter, SendResult } from "../integrations/linq/linq-client.js";
import type { Language, RankedListing } from "../domain/entities.js";
import {
  buildBatchControlMessage,
  buildBatchIntro,
  buildListingCard,
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

export interface PresentationOptions {
  /** "card" opens inside Linq's app; "link" opens in Safari. */
  delivery?: "card" | "link";
}

export class PresentationService {
  private readonly delivery: "card" | "link";

  constructor(
    private readonly repos: Repositories,
    private readonly linq: LinqAdapter,
    options: PresentationOptions = {},
  ) {
    this.delivery = options.delivery ?? env.INSPECT_DELIVERY;
  }

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

      const token = createActionToken({
        listingId: ranked.listing.id,
        userId: input.userId,
        batchId: batch.id,
      });
      const link = await this.sendInspectCard({
        input,
        ranked,
        position,
        total: input.ranked.length,
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

  /**
   * The inspect view arrives as an app card, which opens inside Linq's iMessage
   * app rather than bouncing the user out to a browser.
   *
   * If the card cannot be sent — no handle on file, or the platform refuses the
   * action — the same URL still goes out as a rich link. A degraded preview beats
   * an apartment the user cannot open.
   */
  private async sendInspectCard(args: {
    input: PresentBatchInput;
    ranked: RankedListing;
    position: number;
    total: number;
    url: string;
    idempotencyKey: string;
  }): Promise<SendResult> {
    const { input, ranked, url, idempotencyKey } = args;
    const user = await this.repos.users.findById(input.userId);
    const card = buildListingCard(ranked, args.position, args.total, input.language);

    if (this.delivery === "card" && user?.linqHandle && !user.linqHandle.startsWith("deleted:")) {
      try {
        return await this.linq.sendActionCard({
          chatId: input.chatId,
          conversationId: input.conversationId,
          toHandle: user.linqHandle,
          url,
          title: card.title,
          subtitle: card.subtitle,
          button: card.button,
          idempotencyKey,
        });
      } catch (error) {
        logger.warn(
          { listingId: ranked.listing.id, error: String(error) },
          "app card rejected, falling back to a rich link",
        );
      }
    }

    return this.linq.sendRichLink({
      chatId: input.chatId,
      conversationId: input.conversationId,
      url,
      idempotencyKey,
    });
  }
}
