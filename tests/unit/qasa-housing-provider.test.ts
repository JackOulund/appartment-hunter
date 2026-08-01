import { describe, expect, it } from "vitest";
import { searchPreferencesSchema } from "../../src/domain/entities.js";
import { QasaHousingProvider } from "../../src/integrations/housing/qasa-housing-provider.js";
import {
  buildQasaSearchPrompt,
  buildQasaWebSearchTool,
  keepGroundedQasaListings,
  type QasaListingSearch,
  type QasaSearchListing,
} from "../../src/integrations/housing/qasa-web-search-client.js";
import type { HousingSearchInput } from "../../src/integrations/housing/housing-provider.js";
import { buildEnvForTest } from "../../src/config/env.js";

const preferences = searchPreferencesSchema.parse({
  city: "Uppsala",
  maximumMonthlyRent: 9_000,
  minimumRooms: 1,
  minimumSizeSquareMeters: 20,
});

const valid: QasaSearchListing = {
  sourceListingId: null,
  title: "Studentlägenhet nära centrum",
  description: "Ljus etta med cykelavstånd till universitetet.",
  address: "Exempelgatan 1",
  city: "Uppsala",
  area: "Luthagen",
  rentSek: 7_900,
  rooms: 1,
  sizeSqm: 28,
  availableFrom: "2026-09-01",
  availableUntil: null,
  furnished: true,
  studentSuitable: true,
  url: "https://qasa.com/se/sv/home/1423905?utm_source=search#details",
  imageUrl: "https://img.qasa.se/example.jpg",
  active: true,
};

class FakeSearch implements QasaListingSearch {
  lastInput: (HousingSearchInput & { limit: number }) | null = null;

  constructor(private readonly results: QasaSearchListing[]) {}

  async search(input: HousingSearchInput & { limit: number }): Promise<QasaSearchListing[]> {
    this.lastInput = input;
    return this.results;
  }
}

describe("Qasa web search configuration", () => {
  it("requires an Anthropic key when Qasa discovery is enabled", () => {
    expect(() =>
      buildEnvForTest({
        NODE_ENV: "test",
        HOUSING_PROVIDER: "qasa",
        LLM_PROVIDER: "mock",
        ANTHROPIC_API_KEY: "",
        LLM_API_KEY: "",
      }),
    ).toThrow(/requires LLM_API_KEY/);

    const configured = buildEnvForTest({
      NODE_ENV: "test",
      HOUSING_PROVIDER: "qasa",
      ANTHROPIC_API_KEY: "test-key",
      CLAUDE_MODEL: "test-economical-model",
    });
    expect(configured.llmApiKey).toBe("test-key");
    expect(configured.claudeModel).toBe("test-economical-model");
  });

  it("enforces qasa.com as the only search domain", () => {
    const tool = buildQasaWebSearchTool(4, "Uppsala");

    expect(tool.type).toBe("web_search_20250305");
    expect(tool.allowed_domains).toEqual(["qasa.com"]);
    expect(tool.blocked_domains).toBeUndefined();
    expect(tool.allowed_callers).toEqual(["direct"]);
    expect(tool.max_uses).toBe(4);
    expect(tool.user_location).toMatchObject({ city: "Uppsala", country: "SE" });
  });

  it("includes the deterministic search preferences without requesting personal data", () => {
    const prompt = buildQasaSearchPrompt({ preferences, campus: null, limit: 12 });

    expect(prompt).toContain("City: Uppsala");
    expect(prompt).toContain("Maximum monthly rent: 9000 SEK");
    expect(prompt).toContain("Minimum size: 20 square metres");
    expect(prompt).toContain("Do not collect or return landlord names");
  });

  it("accepts only listings grounded in URLs returned by the same web search", () => {
    const grounded = keepGroundedQasaListings(
      [valid, { ...valid, url: "https://qasa.com/se/sv/home/9999999" }],
      ["https://www.qasa.com/se/en/home/1423905?source=search", "https://qasa.com/se/sv/find-home"],
    );

    expect(grounded).toEqual([valid]);
  });
});

describe("QasaHousingProvider", () => {
  it("normalises grounded results and always hands contact back to Qasa", async () => {
    const search = new FakeSearch([valid]);
    const provider = new QasaHousingProvider(search);

    const result = await provider.search({ preferences, campus: null, limit: 6 });

    expect(search.lastInput?.limit).toBe(6);
    expect(result.provider).toBe("qasa");
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]).toMatchObject({
      id: "qasa-1423905",
      provider: "qasa",
      providerListingId: "1423905",
      canonicalUrl: "https://qasa.com/se/sv/home/1423905",
      monthlyRent: 7_900,
      currency: "SEK",
      rooms: 1,
      sizeSquareMeters: 28,
      imageUrls: ["https://img.qasa.se/example.jpg"],
      contactCapability: "manual_handoff",
    });

    const listing = result.listings[0];
    expect(listing).toBeDefined();
    if (!listing) return;
    expect(await provider.getListing(listing.id)).toEqual(listing);
    expect(await provider.getContactCapability(listing)).toEqual({
      capability: "manual_handoff",
      manualUrl: "https://qasa.com/se/sv/home/1423905",
      note: "Continue on Qasa to contact the landlord.",
    });
  });

  it("rejects inactive, incomplete, negative, and non-Qasa results", async () => {
    const provider = new QasaHousingProvider(
      new FakeSearch([
        { ...valid, active: false },
        { ...valid, url: "https://example.com/home/1423905" },
        { ...valid, url: "https://qasa.com/se/sv/find-home" },
        { ...valid, rentSek: null },
        { ...valid, rooms: -1 },
        { ...valid, city: null },
      ]),
    );

    const result = await provider.search({ preferences, campus: null });
    expect(result.listings).toEqual([]);
  });

  it("deduplicates repeated search hits by the listing id in the canonical URL", async () => {
    const provider = new QasaHousingProvider(
      new FakeSearch([
        valid,
        { ...valid, title: "Richer title", url: "https://www.qasa.com/se/en/home/1423905" },
      ]),
    );

    const result = await provider.search({ preferences, campus: null });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.title).toBe("Richer title");
  });
});
