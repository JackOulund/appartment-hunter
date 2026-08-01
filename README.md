# appartment-hunter

An iMessage housing agent for students who have just been accepted to a
university. The student texts *"I got accepted to Lund University"* and the agent
collects a few preferences, searches, ranks, and sends the three best apartments
as individual iMessages with photos and tappable cards. 👍 / 👎 shortlists or
rejects; the full apartment page opens in the browser; contacting a landlord
always requires an explicit confirmation.

Runs live over real iMessage via Linq. Landlord contact stays simulated
(`CONTACT_DRY_RUN=true`) so no real landlord is ever messaged during a demo.

```
iMessage → Linq → webhook → Hono → rank → Linq → iMessage
                              ↓
                        mobile listing page
```

## Stack

TypeScript (strict) · Hono · Node 20+ · Linq Partner API V3 (`@linqapp/sdk`) ·
Zod · Drizzle ORM · libSQL/SQLite · Vitest · Hono JSX (server-rendered) · pino

## Quick start

```sh
npm install
cp .env.example .env      # then fill in the Linq + Anthropic values
npm run db:migrate
npm run db:seed
npm run dev
```

Then expose it and register the webhook — see **Going live** below.

## Going live

Linq needs a public HTTPS URL; `localhost` cannot be registered.

```sh
brew install cloudflared

npm run dev                                          # terminal 1
cloudflared tunnel --url http://localhost:3000       # terminal 2 → prints an https URL
npm run linq:webhook:register -- <that-url>          # terminal 3
```

The register script appends `/webhooks/linq`, pins the payload version, and writes
`LINQ_WEBHOOK_SECRET`, `BASE_URL` and `LINQ_DRY_RUN=false` into `.env` — the secret
is written directly rather than printed, since Linq returns it only once.

Restart the server, then text your Linq number from any iPhone:

> I got accepted to Lund University

Answer each question as it arrives, send `SEARCH`, and three apartments come back
as separate messages. Tapback 👍/👎 on any of them; tap a link card to open the
apartment page.

Because a quick tunnel changes hostname on every restart, stale subscriptions
accumulate:

```sh
npm run linq:webhook:list                # flags any whose path is "/"
npm run linq:webhook:delete -- <id>
```

## Environment

