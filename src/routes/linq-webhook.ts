import { Hono } from "hono";
import type { Container } from "../application/container.js";
import { verifyLinqWebhook } from "../integrations/linq/webhook-verifier.js";
import { mapWebhookEvent, webhookEnvelopeSchema } from "../integrations/linq/webhook-mapper.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { redactHandle } from "../security/redaction.js";

const MAX_BODY_BYTES = 1_000_000;

export function linqWebhookRoutes(container: Container): Hono {
  const app = new Hono();

  app.post("/webhooks/linq", async (c) => {
    // 1. Raw body first — the signature covers exact bytes.
    const rawBody = await c.req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return c.json({ error: "payload_too_large" }, 413);
    }

    // 2. Verify signature and timestamp.
    const verification = verifyLinqWebhook({
      rawBody,
      headers: Object.fromEntries(
        Object.entries(c.req.header()).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      secret: env.LINQ_WEBHOOK_SECRET,
    });

    if (!verification.valid) {
      // In dry-run local development an unsigned simulator payload is allowed
      // through so the demo works without a Linq webhook secret.
      const allowUnsigned = env.LINQ_DRY_RUN && !env.LINQ_WEBHOOK_SECRET;
      if (!allowUnsigned) {
        logger.warn({ reason: verification.reason }, "rejected webhook");
        return c.json({ error: "invalid_signature" }, 400);
      }
      logger.warn({ reason: verification.reason }, "accepting unsigned webhook (dry-run, no secret configured)");
    }

    // 3. Validate the envelope.
    let envelope;
    try {
      envelope = webhookEnvelopeSchema.parse(JSON.parse(rawBody));
    } catch (error) {
      logger.warn({ error: String(error) }, "webhook envelope failed validation");
      return c.json({ error: "invalid_payload" }, 400);
    }

    // 4. Deduplicate on Linq's event id.
    const claimed = await container.repos.webhookEvents.claim({
      providerEventId: envelope.event_id,
      eventType: envelope.event_type,
      traceId: envelope.trace_id ?? null,
    });
    if (!claimed) {
      logger.debug({ eventId: envelope.event_id }, "duplicate webhook ignored");
      return c.body(null, 204);
    }

    // 5. Return quickly; process after responding.
    const event = mapWebhookEvent(envelope);
    queueMicrotask(() => {
      void process(container, event, envelope.event_id);
    });

    return c.body(null, 204);
  });

  return app;
}

async function process(
  container: Container,
  event: ReturnType<typeof mapWebhookEvent>,
  providerEventId: string,
): Promise<void> {
  try {
    switch (event.kind) {
      case "message_received":
        logger.info(
          { chatId: event.chatId, sender: redactHandle(event.senderHandle), traceId: event.traceId },
          "processing inbound message",
        );
        await container.conversation.handleInboundMessage({
          chatId: event.chatId,
          senderHandle: event.senderHandle,
          messageId: event.messageId,
          text: event.text,
          isGroup: event.isGroup,
        });
        break;

      case "reaction":
        if (!event.chatId || !event.senderHandle) break;
        await container.conversation.handleInboundReaction({
          chatId: event.chatId,
          senderHandle: event.senderHandle,
          action: event.action,
          reactionType: event.reactionType,
          targetMessageId: event.targetMessageId,
        });
        break;

      case "message_status":
        logger.debug({ status: event.status, messageId: event.messageId }, "message status update");
        break;

      default:
        logger.debug({ eventType: event.eventType }, "ignored webhook event type");
    }
    await container.repos.webhookEvents.markProcessed(providerEventId);
  } catch (error) {
    logger.error({ error: String(error), providerEventId }, "webhook processing failed");
    await container.repos.webhookEvents.markFailed(
      providerEventId,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export { process as processWebhookEvent };
