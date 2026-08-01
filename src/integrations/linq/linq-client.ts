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

export interface LinqAdapter {
  createConversation(input: { to: string[]; firstMessage: string }): Promise<{ chatId: string }>;
  sendText(message: TextMessage): Promise<SendResult>;
  sendMedia(message: MediaMessage): Promise<SendResult>;
  sendRichLink(message: RichLinkMessage): Promise<SendResult>;
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
      { kind, chatId, dryRun: this.dryRun, preview },
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
            },
          }),
        );
        return extractMessageId(response, message.idempotencyKey);
      },
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
}

function extractMessageId(response: unknown, fallback: string): string {
  const typed = response as { id?: string; message?: { id?: string } };
  return typed.id ?? typed.message?.id ?? `unknown-${fallback}`;
}