Copy `.env.example`. Every value has a working default except real credentials.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` disables all `/dev/*` routes |
| `PORT` / `BASE_URL` | `3000` / `http://localhost:3000` | `BASE_URL` is embedded in listing links |
| `DATABASE_URL` | `file:./data/housing-agent.db` | any libSQL URL |
| `LINQ_API_KEY` | — | also accepts `LINQ_API_V3_API_KEY` (the SDK's own name) |
| `LINQ_FROM_NUMBER` | — | E.164, a number provisioned to your Linq account |
| `LINQ_WEBHOOK_SECRET` | — | `whsec_…`, from webhook registration |
| `LINQ_WEBHOOK_VERSION` | `2026-02-03` | pinned on the subscription URL |
| `LINQ_DRY_RUN` | `true` | `false` requires the three values above |
| `HOUSING_PROVIDER` | `mock` | `qasa` is a boundary only — see below |
| `CONTACT_DRY_RUN` | `true` | `false` contacts real landlords |
| `LLM_PROVIDER` | `mock` | `anthropic` uses Claude for extraction and drafting |
| `ACTION_TOKEN_SECRET` | dev value | **must** be changed in production |
| `INTERNAL_JOB_SECRET` | dev value | bearer token for the renewal job route |
| `RENEWAL_LEAD_DAYS` | `30` | how early to start the next search |
| `LOG_LEVEL` | `info` | `silent` in tests |

Configuration is validated with Zod at startup — a bad value fails the boot, not
the first request.

## Connecting real Linq

Local webhooks need a public HTTPS URL; Linq rejects plain `localhost` and never
follows redirects.

```sh
brew install cloudflared
cloudflared tunnel --url http://localhost:3000    # prints an https URL
```

Then:

```sh
# 1. set LINQ_API_KEY and LINQ_FROM_NUMBER in .env
npm run linq:webhook:register -- https://<your-tunnel>/webhooks/linq

# 2. copy the signing secret from the Linq dashboard into LINQ_WEBHOOK_SECRET
# 3. set LINQ_DRY_RUN=false and restart
npm run dev
```

The register script subscribes to `message.received`, `message.sent`,
`message.delivered`, `message.read`, `message.failed`, `reaction.added` and
`reaction.removed`, and prints the subscription id, target URL, event list and
pinned version. It deliberately does **not** print the signing secret.

Note: messages are sent from the number provisioned to your Linq account, never
from the student's own phone number.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | watch mode |
| `npm run build` | compile to `dist/` (also copies migrations) |
| `npm start` | run the compiled build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run db:generate` | regenerate migrations from the schema |
| `npm run db:migrate` | apply migrations |
| `npm run db:seed` | load the mock listing catalogue |
| `npm run linq:webhook:register -- <url>` | create the webhook subscription |
| `npm run linq:webhook:list` | list subscriptions, flagging broken ones |
| `npm run linq:webhook:delete -- <id>` | remove a stale subscription |
| `npm run linq:test-card -- <+E.164>` | send one real app card to check it renders |
| `npm run job:renewal` | run the renewal check once |

## Routes

| Route | Purpose |
| --- | --- |
| `GET /health`, `GET /ready` | liveness; readiness includes the database |
| `POST /webhooks/linq` | verified, deduplicated Linq events |
| `GET /l/:token` | inspect view, opened by the app card (signed token) |
| `POST /l/:token/event` | beacon target: what the user did in the inspect view |
| `POST /l/:token/reject`, `POST /api/listings/:id/reject` | idempotent rejection |
| `GET /l/:token/contact`, `POST /api/listings/:id/contact` | start an application draft |
| `GET /applications/:id/review` | review, edit, confirm or cancel |
| `POST /applications/:id/{update,confirm,cancel}` | the confirmation flow |
| `POST /internal/jobs/renewal-check` | `Authorization: Bearer $INTERNAL_JOB_SECRET` |

## Tests

```sh
npm test     # 161 tests
```

Covering: university extraction and campus ambiguity, preference parsing in
English and Swedish, state-machine transitions including rejected ones, hard
filters, ranking determinism, deduplication, exclusion of previously seen
listings, exactly-three selection, reaction-to-listing mapping, batch-control
reactions, reaction removal, webhook signature verification and deduplication,
expired and forged action tokens, reject idempotency, confirmation expiry,
duplicate-send prevention, dry-run contact behaviour, renewal date calculation
and privacy deletion.

No test requires Linq, Qasa, landlord or LLM credentials.

## Deployment notes

- `npm run build` then `npm start`. The build copies `.sql` migrations into
  `dist`; the server applies them at boot.
- Set a real `ACTION_TOKEN_SECRET`; the app refuses to start in production with
  the development default.
- Drive `POST /internal/jobs/renewal-check` from a real scheduler (cron,
  Cloud Scheduler, a queue). Do not rely on an in-process timer.
- SQLite is fine for a demo. The repository interfaces in
  `src/database/repositories/` are the seam for moving to Postgres.

## Production checklist

- [ ] `ACTION_TOKEN_SECRET` and `INTERNAL_JOB_SECRET` set to real random values
- [ ] `LINQ_WEBHOOK_SECRET` set; confirm unsigned webhooks are rejected
- [ ] `NODE_ENV=production`
- [ ] `LINQ_DRY_RUN=false` and `CONTACT_DRY_RUN=false` only when intended
- [ ] Rate limiting moved to a shared store if running more than one instance
- [ ] Opt-out handling (STOP/UNSUBSCRIBE) implemented — **not in this MVP**
- [ ] Postgres instead of SQLite
- [ ] Log retention reviewed; confirm no PII in aggregated logs

## Security and privacy

- Signed, expiring action tokens; the browser never supplies a listing or user id
- Webhook signature verification with a 5-minute replay window and constant-time
  comparison, on the raw body
- Event deduplication and outbound idempotency keys
- Phone numbers, emails and message bodies are redacted in logs
- Listing text is treated as untrusted and sanitised before reaching any prompt
- `delete my data` requires a YES confirmation, then anonymises the profile,
  clears decisions and stops future reminders
- The agent never asks for a personal identity number, passport, or bank details

## Limitations

- **Group chats** are not specialised — the agent replies as it would one-to-one,
  and typing indicators are one-to-one only in iMessage.
- **Opt-out keywords** (STOP/UNSUBSCRIBE) are not implemented.
- **Rate limiting** is in-memory, so it is per-process.
- **`MORE` after exhausting the catalogue** returns a "nothing left" message
  rather than widening the search automatically.
- **The renewal job** sends a reminder only; it never starts a search or an
  application by itself.
- **Qasa is not integrated** — see `docs/QASA_INTEGRATION.md`.
- **This is not a native Messages Extension** — see
  `docs/NATIVE_IMESSAGE_EXTENSION.md`.

## Further reading

- `docs/ARCHITECTURE.md` — layering, the LLM boundary, ranking, reaction routing
- `docs/QASA_INTEGRATION.md` — what would unblock a real Qasa provider
- `docs/NATIVE_IMESSAGE_EXTENSION.md` — how an Apple extension would reuse this backend
- `IMPLEMENTATION_STATUS.md` — what is built and what is not
