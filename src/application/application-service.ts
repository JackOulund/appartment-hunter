import type { Repositories, ApplicationRow } from "../database/repositories/index.js";
import type { ContactService } from "../integrations/contact/housing-contact-service.js";
import type { LlmProvider } from "../integrations/llm/llm-provider.js";
import type { UniversityProvider } from "../integrations/university/university-provider.js";
import { buildLandlordMessage } from "../integrations/llm/mock-llm-provider.js";
import { AppError } from "../utils/errors.js";
import { idempotencyKeys, sha256 } from "../utils/ids.js";
import { CONFIRMATION_TTL_MINUTES, createConfirmationToken } from "../security/action-tokens.js";
import { formatDate } from "../utils/dates.js";
import { logger } from "../utils/logger.js";
import type { Language } from "../domain/entities.js";

export interface DraftInput {
  userId: string;
  listingId: string;
  language: Language;
}

export interface MissingDetails {
  fullName: boolean;
  email: boolean;
  phone: boolean;
}

export function missingContactDetails(user: {
  fullName: string | null;
  email: string | null;
  contactPhone: string | null;
}): MissingDetails {
  return {
    fullName: !user.fullName,
    email: !user.email,
    phone: !user.contactPhone,
  };
}

export function hasAllContactDetails(missing: MissingDetails): boolean {
  return !missing.fullName && !missing.email && !missing.phone;
}

export class ApplicationService {
  constructor(
    private readonly repos: Repositories,
    private readonly contact: ContactService,
    private readonly llm: LlmProvider,
    private readonly universities: UniversityProvider,
  ) {}

  /**
   * Creates (or reuses) a draft. Never sends anything — sending requires a
   * separate explicit confirmation.
   */
  async createDraft(input: DraftInput): Promise<ApplicationRow> {
    const user = await this.repos.users.findById(input.userId);
    if (!user) throw new AppError("not_found", "User not found.");

    const listing = await this.repos.listings.findById(input.listingId);
    if (!listing) throw new AppError("not_found", "Listing not found.");

    const existing = await this.repos.applications.findActiveForListing(input.userId, input.listingId);
    if (existing && (existing.status === "sent" || existing.status === "sending")) {
      throw new AppError("conflict", "An application for this apartment has already been sent.");
    }
    if (existing && existing.status !== "cancelled" && existing.status !== "failed") {
      return existing;
    }

    const missing = missingContactDetails(user);
    if (!hasAllContactDetails(missing)) {
      throw new AppError("validation_failed", "Contact details are required before drafting.", {
        details: { missing },
      });
    }

    const profile = await this.repos.searchProfiles.findLatest(input.userId);
    const university = user.acceptedUniversityId
      ? this.universities.getById(user.acceptedUniversityId)
      : null;

    const draftMessage = buildLandlordMessage({
      applicantName: user.fullName ?? "",
      university: university?.officialName ?? "my university",
      address: listing.address ?? listing.title,
      moveInDate: formatDate(profile?.preferredMoveInDate ?? listing.availableFrom),
      durationMonths: profile?.minimumRentalMonths ?? 6,
      phone: user.contactPhone ?? "",
      email: user.email ?? "",
      language: input.language,
    });

    const application = await this.repos.applications.create({
      userId: input.userId,
      listingId: input.listingId,
      draftMessage,
    });

    await this.repos.decisions.record({
      userId: input.userId,
      listingId: input.listingId,
      decision: "contact_requested",
      source: "application_draft",
    });

    return application;
  }

  async updateDraft(applicationId: string, userId: string, editedMessage: string): Promise<ApplicationRow> {
    const application = await this.requireOwned(applicationId, userId);
    if (application.status === "sent" || application.status === "sending") {
      throw new AppError("conflict", "This application has already been sent.");
    }
    await this.repos.applications.patch(applicationId, {
      editedMessage,
      status: "draft",
      // Editing invalidates any confirmation that was already issued.
      confirmationTokenHash: null,
      confirmationExpiresAt: null,
    });
    const updated = await this.repos.applications.findById(applicationId);
    if (!updated) throw new AppError("not_found", "Application not found.");
    return updated;
  }

