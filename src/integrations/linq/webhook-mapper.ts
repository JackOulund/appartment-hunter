import { z } from "zod";
import type { UnwrapWebhookEvent } from "@linqapp/sdk/resources/webhooks";

/**
 * Envelope shared by every Linq webhook. Validated with Zod because the payload
 * crosses a trust boundary — we never index into it unchecked.
 */
export const webhookEnvelopeSchema = z.object({
  api_version: z.string(),
  webhook_version: z.string().optional(),
  event_type: z.string(),
  event_id: z.string(),
  created_at: z.string(),
  trace_id: z.string().optional(),
  partner_id: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
});
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

const handleSchema = z.object({
  handle: z.string(),
  id: z.string().optional(),
  is_me: z.boolean().nullish(),
  service: z.string().optional(),
});

const textPartSchema = z.object({ type: z.literal("text"), value: z.string() });
const otherPartSchema = z.object({ type: z.string() }).loose();
const partSchema = z.union([textPartSchema, otherPartSchema]);

const messageReceivedDataSchema = z.object({
  id: z.string(),
  direction: z.string().optional(),
  chat: z.object({ id: z.string(), is_group: z.boolean().optional() }),
  sender_handle: handleSchema,
  parts: z.array(partSchema).default([]),
  service: z.string().optional(),
});

const reactionDataSchema = z.object({
  reaction_type: z.string(),
  is_from_me: z.boolean(),
  chat_id: z.string().optional(),
  message_id: z.string().optional(),
  from: z.string().optional(),
  from_handle: handleSchema.optional(),
});

const messageStatusDataSchema = z.object({
  id: z.string().optional(),
  chat: z.object({ id: z.string() }).optional(),
  chat_id: z.string().optional(),
});

/** Normalised events the application layer understands. */
export type InboundEvent =
  | {
      kind: "message_received";
      eventId: string;
      chatId: string;
      messageId: string;
      senderHandle: string;
      isGroup: boolean;
      text: string;
      traceId?: string;
    }
  | {
      kind: "reaction";
      eventId: string;
      action: "added" | "removed";
      /** `like` is thumbs-up, `dislike` is thumbs-down in Linq's vocabulary. */
      reactionType: string;
      chatId: string | null;
      targetMessageId: string | null;
      senderHandle: string | null;
      traceId?: string;
    }
  | {
      kind: "message_status";
      eventId: string;
      status: "sent" | "delivered" | "read" | "failed";
      chatId: string | null;
      messageId: string | null;
      traceId?: string;
    }
  | { kind: "ignored"; eventId: string; eventType: string };

export function extractText(parts: { type: string; value?: unknown }[]): string {
  return parts
    .filter((part): part is { type: "text"; value: string } =>
      part.type === "text" && typeof part.value === "string",
    )
    .map((part) => part.value)
    .join(" ")
    .trim();
}

/**
 * Maps a verified Linq envelope onto our internal event union. Unknown event
 * types are explicitly ignored rather than throwing — Linq may add types later.
 */
export function mapWebhookEvent(envelope: WebhookEnvelope): InboundEvent {
  const { event_type: type, event_id: eventId, trace_id: traceId } = envelope;

  if (type === "message.received") {
    const parsed = messageReceivedDataSchema.safeParse(envelope.data);
    if (!parsed.success) return { kind: "ignored", eventId, eventType: type };
    const data = parsed.data;
    // Guard against echoes of our own outbound messages.
    if (data.sender_handle.is_me === true || data.direction === "outbound") {
      return { kind: "ignored", eventId, eventType: type };
    }
    return {
      kind: "message_received",
      eventId,
      chatId: data.chat.id,
      messageId: data.id,
      senderHandle: data.sender_handle.handle,
      isGroup: data.chat.is_group ?? false,
      text: extractText(data.parts),
      ...(traceId ? { traceId } : {}),
    };
  }

  if (type === "reaction.added" || type === "reaction.removed") {
    const parsed = reactionDataSchema.safeParse(envelope.data);
    if (!parsed.success) return { kind: "ignored", eventId, eventType: type };
    const data = parsed.data;
    if (data.is_from_me) return { kind: "ignored", eventId, eventType: type };
    return {
      kind: "reaction",
      eventId,
      action: type === "reaction.added" ? "added" : "removed",
      reactionType: data.reaction_type,
      chatId: data.chat_id ?? null,
      targetMessageId: data.message_id ?? null,
      senderHandle: data.from_handle?.handle ?? data.from ?? null,
      ...(traceId ? { traceId } : {}),
    };
  }

  const statusMap: Record<string, "sent" | "delivered" | "read" | "failed"> = {
    "message.sent": "sent",
    "message.delivered": "delivered",
    "message.read": "read",
    "message.failed": "failed",
  };
  const status = statusMap[type];
  if (status) {
    const parsed = messageStatusDataSchema.safeParse(envelope.data);
    const data = parsed.success ? parsed.data : {};
    return {
      kind: "message_status",
      eventId,
      status,
      chatId: data.chat?.id ?? data.chat_id ?? null,
      messageId: data.id ?? null,
      ...(traceId ? { traceId } : {}),
    };
  }

  return { kind: "ignored", eventId, eventType: type };
}

/** Positive tapbacks that mean "yes" for our purposes. */
export const POSITIVE_REACTIONS = new Set(["like", "love"]);
/** Negative tapbacks that mean "no". */
export const NEGATIVE_REACTIONS = new Set(["dislike"]);

export function reactionPolarity(reactionType: string): "positive" | "negative" | "neutral" {
  if (POSITIVE_REACTIONS.has(reactionType)) return "positive";
  if (NEGATIVE_REACTIONS.has(reactionType)) return "negative";
  return "neutral";
}

/** Narrowing helper for the SDK's non-discriminated union. */
export function envelopeFromSdkEvent(event: UnwrapWebhookEvent): WebhookEnvelope {
  return webhookEnvelopeSchema.parse(event);
}
