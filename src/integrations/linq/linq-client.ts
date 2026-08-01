import LinqAPIV3 from "@linqapp/sdk";
import type { MessageContent } from "@linqapp/sdk/resources/chats/chats";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { previewText, redactHandle } from "../../security/redaction.js";
import type { OutboundMessageRepository } from "../../database/repositories/index.js";

type MessageParts = NonNullable<MessageContent["parts"]>;

export interface SendResult {
  messageId: string;
  dryRun: boolean;
  /** True when an earlier identical send already happened. */
  deduplicated: boolean;
}

export interface TextMessage {
  chatId: string;
  text: string;
  idempotencyKey: string;
  conversationId?: string;
  /** iMessage screen/bubble effect. See MessageEffect in messages.d.ts. */
  effect?: { name: string; type: "screen" | "bubble" };
}

export interface MediaMessage {
  chatId: string;
  imageUrl: string;
  caption?: string;
  idempotencyKey: string;
  conversationId?: string;
}

export interface RichLinkMessage {
  chatId: string;
  url: string;
  idempotencyKey: string;
  conversationId?: string;
}

export interface ActionCardMessage {
  /** Only for logging and persistence — the send itself is handle-targeted. */
  chatId: string;
  toHandle: string;
  url: string;
  title: string;
  subtitle?: string;
  button?: string;
  idempotencyKey: string;
  conversationId?: string;
}

export interface ContactCardInput {
  firstName: string;
  phoneNumber: string;
  imageUrl?: string;
  lastName?: string;
}

export interface ContactCardResult {
  dryRun: boolean;
  isActive: boolean;
}

export interface LinqAdapter {
  createConversation(input: { to: string[]; firstMessage: string }): Promise<{ chatId: string }>;
  sendText(message: TextMessage): Promise<SendResult>;
  sendMedia(message: MediaMessage): Promise<SendResult>;
  sendRichLink(message: RichLinkMessage): Promise<SendResult>;
  sendActionCard(message: ActionCardMessage): Promise<SendResult>;
  setContactCard(input: ContactCardInput): Promise<ContactCardResult>;
  shareContactCard(chatId: string): Promise<void>;
  startTyping(chatId: string): Promise<void>;
  stopTyping(chatId: string): Promise<void>;
  getChat(chatId: string): Promise<{ id: string; isGroup: boolean } | null>;
  checkCapabilities(handle: string): Promise<{ imessage: boolean }>;
}

/** SDK errors that are pointless to retry. */
function isTerminalStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 422;
}

function normaliseLinqError(error: unknown, operation: string): AppError {
  const status = (error as { status?: number })?.status;
  const traceId = (error as { headers?: Record<string, string> })?.headers?.["x-trace-id"];
  if (isTerminalStatus(status)) {
    return new AppError("upstream_failed", `Linq ${operation} rejected the request.`, {
      status: 502,
      retryable: false,
      details: { linqStatus: status, traceId },
      cause: error,
    });
  }
  return new AppError("provider_unavailable", `Linq ${operation} failed.`, {
    retryable: true,
    details: { linqStatus: status, traceId },
    cause: error,
  });
}

