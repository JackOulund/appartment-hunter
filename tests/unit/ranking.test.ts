import { describe, expect, it } from "vitest";
import {
  applyHardFilters,
  deduplicateListings,
  estimateCommute,
  MAX_SCORE,
  rankListings,
  scoreListing,
  SCORE_WEIGHTS,
} from "../../src/domain/ranking.js";
import { searchPreferencesSchema, type Campus, type HousingListing } from "../../src/domain/entities.js";
import { MOCK_LISTINGS } from "../../src/integrations/housing/mock-listings.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

const CAMPUS: Campus = {
  id: "lund-central",
  name: "Lund city campus",
  address: "Paradisgatan 2",
  coordinates: { latitude: 55.7047, longitude: 13.191 },
};

const basePreferences = searchPreferencesSchema.parse({
  city: "Lund",
  maximumMonthlyRent: 8000,
  preferredMoveInDate: "2026-08-20",
  minimumRentalMonths: 6,
  minimumRooms: 1,
  maxCommuteMinutes: 25,
  furnishedPreference: "furnished",
  commuteModes: ["bicycle"],
});

const context = (overrides: Partial<Parameters<typeof rankListings>[1]> = {}) => ({
  preferences: basePreferences,
  campus: CAMPUS,
  excludedListingIds: new Set<string>(),
  now: NOW,
  ...overrides,
});

function listing(overrides: Partial<HousingListing> = {}): HousingListing {
  return {
    id: "L1",
    provider: "mock",
    providerListingId: "L1",
    canonicalUrl: null,
    title: "Test flat",
    description: "A flat",
    address: "Testgatan 1",
    city: "Lund",
    area: "Väster",
    latitude: 55.706,
    longitude: 13.189,
    monthlyRent: 7000,
    currency: "SEK",
    rooms: 1,
    sizeSquareMeters: 30,
    furnished: true,
    availableFrom: "2026-08-18",
    availableTo: "2027-06-30",
    minimumRentalMonths: 6,
    amenities: ["wifi"],
    imageUrls: ["https://example.invalid/a.jpg"],
    contactCapability: "email",
    providerMetadata: {},
    isActive: true,
    ...overrides,
  };
}

describe("hard filters", () => {
  it("rejects listings over budget", () => {
    const result = applyHardFilters(listing({ monthlyRent: 9500 }), context());
    expect(result).toEqual({ passed: false, reason: "over_budget" });
  });

  it("rejects inactive listings", () => {
    expect(applyHardFilters(listing({ isActive: false }), context()).reason).toBe("listing_inactive");
  });

  it("rejects listings whose availability window has already closed", () => {
    const result = applyHardFilters(
      listing({ availableFrom: "2025-09-01", availableTo: "2026-05-31" }),
      context(),
    );
    expect(result.passed).toBe(false);
  });

  it("rejects listings available far after the preferred move-in date", () => {
    expect(applyHardFilters(listing({ availableFrom: "2026-11-01" }), context()).reason).toBe(
      "available_too_late",
    );
  });

  it("rejects listings with too few rooms", () => {
    const preferences = { ...basePreferences, minimumRooms: 2 };
    expect(applyHardFilters(listing({ rooms: 1 }), context({ preferences })).reason).toBe("too_few_rooms");
  });

  it("rejects listings missing a mandatory amenity", () => {
    const preferences = { ...basePreferences, requiredAmenities: ["laundry"] };
    expect(applyHardFilters(listing({ amenities: ["wifi"] }), context({ preferences })).reason).toBe(
      "missing_amenity:laundry",
    );
  });

  it("rejects listings in an excluded area", () => {
    const preferences = { ...basePreferences, excludedAreas: ["Väster"] };
    expect(applyHardFilters(listing(), context({ preferences })).reason).toBe("excluded_area");
  });

  it("rejects listings beyond the commute limit", () => {
    // ~9 km from campus at bicycle speed is well over 25 minutes.
    const far = listing({ latitude: 55.79, longitude: 13.19 });
    expect(applyHardFilters(far, context()).reason).toBe("commute_too_long");
  });

  it("rejects a listing the user already decided on", () => {
    const result = applyHardFilters(
      listing(),
      context({ excludedListingIds: new Set(["L1"]) }),
    );
    expect(result.reason).toBe("already_decided");
  });

  it("accepts a listing that satisfies every constraint", () => {
    expect(applyHardFilters(listing(), context()).passed).toBe(true);
  });
});

