import type { HousingListing } from "../../domain/entities.js";
import type { HousingProvider, HousingContactResult } from "../housing/housing-provider.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { previewText, redactEmail, redactPhone } from "../../security/redaction.js";

export interface ContactRequest {
  listing: HousingListing;
  message: string;
  applicant: { fullName: string; email: string; phone: string };
  idempotencyKey: string;
}

export interface ContactService {
  send(request: ContactRequest): Promise<HousingContactResult>;
}

/**
 * Routes a confirmed application to whatever channel the listing actually
 * supports. When no automatic channel exists it returns `manual_required`
 * rather than reporting a success that never happened.
 */
export class HousingContactService implements ContactService {
  constructor(
    private readonly provider: HousingProvider,
    private readonly dryRun: boolean = env.CONTACT_DRY_RUN,
  ) {}

  async send(request: ContactRequest): Promise<HousingContactResult> {
    const capability = await this.provider.getContactCapability(request.listing);

    if (this.dryRun) {
      logger.info(
        {
          listingId: request.listing.id,
          capability: capability.capability,
          recipient: capability.recipientEmail ? redactEmail(capability.recipientEmail) : "(provider)",
          applicantEmail: redactEmail(request.applicant.email),
          applicantPhone: redactPhone(request.applicant.phone),
          preview: previewText(request.message, 60),
        },
        "contact dry-run: nothing was sent to a real landlord",
      );

      if (capability.capability === "manual_handoff") {
        return {
          status: "manual_required",
          ...(capability.manualUrl ? { manualUrl: capability.manualUrl } : {}),
        };
      }
      // Reflect the provider's simulated outcome so the failure path is demoable.
      const metadata = request.listing.providerMetadata as { simulateContactFailure?: boolean };
      if (metadata.simulateContactFailure) {
        return { status: "failed", failureReason: "Simulated landlord rejection (dry-run)." };
      }
      return { status: "sent", externalMessageId: `dryrun-${request.idempotencyKey}` };
    }

    if (capability.capability === "manual_handoff" || !this.provider.contact) {
      return {
        status: "manual_required",
        ...(capability.manualUrl ? { manualUrl: capability.manualUrl } : {}),
      };
    }

    return this.provider.contact({
      listing: request.listing,
      message: request.message,
      applicant: request.applicant,
      idempotencyKey: request.idempotencyKey,
    });
  }
}
