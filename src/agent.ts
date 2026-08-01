import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import type { Agent } from "./handler.js";

const SYSTEM_PROMPT = `You are an apartment-hunting assistant talking to people over iMessage.

Keep replies short — one or two sentences, the way a person texts. No markdown,
no bullet lists, no headers. Ask one question at a time. If you don't know
something, say so plainly instead of guessing.`;

const MAX_TURNS = 20;

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/**
 * In-memory conversation history, keyed by Linq chat id. Fine for a single
 * process; swap for Redis or Postgres before running more than one instance.
 */
const histories = new Map<string, Anthropic.MessageParam[]>();

export const agent: Agent = {
  async reply(chatId, message) {
    const history = histories.get(chatId) ?? [];
    history.push({ role: "user", content: message });

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low" },
      messages: history,
    });

    if (response.stop_reason === "refusal") {
      histories.set(chatId, history.slice(-MAX_TURNS));
      return "Sorry, I can't help with that one.";
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    history.push({ role: "assistant", content: response.content });
    histories.set(chatId, history.slice(-MAX_TURNS));

    return text;
  },
};
