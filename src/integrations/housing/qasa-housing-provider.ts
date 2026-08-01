import type { HousingListing } from "../../domain/entities.js";
import { logger } from "../../utils/logger.js";
import type {
  HousingContactCapability,
  HousingProvider,
  HousingSearchInput,
  HousingSearchResult,
} from "./housing-provider.js";
import {
  AnthropicQasaListingSearch,
  type QasaListingSearch,
  type QasaSearchListing,
} from "./qasa-web-search-client.js";
import { env } from "../../config/env.js";

/**
 * Qasa discovery through Claude's server-side web search. Anthropic enforces a
 * qasa.com-only domain allow-list; this adapter never logs in, reverse engineers
 * Qasa's private APIs, or contacts a landlord. The original listing is always a
 * manual handoff.
 */
export class QasaHousingProvider implements HousingProvider {
  readonly name = "qasa";
  private readonly byId = new Map<string, HousingListing>();

  constructor(private readonly searchClient: QasaListingSearch = new AnthropicQasaListingSearch()) {}

  async search(input: HousingSearchInput): Promise<HousingSearchResult> {
    const candidates = await this.searchClient.search({
      ...input,
      limit: Math.min(input.limit ?? env.QASA_SEARCH_LIMIT, 20),
    });
    const rejected: string[] = [];
    const unique = new Map<string, HousingListing>();

    for (const candidate of candidates) {
      const listing = normaliseQasaListing(candidate);
      if (!listing) {
        rejected.push(candidate.url);
        continue;
      }
      unique.set(listing.providerListingId, listing);
      this.byId.set(listing.id, listing);
    }

    if (rejected.length > 0) {
      logger.warn({ rejectedCount: rejected.length }, "discarded invalid Qasa search results");
    }

    return {
      listings: [...unique.values()],
      provider: this.name,
      fetchedAt: new Date(),
    };
  }

  async getListing(id: string): Promise<HousingListing | null> {
    return this.byId.get(id) ?? null;
  }

  async getContactCapability(listing: HousingListing): Promise<HousingContactCapability> {
    return {
      capability: "manual_handoff",
      manualUrl: listing.canonicalUrl ?? undefined,
      note: "Continue on Qasa to contact the landlord.",
    };
  }
}

function normaliseQasaListing(input: QasaSearchListing): HousingListing | null {
  if (!input.active) return null;

  const parsedUrl = parseQasaListingUrl(input.url);
  const title = clean(input.title) ?? clean(input.address);
  const city = clean(input.city);
  const rent = input.rentSek;
  if (!parsedUrl || !title || !city || rent === null || rent <= 0) return null;
  if (input.rooms !== null && input.rooms < 0) return null;
  if (input.sizeSqm !== null && input.sizeSqm < 0) return null;

  const imageUrl = parseQasaImageUrl(input.imageUrl);
  return {
    id: `qasa-${parsedUrl.listingId}`,
    provider: "qasa",
    providerListingId: parsedUrl.listingId,
    canonicalUrl: parsedUrl.url,
    title,
    description: clean(input.description),
    address: clean(input.address),
    city,
    area: clean(input.area),
    latitude: null,
    longitude: null,
    monthlyRent: rent,
    currency: "SEK",
    rooms: input.rooms,
    sizeSquareMeters: input.sizeSqm,
    furnished: input.furnished,
    availableFrom: isoDateOrNull(input.availableFrom),
    availableTo: isoDateOrNull(input.availableUntil),
    minimumRentalMonths: null,
    amenities: [],
    imageUrls: imageUrl ? [imageUrl] : [],
    contactCapability: "manual_handoff",
    providerMetadata: {
      discovery: "claude_web_search",
      studentSuitable: input.studentSuitable,
    },
    isActive: true,
  };
}

function parseQasaListingUrl(value: string): { url: string; listingId: string } | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== "qasa.com" && !host.endsWith(".qasa.com"))) return null;
    const match = url.pathname.match(/\/home\/(\d+)(?:\/|$)/);
    if (!match?.[1]) return null;
    url.search = "";
    url.hash = "";
    return { url: url.toString(), listingId: match[1] };
  } catch {
    return null;
  }
}

function parseQasaImageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const officialHost = host === "qasa.com" || host.endsWith(".qasa.com") || host === "img.qasa.se";
    return url.protocol === "https:" && officialHost ? url.toString() : null;
  } catch {
    return null;
  }
}

function isoDateOrNull(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function clean(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 5_000) : null;
}
