# Qasa discovery integration

## Status

The `qasa` housing provider is active when `HOUSING_PROVIDER=qasa`. It uses
Anthropic's server-side web search with `allowed_domains: ["qasa.com"]`, then
normalises the grounded result into the existing `HousingListing` model. The
normal TypeScript hard filters, ranking, persistence and Linq presentation run
unchanged after discovery.

This is a small-volume demo integration, not a Qasa partner feed. A production
deployment should replace the search client with an authorised Qasa API or
licensed feed while keeping the same `HousingProvider` interface.

## What happens on SEARCH

1. The conversation service has already collected and confirmed the student's
   preferences.
2. `QasaHousingProvider` asks Claude to search for a bounded number of current
   listings, with the web tool restricted to `qasa.com`.
3. Claude returns structured data through a Zod-backed output schema.
4. The provider accepts only HTTPS Qasa `/home/<numeric-id>` URLs, positive
   rents, non-negative room/size values, valid dates and active listings.
5. Landlord names, contact information and profile text are never requested or
   stored. Missing optional facts remain `null`.
6. Listings are persisted under the Qasa listing id, filtered and ranked by the
   existing deterministic domain code.
7. Linq sends the three best results. Contact is always a `manual_handoff` back
   to the original Qasa listing.

There is no Qasa login, browser automation, private endpoint discovery,
sequential-id enumeration, or automated landlord outreach.

## Configuration

```env
HOUSING_PROVIDER=qasa
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-haiku-4-5
QASA_SEARCH_MAX_USES=5
QASA_SEARCH_LIMIT=12
QASA_SEARCH_TIMEOUT_MS=45000
```

`LLM_API_KEY` is accepted as an alias for `ANTHROPIC_API_KEY`. `CLAUDE_MODEL`
falls back to `LLM_MODEL` when omitted. The application refuses to start with
the Qasa provider and no Anthropic key.

`QASA_SEARCH_MAX_USES` limits searches within one Claude request, and
`QASA_SEARCH_LIMIT` caps structured candidates at 20. `MORE` performs another
current search; database decisions prevent already presented listings from
being sent again.

The Anthropic organisation must have web search enabled. If it is disabled, or
Qasa results are unavailable, the search fails with a controlled
`provider_unavailable` error rather than fabricating listings.

## Local test

```sh
npm install
cp .env.example .env
# Set HOUSING_PROVIDER=qasa and ANTHROPIC_API_KEY in .env
npm run db:migrate
npm run dev
```

Keep `LINQ_DRY_RUN=true` to inspect intended messages without sending anything.
Complete onboarding in iMessage and send `SEARCH`. Do not run
`npm run db:seed` for the Qasa flow; that command is only for explicit
mock-provider development.

Automated tests inject a fake Qasa search client. They assert the domain
allow-list, normalisation, validation, deduplication and manual handoff without
making network requests to Anthropic, Qasa or Linq.

## Limitations

- Search-index coverage can be incomplete or stale; a result is not a guarantee
  that the home remains available.
- Only listings with enough data for the existing ranking model (title/address,
  city and a positive rent) are accepted.
- Coordinates are not inferred, so commute scoring uses its neutral fallback
  when Qasa search results do not expose coordinates.
- The production path remains an authorised partner API/feed.
