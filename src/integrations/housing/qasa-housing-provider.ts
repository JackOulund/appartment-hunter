import { AppError } from "../../utils/errors.js";
import type { HousingListing } from "../../domain/entities.js";
import type {
  HousingContactCapability,
  HousingProvider,
  HousingSearchInput,
  HousingSearchResult,
} from "./housing-provider.js";

/**
 * Adapter boundary only.
 *
 * Qasa has no public partner API that we are authorised to call, and this
 * project will not scrape authenticated pages, bypass anti-bot protection, or
 * drive a user's account on their behalf. Until an authorised feed exists the
 * adapter refuses to run rather than pretending to work.
 *
 * See docs/QASA_INTEGRATION.md for what would need to be in place.
 */
export class QasaHousingProvider implements HousingProvider {
  readonly name = "qasa";

  private unavailable(): never {
    throw new AppError(
      "provider_not_configured",
      "The Qasa provider needs an authorised API, data feed or user-supplied dataset before it can be used. Set HOUSING_PROVIDER=mock to run locally.",
      { details: { docs: "docs/QASA_INTEGRATION.md" } },
    );
  }

  async search(_input: HousingSearchInput): Promise<HousingSearchResult> {
    this.unavailable();
  }

  async getListing(_id: string): Promise<HousingListing | null> {
    this.unavailable();
  }

  async getContactCapability(_listing: HousingListing): Promise<HousingContactCapability> {
    this.unavailable();
  }
}