describe("commute estimation", () => {
  it("returns null when the listing has no coordinates", () => {
    expect(estimateCommute(listing({ latitude: null, longitude: null }), CAMPUS, ["bicycle"])).toBeNull();
  });

  it("picks the fastest of the requested modes", () => {
    const estimate = estimateCommute(listing(), CAMPUS, ["walk", "bicycle"]);
    expect(estimate?.mode).toBe("bicycle");
  });
});

describe("scoring", () => {
  it("never exceeds the maximum score", () => {
    const ranked = scoreListing(listing(), context());
    expect(ranked.score).toBeLessThanOrEqual(MAX_SCORE);
    expect(ranked.score).toBeGreaterThan(0);
  });

  it("awards full budget points when comfortably under budget", () => {
    const ranked = scoreListing(listing({ monthlyRent: 6000 }), context());
    expect(ranked.breakdown.budget).toBe(SCORE_WEIGHTS.budget);
  });

  it("awards no budget points at exactly the budget ceiling", () => {
    const ranked = scoreListing(listing({ monthlyRent: 8000 }), context());
    expect(ranked.breakdown.budget).toBe(0);
  });

  it("states the budget headroom as a fact", () => {
    const ranked = scoreListing(listing({ monthlyRent: 7450 }), context());
    expect(ranked.reasons.find((r) => r.code === "budget")?.label).toBe("550 SEK below your budget");
  });

  it("reports availability relative to the requested move-in date", () => {
    const ranked = scoreListing(listing({ availableFrom: "2026-08-18" }), context());
    expect(ranked.reasons.find((r) => r.code === "move_in")?.label).toBe(
      "Available 2 days before your move-in date",
    );
  });

  it("credits a matching furnished preference", () => {
    const ranked = scoreListing(listing({ furnished: true }), context());
    expect(ranked.reasons.some((r) => r.code === "furnished")).toBe(true);
    expect(ranked.breakdown.amenities).toBe(SCORE_WEIGHTS.amenities);
  });

  it("penalises the wrong furnished state", () => {
    const ranked = scoreListing(listing({ furnished: false }), context());
    expect(ranked.breakdown.amenities).toBeLessThan(SCORE_WEIGHTS.amenities);
  });

  it("is deterministic across repeated runs", () => {
    const a = scoreListing(listing(), context());
    const b = scoreListing(listing(), context());
    expect(a.score).toBe(b.score);
    expect(a.breakdown).toEqual(b.breakdown);
  });
});

describe("deduplication", () => {
  it("collapses the same address and rent into one listing", () => {
    const rich = listing({ id: "rich", description: "Full record", area: "Väster" });
    const thin = listing({ id: "thin", description: null, area: null, imageUrls: [] });
    const result = deduplicateListings([rich, thin]);
    expect(result).toHaveLength(1);
    // The more complete record survives.
    expect(result[0]?.id).toBe("rich");
  });

  it("keeps genuinely different listings", () => {
    const a = listing({ id: "a", address: "Gata 1" });
    const b = listing({ id: "b", address: "Gata 2" });
    expect(deduplicateListings([a, b])).toHaveLength(2);
  });
});

describe("ranking over the mock catalogue", () => {
  it("returns exactly three listings when a limit is applied", () => {
    const ranked = rankListings(MOCK_LISTINGS, context(), { limit: 3 });
    expect(ranked).toHaveLength(3);
  });

  it("sorts by descending score", () => {
    const ranked = rankListings(MOCK_LISTINGS, context());
    const scores = ranked.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("excludes previously rejected listings", () => {
    const first = rankListings(MOCK_LISTINGS, context(), { limit: 3 });
    const rejected = new Set(first.map((r) => r.listing.id));
    const second = rankListings(MOCK_LISTINGS, context({ excludedListingIds: rejected }), { limit: 3 });

    for (const entry of second) {
      expect(rejected.has(entry.listing.id)).toBe(false);
    }
  });

  it("never returns an over-budget or inactive listing", () => {
    for (const entry of rankListings(MOCK_LISTINGS, context())) {
      expect(entry.listing.monthlyRent).toBeLessThanOrEqual(8000);
      expect(entry.listing.isActive).toBe(true);
    }
  });

  it("produces identical output on repeated runs", () => {
    const a = rankListings(MOCK_LISTINGS, context(), { limit: 3 }).map((r) => r.listing.id);
    const b = rankListings(MOCK_LISTINGS, context(), { limit: 3 }).map((r) => r.listing.id);
    expect(a).toEqual(b);
  });
});
