export type MessagePart = { type: "text"; value: string } | { type: string; [key: string]: unknown };

export interface InboundMessage {
  chatId: string;
  senderHandle: string;
  parts: MessagePart[];
}

export interface Agent {
  reply(chatId: string, message: string): Promise<string>;
}

export interface LinqSender {
  chats: {
    typing: { start(chatId: string): Promise<unknown> };
    messages: {
      send(chatId: string, body: { message: { parts: { type: "text"; value: string }[] } }): Promise<unknown>;
    };
  };
}

export interface HandlerDeps {
  agent: Agent;
  linq: LinqSender;
}

export function extractText(parts: MessagePart[]): string {
  return parts
    .filter((part): part is { type: "text"; value: string } => part.type === "text")
    .map((part) => part.value)
    .join(" ")
    .trim();
}

export async function handleInboundMessage(deps: HandlerDeps, message: InboundMessage): Promise<void> {
  const text = extractText(message.parts);
  if (!text) return;

  await deps.linq.chats.typing.start(message.chatId);

  const reply = await deps.agent.reply(message.chatId, text);
  if (!reply.trim()) return;

  await deps.linq.chats.messages.send(message.chatId, {
    message: { parts: [{ type: "text", value: reply.trim() }] },
  });
}
