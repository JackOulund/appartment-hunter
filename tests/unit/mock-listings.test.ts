import { describe, expect, it } from "vitest";
import { MOCK_LISTINGS } from "../../src/integrations/housing/mock-listings.js";

/** Cities the demo persona and provider-side neighbour matching both know about. */
const MAJOR_CITIES = ["Lund", "Malmö", "Stockholm", "Uppsala", "Gothenburg"];

const SWEDEN_LAT_RANGE = { min: 55, max: 69 };
const SWEDEN_LON_RANGE = { min: 10, max: 24 };

describe("mock listings catalogue", () => {
  it("has grown enough to give a demo runway past the old ~7-search ceiling", () => {
    expect(MOCK_LISTINGS.length).toBeGreaterThanOrEqual(48);
  });

  it("has unique ids, every one prefixed with mock-", () => {
    const ids = MOCK_LISTINGS.map((listing) => listing.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith("mock-")).toBe(true);
    }
  });

  it("conforms to the HousingListing invariants at runtime", () => {
    for (const listing of MOCK_LISTINGS) {
      expect(listing.provider).toBe("mock");
      expect(listing.currency).toBe("SEK");
      expect(listing.monthlyRent).toBeGreaterThan(0);

      if (listing.canonicalUrl !== null) {
        expect(listing.canonicalUrl.startsWith("https://example.invalid/")).toBe(true);
      }

      if (listing.latitude !== null) {
        expect(listing.latitude).toBeGreaterThanOrEqual(SWEDEN_LAT_RANGE.min);
        expect(listing.latitude).toBeLessThanOrEqual(SWEDEN_LAT_RANGE.max);
      }
      if (listing.longitude !== null) {
        expect(listing.longitude).toBeGreaterThanOrEqual(SWEDEN_LON_RANGE.min);
        expect(listing.longitude).toBeLessThanOrEqual(SWEDEN_LON_RANGE.max);
      }

      if (listing.availableFrom !== null && listing.availableTo !== null) {
        expect(new Date(listing.availableFrom).getTime()).toBeLessThanOrEqual(
          new Date(listing.availableTo).getTime(),
        );
      }

      if (listing.isActive) {
        expect(listing.imageUrls.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives the Lund student persona at least 20 active listings within budget", () => {
    const affordable = MOCK_LISTINGS.filter(
      (listing) => listing.city === "Lund" && listing.isActive && listing.monthlyRent <= 9500,
    );
    expect(affordable.length).toBeGreaterThanOrEqual(20);
  });

  it("keeps at least one inactive listing and one over-9500 listing per major city", () => {
    for (const city of MAJOR_CITIES) {
      const listings = MOCK_LISTINGS.filter((listing) => listing.city === city);
      expect(listings.length).toBeGreaterThan(0);
      expect(listings.some((listing) => !listing.isActive)).toBe(true);
      expect(listings.some((listing) => listing.monthlyRent > 9500)).toBe(true);
    }
  });
});
