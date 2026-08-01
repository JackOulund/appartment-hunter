# Qasa integration status

**Status: not active. The application uses `HOUSING_PROVIDER=mock`.**

`src/integrations/housing/qasa-housing-provider.ts` exists as an adapter boundary
only. Every method throws `provider_not_configured` and points here.

## Why it is not implemented

Qasa does not publish a partner API that this project is authorised to call. The
remaining ways to obtain their data are all off-limits:

| Approach | Why it is excluded |
| --- | --- |
| Scraping authenticated pages | Requires holding a user's credentials and acting as them |
| Driving a logged-in session headlessly | Same problem, plus it circumvents anti-bot protection |
| Bypassing rate limits or bot detection | Adversarial to the operator |
| Submitting applications as the user | Impersonation; the user cannot review what was sent |
| Fabricating a "contact sent" result | Reports success for something that never happened |

The provider deliberately fails loudly instead of degrading into any of these.

## What would unblock it

Any **one** of the following is sufficient:

1. **A partner/affiliate API agreement** — documented endpoints, an API key, and
   terms that permit programmatic search and (optionally) contact.
2. **A licensed data feed** — a periodic export the operator provides.
3. **A user-supplied dataset** — listings the user exports themselves and gives
   the agent explicitly. Read-only, no contact capability.
4. **An official OAuth integration** — the user authorises this app through
   Qasa's own consent screen, with scopes covering the actions taken.

## Implementing it once authorised

The interface to satisfy is in `src/integrations/housing/housing-provider.ts`:

```ts
search(input: HousingSearchInput): Promise<HousingSearchResult>
getListing(id: string): Promise<HousingListing | null>
getContactCapability(listing: HousingListing): Promise<HousingContactCapability>
contact?(input: HousingContactInput): Promise<HousingContactResult>
```

Steps:

1. Map Qasa's listing shape onto `HousingListing` (`src/domain/entities.ts`).
   Missing fields must be `null`, never invented — the ranking engine already
   scores data completeness and handles nulls.
2. Set `contactCapability` honestly per listing. If Qasa does not expose a
   programmatic contact route, return `manual_handoff` with the listing URL.
   Do **not** implement `contact()` at all rather than faking it.
3. Set `HOUSING_PROVIDER=qasa`. Nothing else in the app changes — the ranking,
   presentation and contact flows are provider-agnostic.
4. Treat all listing text as untrusted: it flows through
   `sanitiseUntrusted()` before reaching any LLM prompt.

## Until then

The `MockHousingProvider` ships 22 realistic listings across Lund, Malmö,
Stockholm, Uppsala and Gothenburg, deliberately including duplicates, expired
listings, over-budget listings, records with missing optional fields, and both
successful and failing simulated contact outcomes. Every demo and test path runs
against it.
