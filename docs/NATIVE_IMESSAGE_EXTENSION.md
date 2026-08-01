# Native iMessage extension — future work

**This MVP is not a native Apple Messages Extension, and does not claim to be.**

## What this project actually uses

Everything here runs over the Linq Partner API V3 as standard messaging:

| Capability | How it is delivered |
| --- | --- |
| Text conversation | `chats.messages.send` with a `text` part |
| Apartment photos | A `media` part carrying the hero image |
| Tappable apartment card | A `link` part; iMessage renders it from Open Graph tags |
| 👍 / 👎 | Native tapbacks, received as `reaction.added` / `reaction.removed` |
| Typing indicator | `chats.typing.start` / `.stop` (one-to-one chats only) |
| Delivery / read state | `message.delivered` / `message.read` webhooks, where the protocol supports them |
| Full apartment view | A mobile web page opened from the rich link |

The mobile page at `/l/:token` is styled to feel native on iPhone — safe-area
padding, scroll-snap gallery, iOS system font, a fixed bottom action bar — but it
is a web page in Safari, not an in-conversation app.

## What a real Messages Extension would add

An `MSMessagesAppViewController` renders **inside** the conversation transcript.
That would allow:

- Browsing apartments without leaving Messages
- A message bubble whose own UI updates in place as the user swipes
- Both participants in a group chat seeing the same interactive card
- Sending a structured `MSMessage` whose payload survives in the transcript

## What it would require

None of these can be faked, which is why this MVP does not attempt it:

- An Apple Developer Program membership and Team ID
- A registered bundle identifier plus an App Group shared with the container app
- An Xcode project containing a Messages Extension target
- Code signing, provisioning profiles, and TestFlight or App Store distribution
- Installation on the recipient's device — an extension only renders for people
  who have installed it

There is also a fundamental delivery difference: Linq sends from a number
provisioned to the Linq account, whereas a Messages Extension runs on the user's
own device inside their own iMessage identity. They are different products, not
two ways of doing the same thing.

## How an extension would reuse this backend

The backend is already the right shape. Nothing about the domain, ranking or
persistence layers assumes iMessage — the Linq adapter is the only messaging-aware
component.

```
                    ┌──────────────────────────┐
Messages Extension ─┤                          │
  (Swift, on-device)│   HTTP + signed tokens   │
                    │            ↓             │
Linq webhook ───────┤   application services   ├─→ ranking / persistence
                    │   (unchanged)            │
Mobile web page ────┤                          │
                    └──────────────────────────┘
```

Concretely:

1. **Listing feed** — the extension would call a JSON endpoint returning the same
   `RankedListing` objects the presentation service already builds. Add
   `GET /api/batches/:batchId` next to the existing routes.
2. **Decisions** — `POST /api/listings/:listingId/reject` already exists and takes
   a signed action token. The extension would use the identical contract.
3. **Contact flow** — `POST /api/listings/:listingId/contact` returns an
   `applicationId` and a review URL. The extension would render the review step
   natively, then `POST /applications/:id/confirm` with the confirmation token.
   **The explicit-confirmation requirement would not be relaxed.**
4. **Auth** — the action-token scheme in `src/security/action-tokens.ts` is
   transport-agnostic: HMAC-SHA256 over `{listingId, userId, batchId, exp, nonce}`.
   The extension would receive tokens the same way the web page does.

The services in `src/application/` would need no changes. Only a new route module
and an `MSMessagesAppViewController` would be added.
