# Implementation status

Last verified: all items below were run, not just written.
`npm run typecheck` clean · `npm test` 161 passing · `npm run build` succeeds ·
server boots and the full demo flow works end to end.

## Built and verified

### Foundation
- [x] Hono + strict TypeScript, Node 20+, npm (existing lockfile kept)
- [x] Zod-validated environment; invalid config fails at boot
- [x] Structured logging (pino) with PII redaction helpers
- [x] libSQL/SQLite via Drizzle; migrations applied at boot
- [x] `GET /health`, `GET /ready` (readiness probes the database)

### Domain
- [x] 17-state conversation machine with an explicit adjacency list
- [x] Invalid transitions logged and ignored, never thrown
- [x] State persisted — survives restarts
- [x] Deterministic 100-point ranking with the specified weights
- [x] Hard filters: budget, availability, move-in, duration, rooms, size,
      mandatory amenities, excluded areas, commute, radius
- [x] Structured score reasons (`{code, label}`)
- [x] Deduplication by address + rent, keeping the richer record
- [x] Deterministic command parser, English and Swedish

### Providers
- [x] `HousingProvider` interface + `MockHousingProvider` (22 listings, 5 cities)
- [x] Mock catalogue includes duplicates, expired, inactive, over-budget,
      missing-field, contact-success and contact-failure cases
- [x] `QasaHousingProvider` boundary that refuses to run — no invented endpoints
- [x] `UniversityProvider` + static dataset (10 universities, campuses, coords)
- [x] `LlmProvider` interface + full deterministic mock; all output Zod-validated
- [x] `HousingContactService` with capability-aware routing

### Linq
- [x] Single adapter; nothing else imports `@linqapp/sdk`
- [x] Verified against the real SDK types (`LinkPart.value`, `chats.create`
      returning `{chat}`, `capability.checkIMessage({address})`)
- [x] Native `message.idempotency_key` passed through, plus local dedupe
- [x] Dry-run mode persists intended messages instead of sending
- [x] Bounded retries; terminal errors (4xx) never retried
- [x] Standard Webhooks verification: raw body, HMAC-SHA256, constant-time,
      5-minute replay window
- [x] Event deduplication on `provider_event_id`
- [x] Reaction mapping using Linq's real vocabulary (`like` / `dislike`)

### Product flow
- [x] University recognition, campus disambiguation (never silently picked)
- [x] One question at a time; confirmation summary; single-field corrections
- [x] Search → three apartments, each as separate summary / media / app-card
      messages; the card is the whole message, as the platform requires
- [x] Inspect view delivered as a Linq app card (`message.action`, handle-targeted),
      falling back to a rich link if the card is refused
- [x] The page beacons back (`opened`, `gallery_viewed`, `reject_clicked`,
      `contact_clicked`, `closed`); one follow-up when an apartment was inspected
      but not decided, suppressed on repeats and mid-application
- [x] Message ids persisted per apartment; reactions routed correctly
- [x] Batch control message handled separately from apartment reactions
- [x] Reaction removal undoes a like or rejection, never a sent application
- [x] `MORE` never repeats a previously presented apartment
- [x] Text fallbacks: like/reject/more/stop/contact/change/pause/resume/help
- [x] Mobile listing page: gallery with scroll-snap, indicator, safe-area,
      fixed action bar, Open Graph tags, loading/expired/error states
- [x] Reject: token-validated, ownership-checked, idempotent
- [x] Contact: draft → review → edit → explicit confirm → send
- [x] Confirmation token hashed at rest, 15-minute expiry, invalidated on edit
- [x] Manual-handoff listings report `manual_required`, never a fake success
- [x] Rental tracking, renewal date = end − `RENEWAL_LEAD_DAYS`
- [x] Protected `POST /internal/jobs/renewal-check` + `npm run job:renewal`
- [x] `delete my data` with explicit confirmation and anonymisation

### LLM
- [x] `AnthropicLlmProvider` implemented against Claude (`claude-opus-5`)
- [x] Structured extraction via `messages.parse()` + `zodOutputFormat`
- [x] Every call falls back safely on error or refusal — a model hiccup
      cannot break a live conversation
- [x] Draft rewrite is rejected if it drops the applicant's own contact details
- [x] Verified live: "8.5k" → 8500, "half an hour by bike" → 30,
      "engineering faculty in Lund" → Lund University, no fabricated background

### Operations and docs
- [x] Webhook register script appends the required path, pins the version,
      and writes the signing secret to .env instead of printing it
- [x] `linq:webhook:list` / `:delete` for stale-subscription cleanup
- [x] All npm scripts
- [x] README, ARCHITECTURE, QASA_INTEGRATION, NATIVE_IMESSAGE_EXTENSION

## Bugs found and fixed while testing

| Bug | Fix |
| --- | --- |
| `moveTo` read stale in-memory state, so consecutive transitions were rejected and the contact flow stalled | re-read state from storage before each transition |
| `excludedListingIds` skipped `unseen` rows, so `MORE` could repeat apartments already on screen | exclude every listing with a decision row |
| Renewal job looked conversations up by handle instead of user id — no reminder ever sent | added `findByUserId` |
| `LeaseRepository.create` used `??` against an empty-string id, causing a PK collision | repository owns id generation |
| Campus re-ask rendered with an empty university name | look the name up before re-asking |
| Compiled build could not find `.sql` migrations | build copies them into `dist` |
| Webhook registered against `/` — every delivery 404'd | script appends `/webhooks/linq` and hard-fails on any other path |
| `LLM_PROVIDER=anthropic` was a silent no-op; the container always built the mock | implemented the provider and wired provider selection |

## Not built

- **Opt-out keywords** (STOP/UNSUBSCRIBE) — flagged in the README as a
  production prerequisite
- **Group-chat specialisation** — replies work, but there is no distinct
  group behaviour, and iMessage typing indicators are one-to-one only
- **Postgres** — repository interfaces are the seam; SQLite is what runs
- **Shared-store rate limiting** — the limiter is in-memory, per process
- **Real Qasa integration** — blocked on authorisation, see the doc
- **Native Messages Extension** — out of scope for this MVP by design
- **Local simulator** — the `/dev/*` routes and demo page were removed once the
  real iMessage path worked. Testing is now either the test suite or a real
  device; there is no offline UI.
