import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as schema from "../../src/database/schema.js";
import { createContainer, type Container } from "../../src/application/container.js";
import { MockHousingProvider } from "../../src/integrations/housing/mock-housing-provider.js";
import type { LlmProvider } from "../../src/integrations/llm/llm-provider.js";
import type {
  ActionCardMessage,
  ContactCardInput,
  ContactCardResult,
  LinqAdapter,
  MediaMessage,
  RichLinkMessage,
  SendResult,
  TextMessage,
} from "../../src/integrations/linq/linq-client.js";

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/database/migrations",
);

export interface SentMessage {
  kind: "text" | "media" | "rich_link" | "action_card";
  chatId: string;
  body: string;
  messageId: string;
  idempotencyKey: string;
  /** Handle-targeted sends only — app cards go to a handle, not a chat. */
  toHandle?: string;
  card?: { title: string; subtitle: string | undefined; button: string | undefined; url: string };
  effect?: { name: string; type: "screen" | "bubble" };
}

/** Records what would have been sent, and enforces idempotency like the real client. */
export class FakeLinq implements LinqAdapter {
  readonly sent: SentMessage[] = [];
  readonly typing: string[] = [];
  readonly contactCards: ContactCardInput[] = [];
  readonly sharedContactCardChats: string[] = [];
  /** Set to make the next shareContactCard call(s) reject, e.g. to simulate no card configured. */
  shareContactCardError: Error | null = null;
  private readonly byKey = new Map<string, string>();
  private counter = 0;

  private record(kind: SentMessage["kind"], chatId: string, body: string, key: string): SendResult {
    const existing = this.byKey.get(key);
    if (existing) return { messageId: existing, dryRun: true, deduplicated: true };

    this.counter += 1;
    const messageId = `msg-${this.counter}`;
    this.byKey.set(key, messageId);
    this.sent.push({ kind, chatId, body, messageId, idempotencyKey: key });
    return { messageId, dryRun: true, deduplicated: false };
  }

  async createConversation(input: { to: string[] }): Promise<{ chatId: string }> {
    return { chatId: `chat-${input.to.join("-")}` };
  }
  async sendText(m: TextMessage): Promise<SendResult> {
    const result = this.record("text", m.chatId, m.text, m.idempotencyKey);
    if (!result.deduplicated && m.effect) {
      const sent = this.sent.at(-1);
      if (sent) sent.effect = m.effect;
    }
    return result;
  }
  async sendMedia(m: MediaMessage): Promise<SendResult> {
    return this.record("media", m.chatId, m.imageUrl, m.idempotencyKey);
  }
  async sendRichLink(m: RichLinkMessage): Promise<SendResult> {
    return this.record("rich_link", m.chatId, m.url, m.idempotencyKey);
  }
  async sendActionCard(m: ActionCardMessage): Promise<SendResult> {
    const result = this.record("action_card", m.chatId, m.url, m.idempotencyKey);
    if (!result.deduplicated) {
      const sent = this.sent.at(-1);
      if (sent) {
        sent.toHandle = m.toHandle;
        sent.card = { title: m.title, subtitle: m.subtitle, button: m.button, url: m.url };
      }
    }
    return result;
  }
  async setContactCard(input: ContactCardInput): Promise<ContactCardResult> {
    this.contactCards.push(input);
    return { dryRun: true, isActive: true };
  }
  async shareContactCard(chatId: string): Promise<void> {
    if (this.shareContactCardError) throw this.shareContactCardError;
    this.sharedContactCardChats.push(chatId);
  }
  async startTyping(chatId: string): Promise<void> {
    this.typing.push(chatId);
  }
  async stopTyping(): Promise<void> {}
  async getChat(chatId: string) {
    return { id: chatId, isGroup: false };
  }
  async checkCapabilities() {
    return { imessage: true };
  }

  texts(): string[] {
    return this.sent.filter((m) => m.kind === "text").map((m) => m.body);
  }
  lastText(): string {
    return this.texts().at(-1) ?? "";
  }
  cards(): SentMessage[] {
    return this.sent.filter((m) => m.kind === "action_card");
  }
  listingSummaries(): SentMessage[] {
    return this.sent.filter((m) => m.kind === "text" && / of \d — /.test(m.body));
  }
  controlMessages(): SentMessage[] {
    return this.sent.filter(
      (m) => m.kind === "text" && /three more|tre till/i.test(m.body),
    );
  }
  reset(): void {
    this.sent.length = 0;
    this.byKey.clear();
    this.counter = 0;
  }
}

export interface Harness {
  container: Container;
  linq: FakeLinq;
  housing: MockHousingProvider;
  /** Sends an inbound text as the demo user. */
  say(text: string): Promise<void>;
  react(messageId: string, reactionType?: string, action?: "added" | "removed"): Promise<void>;
  state(): Promise<string>;
}

export const TEST_CHAT_ID = "test-chat";
export const TEST_HANDLE = "+46700000001";

export async function createHarness(
  options: { housing?: MockHousingProvider; llm?: LlmProvider } = {},
): Promise<Harness> {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });

  const linq = new FakeLinq();
  const housing = options.housing ?? new MockHousingProvider();
  const container = createContainer({ db, linq, housing, ...(options.llm ? { llm: options.llm } : {}) });

  let inbound = 0;

  return {
    container,
    linq,
    housing,
    async say(text: string) {
      inbound += 1;
      await container.conversation.handleInboundMessage({
        chatId: TEST_CHAT_ID,
        senderHandle: TEST_HANDLE,
        messageId: `in-${inbound}`,
        text,
      });
    },
    async react(messageId: string, reactionType = "like", action: "added" | "removed" = "added") {
      await container.conversation.handleInboundReaction({
        chatId: TEST_CHAT_ID,
        senderHandle: TEST_HANDLE,
        action,
        reactionType,
        targetMessageId: messageId,
      });
    },
    async state() {
      const conversation = await container.repos.conversations.findByChatId(TEST_CHAT_ID);
      return conversation?.currentState ?? "(none)";
    },
  };
}

/** Walks onboarding to the point where SEARCH is accepted. */
export async function completeOnboarding(harness: Harness): Promise<void> {
  await harness.say("I got accepted to Lund University");
  await harness.say("1"); // campus
  await harness.say("8000");
  await harness.say("20 August");
  await harness.say("6 months");
  await harness.say("25 minutes to campus");
  await harness.say("1 room");
  await harness.say("furnished");
}
