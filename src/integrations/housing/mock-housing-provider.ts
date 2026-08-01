import type { HousingListing } from "../../domain/entities.js";
import type {
  HousingContactCapability,
  HousingContactInput,
  HousingContactResult,
  HousingProvider,
  HousingSearchInput,
  HousingSearchResult,
} from "./housing-provider.js";
import { MOCK_LISTINGS } from "./mock-listings.js";

/**
 * Deterministic in-memory provider. Returns listings in a stable order so tests
 * and live demos produce identical results on every run.
 */
export class MockHousingProvider implements HousingProvider {
  readonly name = "mock";
  private readonly listings: HousingListing[];
  private readonly contactLog: HousingContactInput[] = [];

  constructor(listings: HousingListing[] = MOCK_LISTINGS) {
    this.listings = [...listings].sort((a, b) => a.id.localeCompare(b.id));
  }

  async search(input: HousingSearchInput): Promise<HousingSearchResult> {
    const city = input.preferences.city?.toLowerCase();
    // Return the city plus everything nearby; the domain layer applies the real
    // filters so provider-side narrowing stays intentionally loose.
    const listings = city
      ? this.listings.filter(
          (listing) => listing.city.toLowerCase() === city || withinNeighbouringCity(listing, city),
        )
      : [...this.listings];

    return {
      listings: input.limit ? listings.slice(0, input.limit) : listings,
      provider: this.name,
      fetchedAt: new Date(0),
    };
  }

  async getListing(id: string): Promise<HousingListing | null> {
    return this.listings.find((listing) => listing.id === id) ?? null;
  }

  async getContactCapability(listing: HousingListing): Promise<HousingContactCapability> {
    const metadata = listing.providerMetadata as {
      landlordEmail?: string;
      manualUrl?: string;
    };

    switch (listing.contactCapability) {
      case "email":
        return { capability: "email", recipientEmail: metadata.landlordEmail };
      case "provider_api":
        return { capability: "provider_api" };
      case "manual_handoff":
        return {
          capability: "manual_handoff",
          manualUrl: metadata.manualUrl ?? listing.canonicalUrl ?? undefined,
          note: "This landlord only accepts applications through their own site.",
        };
      default:
        return { capability: listing.contactCapability };
    }
  }

  async contact(input: HousingContactInput): Promise<HousingContactResult> {
    this.contactLog.push(input);
    const metadata = input.listing.providerMetadata as {
      simulateContactFailure?: boolean;
      manualUrl?: string;
    };

    if (input.listing.contactCapability === "manual_handoff") {
      return {
        status: "manual_required",
        manualUrl: metadata.manualUrl ?? input.listing.canonicalUrl ?? undefined,
      };
    }
    if (metadata.simulateContactFailure) {
      return { status: "failed", failureReason: "Landlord inbox rejected the message." };
    }
    return { status: "sent", externalMessageId: `mock-contact-${input.listing.providerListingId}` };
  }

  /** Test/demo affordance — lets assertions confirm nothing real was sent. */
  getContactLog(): readonly HousingContactInput[] {
    return this.contactLog;
  }
}

const NEIGHBOURS: Record<string, string[]> = {
  lund: ["malmö"],
  malmö: ["lund"],
  stockholm: [],
  uppsala: [],
  gothenburg: [],
};

function withinNeighbouringCity(listing: HousingListing, city: string): boolean {
  return (NEIGHBOURS[city] ?? []).includes(listing.city.toLowerCase());
}
