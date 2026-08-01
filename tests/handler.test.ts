import { describe, expect, it, vi } from "vitest";
import { extractText, handleInboundMessage } from "../src/handler.js";
import type { InboundMessage } from "../src/handler.js";

const inbound = (parts: InboundMessage["parts"]): InboundMessage => ({
  chatId: "chat-1",
  senderHandle: "+15556667777",
  parts,
});

describe("extractText", () => {
  it("concatenates text parts and ignores media", () => {
    const text = extractText([
      { type: "text", value: "Is the flat" },
      { type: "media", url: "https://cdn.example/photo.jpg" },
      { type: "text", value: "still available?" },
    ]);

    expect(text).toBe("Is the flat still available?");
  });

  it("returns an empty string when no text parts are present", () => {
    expect(extractText([{ type: "media", url: "https://cdn.example/a.jpg" }])).toBe("");
  });
});

describe("handleInboundMessage", () => {
  it("shows a typing indicator, asks the agent, and sends the reply", async () => {
    const deps = {
      agent: { reply: vi.fn().mockResolvedValue("Yes, still available.") },
      linq: {
        chats: {
          typing: { start: vi.fn().mockResolvedValue(undefined) },
          messages: { send: vi.fn().mockResolvedValue(undefined) },
        },
      },
    };

    await handleInboundMessage(deps, inbound([{ type: "text", value: "Available?" }]));

    expect(deps.linq.chats.typing.start).toHaveBeenCalledWith("chat-1");
    expect(deps.agent.reply).toHaveBeenCalledWith("chat-1", "Available?");
    expect(deps.linq.chats.messages.send).toHaveBeenCalledWith("chat-1", {
      message: { parts: [{ type: "text", value: "Yes, still available." }] },
    });
  });

  it("ignores messages with no text content", async () => {
    const deps = {
      agent: { reply: vi.fn() },
      linq: {
        chats: {
          typing: { start: vi.fn() },
          messages: { send: vi.fn() },
        },
      },
    };

    await handleInboundMessage(deps, inbound([{ type: "media", url: "https://cdn.example/a.jpg" }]));

    expect(deps.agent.reply).not.toHaveBeenCalled();
    expect(deps.linq.chats.messages.send).not.toHaveBeenCalled();
  });

  it("does not send an empty reply", async () => {
    const deps = {
      agent: { reply: vi.fn().mockResolvedValue("   ") },
      linq: {
        chats: {
          typing: { start: vi.fn().mockResolvedValue(undefined) },
          messages: { send: vi.fn() },
        },
      },
    };

    await handleInboundMessage(deps, inbound([{ type: "text", value: "hi" }]));

    expect(deps.linq.chats.messages.send).not.toHaveBeenCalled();
  });
});