async function withRetry<T>(operation: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const normalised = normaliseLinqError(error, operation);
      lastError = normalised;
      if (!normalised.retryable || attempt === attempts) throw normalised;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

export interface LinqAdapterOptions {
  outbound: OutboundMessageRepository;
  dryRun?: boolean;
  apiKey?: string;
  webhookSecret?: string;
  fromNumber?: string;
}

/**
 * The single boundary around @linqapp/sdk. In dry-run mode nothing leaves the
 * process; intended messages are still persisted so the demo and tests can
 * assert on exactly what would have been sent.
 */
export class LinqClient implements LinqAdapter {
  private readonly sdk: LinqAPIV3 | null;
  private readonly outbound: OutboundMessageRepository;
  private readonly dryRun: boolean;
  private readonly fromNumber: string;

  constructor(options: LinqAdapterOptions) {
    this.outbound = options.outbound;
    this.dryRun = options.dryRun ?? env.LINQ_DRY_RUN;
    this.fromNumber = options.fromNumber ?? env.LINQ_FROM_NUMBER;

    const apiKey = options.apiKey ?? env.linqApiKey;
    this.sdk = this.dryRun || !apiKey
      ? null
      : new LinqAPIV3({ apiKey, webhookSecret: options.webhookSecret ?? env.LINQ_WEBHOOK_SECRET });
  }

  private async dedupe(
    idempotencyKey: string,
    kind: string,
    chatId: string,
    preview: string,
    conversationId: string | undefined,
    send: () => Promise<string>,
    extra?: Record<string, unknown>,
  ): Promise<SendResult> {
    const existing = await this.outbound.findByKey(idempotencyKey);
    if (existing?.linqMessageId) {
      logger.debug({ idempotencyKey, kind }, "outbound message already sent, skipping");
      return { messageId: existing.linqMessageId, dryRun: existing.dryRun, deduplicated: true };
    }

    const messageId = await send();
    await this.outbound.record({
      idempotencyKey,
      conversationId: conversationId ?? null,
      linqChatId: chatId,
      kind,
      payloadPreview: preview,
      linqMessageId: messageId,
      dryRun: this.dryRun,
    });

    logger.info(
      { kind, chatId, dryRun: this.dryRun, preview, ...extra },
      this.dryRun ? "dry-run: message not sent" : "message sent",
    );
    return { messageId, dryRun: this.dryRun, deduplicated: false };
  }

  private requireSdk(): LinqAPIV3 {
    if (!this.sdk) {
      throw new AppError("provider_not_configured", "Linq client is in dry-run mode or missing an API key.");
    }
    return this.sdk;
  }

  async createConversation(input: { to: string[]; firstMessage: string }): Promise<{ chatId: string }> {
    if (this.dryRun) {
      logger.info(
        { to: input.to.map(redactHandle), preview: previewText(input.firstMessage) },
        "dry-run: conversation not created",
      );
      return { chatId: `dry-chat-${input.to.join("-")}` };
    }
    const response = await withRetry("chats.create", () =>
      this.requireSdk().chats.create({
        from: this.fromNumber,
        to: input.to,
        message: { parts: [{ type: "text", value: input.firstMessage }] },
      }),
    );
    return { chatId: response.chat.id };
  }

  async sendText(message: TextMessage): Promise<SendResult> {
    return this.dedupe(
      message.idempotencyKey,
      "text",
      message.chatId,
      previewText(message.text),
      message.conversationId,
      async () => {
        if (this.dryRun) return `dry-${message.idempotencyKey}`;
        const response = await withRetry("chats.messages.send", () =>
          this.requireSdk().chats.messages.send(message.chatId, {
            message: {
              idempotency_key: message.idempotencyKey,
              parts: [{ type: "text", value: message.text }],
              ...(message.effect ? { effect: message.effect } : {}),
            },
          }),
        );
        return extractMessageId(response, message.idempotencyKey);
      },
      message.effect ? { effect: message.effect } : undefined,
    );
  }

  async sendMedia(message: MediaMessage): Promise<SendResult> {
    return this.dedupe(
      message.idempotencyKey,
      "media",
      message.chatId,
      previewText(message.caption ?? message.imageUrl),
      message.conversationId,
      async () => {
        if (this.dryRun) return `dry-${message.idempotencyKey}`;
        const parts: MessageParts = message.caption
          ? [{ type: "text", value: message.caption }, { type: "media", url: message.imageUrl }]
          : [{ type: "media", url: message.imageUrl }];
        const response = await withRetry("chats.messages.send", () =>
          this.requireSdk().chats.messages.send(message.chatId, {
            message: { idempotency_key: message.idempotencyKey, parts },
          }),
        );
        return extractMessageId(response, message.idempotencyKey);
      },
    );
  }

  /**
   * A rich link must be the only part in its message — combining it with text or
   * media suppresses the preview card in iMessage.
   */
  async sendRichLink(message: RichLinkMessage): Promise<SendResult> {
    return this.dedupe(
      message.idempotencyKey,
      "rich_link",
      message.chatId,
      message.url,
      message.conversationId,
      async () => {
        if (this.dryRun) return `dry-${message.idempotencyKey}`;
        const response = await withRetry("chats.messages.send", () =>
          this.requireSdk().chats.messages.send(message.chatId, {
            // LinkPart carries the URL in `value`, and must be the only part.
            message: {
              idempotency_key: message.idempotencyKey,
              parts: [{ type: "link", value: message.url }],
            },
          }),
        );
        return extractMessageId(response, message.idempotencyKey);
      },
    );
  }

  /**
   * An app card — the "just-in-time UI" experience. Tapping it opens `url` inside
   * Linq's iMessage app, which is what makes the inspect view feel like part of
   * the conversation rather than a link out to Safari.
   *
   * Two rules come from the platform, not from us:
   * 1. Actions are handle-targeted. They go to POST /v3/messages; the chat-scoped
   *    send endpoint rejects them outright.
   * 2. A brand-new chat cannot open with an action. Every card here is sent into
   *    a conversation the user started, so a chat always exists by this point.
   */
  async sendActionCard(message: ActionCardMessage): Promise<SendResult> {
    return this.dedupe(
      message.idempotencyKey,
      "action_card",
      message.chatId,
      `${message.title} → ${message.url}`,
      message.conversationId,
      async () => {
        if (this.dryRun) return `dry-${message.idempotencyKey}`;
        const content = buildLinkCardContent(message);
        const response = await withRetry("messages.create", () =>
          this.requireSdk().messages.create({
            to: [message.toHandle],
            message: content,
            "Idempotency-Key": message.idempotencyKey,
          }),
        );

        // A handle-targeted send resolves its own chat, and can fail over to a
        // fresh line if the current one is flagged. That would put the card in a
        // different thread from the rest of the batch, so it is worth seeing.
        if (response.chat_id !== message.chatId) {
          logger.warn(
            { expected: message.chatId, resolved: response.chat_id, createdNewChat: response.created_new_chat },
            "app card landed in a different chat than the conversation",
          );
        }
        return extractMessageId(response, message.idempotencyKey);
      },
    );
  }

  async startTyping(chatId: string): Promise<void> {
    if (this.dryRun) return;
    try {
      await this.requireSdk().chats.typing.start(chatId);
    } catch (error) {
      // A missing typing indicator must never break the reply.
      logger.debug({ chatId, error: String(error) }, "typing indicator failed");
    }
  }

  async stopTyping(chatId: string): Promise<void> {
    if (this.dryRun) return;
    try {
      await this.requireSdk().chats.typing.stop(chatId);
    } catch (error) {
      logger.debug({ chatId, error: String(error) }, "typing stop failed");
    }
  }

  async getChat(chatId: string): Promise<{ id: string; isGroup: boolean } | null> {
    if (this.dryRun) return { id: chatId, isGroup: false };
    const chat = await withRetry("chats.retrieve", () => this.requireSdk().chats.retrieve(chatId));
    const typed = chat as { id?: string; is_group?: boolean };
    return typed.id ? { id: typed.id, isGroup: Boolean(typed.is_group) } : null;
  }

  async checkCapabilities(handle: string): Promise<{ imessage: boolean }> {
    if (this.dryRun) return { imessage: true };
    try {
      const result = await this.requireSdk().capability.checkIMessage({
        address: handle,
        from: this.fromNumber,
      });
      return { imessage: result.available };
    } catch (error) {
      logger.debug({ error: String(error) }, "capability check failed, assuming iMessage");
      return { imessage: true };
    }
  }

  /**
   * Sets (creates or replaces) the contact card shown for our line in iMessage
   * Name and Photo Sharing. This is one-time setup, not a per-message send, so it
   * intentionally bypasses the outbound-dedupe machinery used by the sends above.
   */
  async setContactCard(input: ContactCardInput): Promise<ContactCardResult> {
    if (this.dryRun) {
      logger.info(
        {
          firstName: input.firstName,
          lastName: input.lastName,
          phoneNumber: redactHandle(input.phoneNumber),
          hasImage: Boolean(input.imageUrl),
        },
        "dry-run: contact card not set",
      );
      return { dryRun: true, isActive: false };
    }

    const response = await withRetry("contactCard.create", () =>
      this.requireSdk().contactCard.create({
        first_name: input.firstName,
        phone_number: input.phoneNumber,
        ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
        ...(input.lastName ? { last_name: input.lastName } : {}),
      }),
    );
    return { dryRun: false, isActive: response.is_active };
  }

  /**
   * Shares our contact card (Name and Photo Sharing) into a chat, so the
   * recipient sees the "shared their name and photo" banner. Unlike
   * startTyping/stopTyping this does not swallow its own errors — a failure
   * here (most often: no contact card configured yet) is one-time-per-
   * conversation and worth a real log line, so it is normalised and thrown
   * for the caller (ConversationService) to catch and decide on.
   */
  async shareContactCard(chatId: string): Promise<void> {
    if (this.dryRun) {
      logger.info({ chatId }, "dry-run: contact card not shared");
      return;
    }
    await withRetry("chats.shareContactCard", () => this.requireSdk().chats.shareContactCard(chatId));
  }
}

/**
 * `message.action` invokes an experience inside Linq's iMessage app.
 *
 * The field is real but untyped: the SDK's own `MessageContent` docstring says a
 * message carries "EITHER `parts` … or a single `action`", and @linqapp/sdk 0.32.0
 * shipped "add action field to message content for app experiences" — yet the
 * generated interface never declares the property. The cast below is the whole
 * extent of that gap, and it is kept in one place so it disappears the moment the
 * SDK regenerates. Nothing here is guessed: the shape is the documented one.
 */
interface LinkCardContent {
  action: {
    experience: "link";
    action: "open";
    params: { url: string; title?: string; subtitle?: string; button?: string };
  };
}

function buildLinkCardContent(message: ActionCardMessage): MessageContent {
  const content: LinkCardContent = {
    action: {
      experience: "link",
      action: "open",
      params: {
        url: message.url,
        title: message.title,
        ...(message.subtitle ? { subtitle: message.subtitle } : {}),
        ...(message.button ? { button: message.button } : {}),
      },
    },
  };
  return content as unknown as MessageContent;
}

function extractMessageId(response: unknown, fallback: string): string {
  const typed = response as { id?: string; message?: { id?: string } };
  return typed.id ?? typed.message?.id ?? `unknown-${fallback}`;
}
