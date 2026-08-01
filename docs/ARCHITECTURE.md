# Architecture

## Shape

```
   iMessage
      │
      ▼
   Linq Partner API V3
      │  webhook (signed, deduplicated)
      ▼
┌──────────────────────────────────────────────────────┐
│ routes/          thin HTTP handlers, no logic        │
├──────────────────────────────────────────────────────┤
│ application/     services: conversation, search,     │
│                  presentation, reaction, application,│
│                  renewal                             │
├──────────────────────────────────────────────────────┤
│ domain/          state machine, ranking, parsing,    │
│                  entities — pure, no I/O             │
├──────────────────────────────────────────────────────┤
│ integrations/    linq · housing · university · llm   │
│                  · contact  (all behind interfaces)  │
├──────────────────────────────────────────────────────┤
│ database/        drizzle schema + repositories       │
└──────────────────────────────────────────────────────┘
```

Dependencies point downward only. `domain/` imports nothing from
`application/` or `integrations/`, which is what makes the ranking and state
machine testable without a database or network.

## The three rules that shape everything

### 1. Deterministic core, LLM at the edges

The LLM may **only**: extract preferences from free text, resolve an unclear
university name, detect language, phrase a reply, and draft a landlord message.

It may **never**: compute a score, decide a state transition, decide that consent
exists, or cause an application to be sent. Those live in `domain/ranking.ts` and
`domain/conversation-state.ts` as ordinary code.

Every LLM output is parsed through a Zod schema before it is used
(`integrations/llm/llm-provider.ts`). The mock provider is a full implementation,
so the entire product works and is tested with `LLM_PROVIDER=mock`.

### 2. Nothing irreversible without an explicit, fresh confirmation

Contacting a landlord requires: complete contact details → a draft → opening the
review page → a `POST` carrying a confirmation token that is hashed at rest and
expires after 15 minutes. Editing the message invalidates any outstanding token.
Opening the page, tapping "Contact landlord", or saying "sounds good" are all
insufficient — `parseCommand` only accepts the exact word `SEND`.

If a listing has no automatic contact channel, the flow returns
`manual_required` with the original listing URL. It never reports a success that
did not happen.

### 3. At-least-once in, exactly-once out

Linq retries webhooks, so every event is claimed against a unique index on
`webhook_events.provider_event_id` before processing. Every outbound message
carries an idempotency key (`utils/ids.ts`) that is both persisted in
`outbound_messages` and passed to Linq as `message.idempotency_key`, so a retry
or a restart cannot double-send.

## Conversation state

17 states with an explicit adjacency list in `domain/conversation-state.ts`.
Invalid transitions are logged and ignored rather than thrown — an out-of-order
webhook must not wedge a conversation. State is persisted on every change, so it
survives restarts.

The path to `CONTACTING` is deliberately narrow: it is reachable only from
`AWAITING_CONTACT_CONFIRMATION`.

## Ranking

100 points, weighted: commute 30, budget 25, move-in 15, duration 10, size 10,
amenities 5, freshness 5. Hard filters run first (budget, availability, rooms,
mandatory amenities, excluded areas, commute ceiling, radius).

Sorting is fully deterministic — score, then rent, then listing id — so a demo
and a test produce identical output.

Scores produce structured `ScoreReason` objects (`{code, label}`) such as
`"550 SEK below your budget"`. The LLM may rephrase a label but cannot change the
underlying fact or the score.

## Reaction routing

Each apartment is sent as three separate messages (summary, media, rich link) and
every message id is stored in `listing_presentations`. The batch control message
id is stored separately on `listing_batches`. A tapback is resolved by looking up
its target message id, which is why an apartment reaction can never be confused
with a "show me three more" reaction.

Removing a reaction reverts a like or rejection to `unseen` — unless the listing
has already reached `contact_requested` or `contacted`, in which case it is
ignored. An application that has been sent is never undone by a tapback.

## Security

- **Action tokens** — HMAC-SHA256 over `{listingId, userId, batchId, exp, nonce}`.
  The browser never supplies a listing or user id; both come from the verified
  token.
- **Webhook verification** — Standard Webhooks scheme: HMAC-SHA256 over
  `{webhook-id}.{webhook-timestamp}.{body}`, constant-time comparison, 5-minute
  replay window, raw body read before any parsing.
- **PII** — `security/redaction.ts` is the only sanctioned way to log user data;
  pino is additionally configured to censor secret-shaped keys.
- **Untrusted content** — listing descriptions pass through `sanitiseUntrusted()`
  before reaching a prompt.

## Dependency injection

`application/container.ts` wires the graph and accepts overrides. Tests build a
container with an in-memory libSQL database and a `FakeLinq` that records what
would have been sent — no network, no credentials, no global state.