  /** Issues a short-lived confirmation token. The plaintext is never stored. */
  async requestConfirmation(
    applicationId: string,
    userId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const application = await this.requireOwned(applicationId, userId);
    if (application.status === "sent" || application.status === "sending") {
      throw new AppError("conflict", "This application has already been sent.");
    }

    const { token, expiresAt } = createConfirmationToken();
    await this.repos.applications.patch(applicationId, {
      status: "awaiting_confirmation",
      confirmationTokenHash: sha256(token),
      confirmationExpiresAt: expiresAt.toISOString(),
    });
    return { token, expiresAt };
  }

  /**
   * The only path that actually contacts a landlord. Requires a matching,
   * unexpired confirmation token and is idempotent per application.
   */
  async confirmAndSend(input: {
    applicationId: string;
    userId: string;
    token: string;
    now?: Date;
  }): Promise<{ status: "sent" | "failed" | "manual_required"; manualUrl?: string; failureReason?: string }> {
    const now = input.now ?? new Date();
    const application = await this.requireOwned(input.applicationId, input.userId);

    if (application.status === "sent") {
      return { status: "sent" };
    }
    if (application.status === "sending") {
      throw new AppError("conflict", "This application is already being sent.");
    }
    if (!application.confirmationTokenHash || !application.confirmationExpiresAt) {
      throw new AppError("confirmation_required", "This application has not been confirmed.");
    }
    if (new Date(application.confirmationExpiresAt).getTime() <= now.getTime()) {
      throw new AppError(
        "confirmation_expired",
        `Confirmation expired. Confirmations are valid for ${CONFIRMATION_TTL_MINUTES} minutes.`,
      );
    }
    if (sha256(input.token) !== application.confirmationTokenHash) {
      throw new AppError("token_invalid", "That confirmation is not valid.");
    }

    const user = await this.repos.users.findById(input.userId);
    const listing = await this.repos.listings.findById(application.listingId);
    if (!user || !listing) throw new AppError("not_found", "Application data is incomplete.");
    if (!user.consentToShareContactDetails) {
      throw new AppError("consent_required", "Consent to share contact details is required.");
    }

    // Claim the send before doing it, so a double submit cannot send twice.
    await this.repos.applications.patch(input.applicationId, {
      status: "sending",
      confirmedAt: now.toISOString(),
      confirmationTokenHash: null,
    });

    const result = await this.contact.send({
      listing,
      message: application.editedMessage ?? application.draftMessage,
      applicant: {
        fullName: user.fullName ?? "",
        email: user.email ?? "",
        phone: user.contactPhone ?? "",
      },
      idempotencyKey: idempotencyKeys.contact(input.applicationId),
    });

    if (result.status === "sent") {
      await this.repos.applications.patch(input.applicationId, {
        status: "sent",
        sentAt: now.toISOString(),
        externalMessageId: result.externalMessageId ?? null,
        failureReason: null,
      });
      await this.repos.decisions.record({
        userId: input.userId,
        listingId: application.listingId,
        decision: "contacted",
        source: "application_sent",
      });
      logger.info({ applicationId: input.applicationId }, "application sent");
      return { status: "sent" };
    }

    if (result.status === "manual_required") {
      await this.repos.applications.patch(input.applicationId, {
        status: "manual_handoff",
        failureReason: "Automatic contact is not available for this listing.",
      });
      return {
        status: "manual_required",
        ...(result.manualUrl ? { manualUrl: result.manualUrl } : {}),
      };
    }

    await this.repos.applications.patch(input.applicationId, {
      status: "failed",
      failureReason: result.failureReason ?? "Unknown failure",
    });
    return {
      status: "failed",
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
    };
  }

  async cancel(applicationId: string, userId: string): Promise<void> {
    const application = await this.requireOwned(applicationId, userId);
    if (application.status === "sent") {
      throw new AppError("conflict", "This application has already been sent and cannot be cancelled.");
    }
    await this.repos.applications.patch(applicationId, {
      status: "cancelled",
      confirmationTokenHash: null,
      confirmationExpiresAt: null,
    });
  }

  private async requireOwned(applicationId: string, userId: string): Promise<ApplicationRow> {
    const application = await this.repos.applications.findById(applicationId);
    if (!application) throw new AppError("not_found", "Application not found.");
    if (application.userId !== userId) throw new AppError("forbidden", "This application belongs to someone else.");
    return application;
  }
}
