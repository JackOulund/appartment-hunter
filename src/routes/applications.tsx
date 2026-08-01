import { Hono } from "hono";
import type { Container } from "../application/container.js";
import { ApplicationReviewPage } from "../ui/application-review-page.js";
import { StatePage } from "../ui/layout.js";
import { isAppError, AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";
import type { Language } from "../domain/entities.js";
import { redactEmail } from "../security/redaction.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Shared shape for the JSX error responses below. */
type HtmlContext = Pick<Context, "html">;

/**
 * The review → edit → confirm flow. Confirmation is a distinct POST carrying a
 * short-lived token; opening the page or clicking "Contact landlord" never sends.
 */
export function applicationRoutes(container: Container): Hono {
  const app = new Hono();

  const load = async (applicationId: string) => {
    const application = await container.repos.applications.findById(applicationId);
    if (!application) throw new AppError("not_found", "Application not found.");
    const user = await container.repos.users.findById(application.userId);
    const listing = await container.repos.listings.findById(application.listingId);
    if (!user || !listing) throw new AppError("not_found", "Application data is incomplete.");
    return { application, user, listing };
  };

  app.get("/applications/:id/review", async (c) => {
    try {
      const { application, user, listing } = await load(c.req.param("id"));

      if (application.status === "sent") {
        return c.html(
          <StatePage glyph="✅" title="Already sent" message="This application has already been sent to the landlord." />,
        );
      }
      if (application.status === "cancelled") {
        return c.html(
          <StatePage glyph="🚫" title="Cancelled" message="This application was cancelled." />,
        );
      }

      // Issue a fresh confirmation each time the page is opened.
      const { token, expiresAt } = await container.applications.requestConfirmation(
        application.id,
        application.userId,
      );
      const capability = await container.housing.getContactCapability(listing);

      return c.html(
        <ApplicationReviewPage
          applicationId={application.id}
          listing={listing}
          message={application.editedMessage ?? application.draftMessage}
          recipientLabel={
            capability.recipientEmail
              ? redactEmail(capability.recipientEmail)
              : capability.capability === "manual_handoff"
                ? "the landlord's own website"
                : `${listing.provider} (provider channel)`
          }
          applicant={{
            fullName: user.fullName ?? "",
            email: user.email ?? "",
            phone: user.contactPhone ?? "",
          }}
          language={(user.preferredLanguage as Language) ?? "en"}
          confirmationToken={token}
          expiresAt={expiresAt}
          capability={capability.capability}
          manualUrl={capability.manualUrl}
          dryRun={env.CONTACT_DRY_RUN}
        />,
      );
    } catch (error) {
      return renderError(c, error);
    }
  });

  app.post("/applications/:id/update", async (c) => {
    try {
      const { application } = await load(c.req.param("id"));
      const body = await c.req.parseBody();
      const message = String(body["message"] ?? "").trim();
      if (!message) throw new AppError("validation_failed", "The message cannot be empty.");

      await container.applications.updateDraft(application.id, application.userId, message);
      return c.redirect(`/applications/${application.id}/review`, 303);
    } catch (error) {
      return renderError(c, error);
    }
  });

  app.post("/applications/:id/confirm", async (c) => {
    try {
      const { application } = await load(c.req.param("id"));
      const body = await c.req.parseBody();
      const token = String(body["token"] ?? "");

      const result = await container.applications.confirmAndSend({
        applicationId: application.id,
        userId: application.userId,
        token,
      });

      if (result.status === "sent") {
        return c.html(
          <StatePage
            glyph="✅"
            title={env.CONTACT_DRY_RUN ? "Simulated send" : "Message sent"}
            message={
              env.CONTACT_DRY_RUN
                ? "Dry-run mode is on, so nothing left this machine. The application was recorded exactly as it would have been sent."
                : "Your message is on its way to the landlord. I'll let you know in the conversation if they reply."
            }
          />,
        );
      }
      if (result.status === "manual_required") {
        return c.html(
          <StatePage
            glyph="📄"
            title="Submit it yourself"
            message="This landlord only accepts applications through their own site. Your message has been saved — open their listing and paste it in."
            action={result.manualUrl ? { label: "Open the listing", href: result.manualUrl } : undefined}
          />,
        );
      }
      return c.html(
        <StatePage
          glyph="⚠️"
          title="Could not send"
          message={result.failureReason ?? "The landlord's inbox rejected the message. Nothing was sent."}
        />,
        502,
      );
    } catch (error) {
      return renderError(c, error);
    }
  });

  app.post("/applications/:id/cancel", async (c) => {
    try {
      const { application } = await load(c.req.param("id"));
      await container.applications.cancel(application.id, application.userId);
      return c.html(
        <StatePage glyph="🚫" title="Cancelled" message="Nothing was sent. You can go back to the conversation." />,
      );
    } catch (error) {
      return renderError(c, error);
    }
  });

  return app;
}

function renderError(c: HtmlContext, error: unknown): Response | Promise<Response> {
  if (isAppError(error)) {
    const titles: Record<string, { glyph: string; title: string }> = {
      confirmation_expired: { glyph: "⏳", title: "Confirmation expired" },
      confirmation_required: { glyph: "✋", title: "Confirmation required" },
      token_invalid: { glyph: "🔒", title: "Confirmation not valid" },
      conflict: { glyph: "📮", title: "Already handled" },
      consent_required: { glyph: "✋", title: "Consent required" },
      not_found: { glyph: "🔍", title: "Not found" },
      validation_failed: { glyph: "✏️", title: "Check your message" },
    };
    const meta = titles[error.code] ?? { glyph: "⚠️", title: "Something went wrong" };
    return c.html(
      <StatePage glyph={meta.glyph} title={meta.title} message={error.message} />,
      error.status as ContentfulStatusCode,
    );
  }
  logger.error({ error: String(error) }, "application route failed");
  return c.html(
    <StatePage glyph="⚠️" title="Something went wrong" message="Please try again in a moment." />,
    500,
  );
}
