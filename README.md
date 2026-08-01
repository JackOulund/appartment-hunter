# appartment-hunter

An iMessage AI agent: Linq delivers inbound messages over a webhook, Claude writes
the reply, Linq sends it back.

```
iMessage ──► Linq ──webhook──► Hono ──► Claude ──► Linq ──► iMessage
```

## Layout

| File | Role |
| --- | --- |
| `src/index.ts` | Hono server, webhook signature verification, dedupe |
| `src/handler.ts` | Inbound-message logic (pure, dependency-injected — this is what the tests cover) |
| `src/agent.ts` | Claude call plus per-chat conversation history |
| `src/linq.ts` | Linq client |
| `scripts/subscribe.ts` | One-time webhook subscription setup |

## Setup

```sh
npm install
cp .env.example .env      # fill in LINQ_API_V3_API_KEY, ANTHROPIC_API_KEY, LINQ_FROM_NUMBER
npm run dev
```

Expose the port (`ngrok http 3000`, or whatever you use), then register the webhook —
it prints a `whsec_…` signing secret **once**, so copy it into `LINQ_WEBHOOK_SECRET`
and restart:

```sh
npm run subscribe https://your-tunnel.example.com/webhooks/linq
```

Text the Linq number and the agent replies.

## Sending the first message

Linq needs a chat to exist before you can send into it. To start one:

```ts
await linq.chats.create({
  from: process.env.LINQ_FROM_NUMBER!,
  to: ["+15556667777"],
  message: { parts: [{ type: "text", value: "Hi!" }] },
});
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Watch mode |
| `npm test` | Vitest |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compile to `dist/` |

## Before this goes to production

- **Conversation history and the dedupe set are in-memory.** Both are per-process —
  move them to Redis or Postgres before running more than one instance.
- **Opt-out handling.** Scan inbound text for STOP/UNSUBSCRIBE and suppress the number.
- **Group chats.** Typing indicators and read receipts are 1:1 only; the handler
  currently replies to every chat regardless of `chat.is_group`.
- **Rate limits and `phone_number.status_updated`.** Subscribe to that event to catch
  a number getting flagged.
