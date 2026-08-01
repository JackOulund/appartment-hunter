import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { agent } from "./agent.js";
import { config } from "./config.js";
import { handleInboundMessage, type MessagePart } from "./handler.js";
import { linq } from "./linq.js";
import type {
  MessageReceivedWebhookEvent,
  UnwrapWebhookEvent,
} from "@linqapp/sdk/resources/webhooks";

const app = new Hono();

/**
 * Every variant types `event_type` as the full enum rather than a literal, so
 * TypeScript can't discriminate the union on its own — narrow it explicitly.
 */
function isMessageReceived(event: UnwrapWebhookEvent): event is MessageReceivedWebhookEvent {
  return event.event_type === "message.received";
}

/** Linq delivers at-least-once — dedupe on `event_id`. Swap for Redis when you scale out. */
const seenEvents = new Set<string>();

app.get("/health", (c) => c.json({ ok: true }));

app.post("/webhooks/linq", async (c) => {
  // The signature covers the raw bytes — never parse and re-serialize before verifying.
  const rawBody = await c.req.text();

  let event;
  try {
    event = linq.webhooks.unwrap(rawBody, { headers: c.req.header() });
  } catch (error) {
    console.warn("rejected webhook with invalid signature", error);
    return c.text("invalid signature", 400);
  }

  if (seenEvents.has(event.event_id)) return c.body(null, 204);
  seenEvents.add(event.event_id);

  if (isMessageReceived(event) && !event.data.sender_handle.is_me) {
    // Return 2xx within Linq's 10s window; the agent call runs after we respond.
    void handleInboundMessage(
      { agent, linq },
      {
        chatId: event.data.chat.id,
        senderHandle: event.data.sender_handle.handle,
        parts: event.data.parts as MessagePart[],
      },
    ).catch((error) => console.error("failed to handle inbound message", error));
  }

  return c.body(null, 204);
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`listening on http://localhost:${info.port}`);
});
