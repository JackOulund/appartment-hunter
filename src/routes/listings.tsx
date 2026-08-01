import { Hono } from "hono";
import type { Container } from "../application/container.js";
import { requireActionToken } from "../security/action-tokens.js";
import { ListingPage } from "../ui/listing-page.js";
import { ApplicationReviewPage } from "../ui/application-review-page.js";
import { StatePage } from "../ui/layout.js";
import { estimateCommute, scoreListing } from "../domain/ranking.js";
import { AppError, isAppError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { Language, ScoreReason } from "../domain/entities.js";
import { missingContactDetails, hasAllContactDetails } from "../application/application-service.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Shared shape for the JSX error responses below. */
type HtmlContext = Pick<Context, "html">;

export function listingRoutes(container: Container): Hono {
  const app = new Hono();

  const resolve = async (token: string) => {
    const payload = requireActionToken(token);
    const listing = await container.repos.listings.findById(payload.listingId);
    if (!listing) throw new AppError("not_found", "Listing not found.");
    const user = await container.repos.users.findById(payload.userId);
    if (!user || user.deletedAt) throw new AppError("forbidden", "This link is no longer available.");
    return { payload, listing, user };
  };

  app.get("/l/:token", async (c) => {
    try {
      const { payload, listing, user } = await resolve(c.req.param("token"));

      const profileRow = await container.repos.searchProfiles.findLatest(user.id);
      const university = user.acceptedUniversityId
        ? container.universities.getById(user.acceptedUniversityId)
        : null;
      const campus =
        university && user.selectedCampusId
          ? (university.campuses.find((x) => x.id === user.selectedCampusId) ?? university.campuses[0] ?? null)
          : (university?.campuses[0] ?? null);

      // Recompute the explanation so the page always reflects current preferences.
      let reasons: ScoreReason[] = [];
      let commuteMinutes: number | null = null;
      if (profileRow) {
        const preferences = container.repos.searchProfiles.toPreferences(profileRow);
        const ranked = scoreListing(listing, {
          preferences,
          campus,
          excludedListingIds: new Set(),
          now: new Date(),
        });
        reasons = ranked.reasons;
        commuteMinutes = ranked.commuteMinutes;
      } else if (campus) {
        commuteMinutes = estimateCommute(listing, campus, ["bicycle"])?.minutes ?? null;
      }

      const decision = await container.repos.decisions.find(user.id, listing.id);
      const language = (user.preferredLanguage as Language) ?? "en";

      return c.html(
        <ListingPage
          listing={listing}
          token={c.req.param("token")}
          reasons={reasons}
          commuteMinutes={commuteMinutes}
          universityName={university?.officialName ?? null}
          language={language}
          alreadyRejected={decision?.decision === "rejected"}
          alreadyContacted={decision?.decision === "contacted"}
          baseUrl={env.BASE_URL}
        />,
      );
    } catch (error) {
      return renderError(c, error);
    }
  });

  /** Reject is idempotent: a second submit lands on the same success page. */
  app.post("/l/:token/reject", async (c) => {
    try {
      const { payload, listing, user } = await resolve(c.req.param("token"));

      const existing = await container.repos.decisions.find(user.id, listing.id);
      if (existing?.decision === "contacted") {
        return c.html(
          <StatePage
            glyph="📮"
            title="Already contacted"
            message="You already contacted this landlord, so the apartment was not rejected."
          />,
        );
      }

      await container.repos.decisions.record({
        userId: user.id,
        listingId: listing.id,
        batchId: payload.batchId,
        decision: "rejected",
        source: "listing_page",
      });

      logger.info({ listingId: listing.id }, "listing rejected from mobile page");
      return c.html(
        <StatePage
          glyph="✓"
          title="Rejected"
          message="I won't show you this apartment again. You can close this page and go back to the conversation."
        />,
      );
    } catch (error) {
      return renderError(c, error);
    }
  });

  app.post("/api/listings/:listingId/reject", async (c) => {
    // Token-authenticated JSON variant for programmatic clients.
    const token = c.req.query("token") ?? "";
    try {
      const { listing, user, payload } = await resolve(token);
      if (listing.id !== c.req.param("listingId")) {
        throw new AppError("forbidden", "Token does not match this listing.");
      }
      await container.repos.decisions.record({
        userId: user.id,
        listingId: listing.id,
        batchId: payload.batchId,
        decision: "rejected",
        source: "api",
      });
      return c.json({ status: "rejected", listingId: listing.id });
    } catch (error) {
      if (isAppError(error)) return c.json({ error: error.code, message: error.message }, error.status as ContentfulStatusCode);
      return c.json({ error: "internal_error" }, 500);
    }
  });

  app.get("/l/:token/contact", async (c) => {
    try {
      const { listing, user } = await resolve(c.req.param("token"));
      const language = (user.preferredLanguage as Language) ?? "en";

      const missing = missingContactDetails(user);
      if (!hasAllContactDetails(missing)) {
        return c.html(
          <StatePage
            glyph="💬"
            title="A few details first"
            message="Go back to the conversation — I need your name, email and phone number before I can prepare a message to the landlord."
          />,
        );
      }

      const application = await container.applications.createDraft({
        userId: user.id,
        listingId: listing.id,
        language,
      });
      return c.redirect(`/applications/${application.id}/review`, 303);
    } catch (error) {
      return renderError(c, error);
    }
  });

  app.post("/api/listings/:listingId/contact", async (c) => {
    const token = c.req.query("token") ?? "";
    try {
      const { listing, user } = await resolve(token);
      if (listing.id !== c.req.param("listingId")) {
        throw new AppError("forbidden", "Token does not match this listing.");
      }
      const application = await container.applications.createDraft({
        userId: user.id,
        listingId: listing.id,
        language: (user.preferredLanguage as Language) ?? "en",
      });
      return c.json({
        applicationId: application.id,
        reviewUrl: `${env.BASE_URL}/applications/${application.id}/review`,
        status: application.status,
      });
    } catch (error) {
      if (isAppError(error)) return c.json({ error: error.code, message: error.message }, error.status as ContentfulStatusCode);
      return c.json({ error: "internal_error" }, 500);
    }
  });

  return app;
}

function renderError(c: HtmlContext, error: unknown): Response | Promise<Response> {
  if (isAppError(error)) {
    if (error.code === "token_expired") {
      return c.html(
        <StatePage
          glyph="⏳"
          title="Link expired"
          message="This apartment link is no longer valid. Ask for a fresh batch in the conversation and I'll send new links."
        />,
        410,
      );
    }
    if (error.code === "token_invalid" || error.code === "forbidden") {
      return c.html(
        <StatePage glyph="🔒" title="Link not valid" message="This link cannot be opened." />,
        403,
      );
    }
    if (error.code === "not_found") {
      return c.html(
        <StatePage glyph="🏚" title="Apartment unavailable" message="This apartment is no longer listed." />,
        404,
      );
    }
  }
  logger.error({ error: String(error) }, "listing page failed");
  return c.html(
    <StatePage glyph="⚠️" title="Something went wrong" message="Please try again in a moment." />,
    500,
  );
}

export { ApplicationReviewPage };
