import type { Repositories } from "../database/repositories/index.js";
import type { HousingProvider } from "../integrations/housing/housing-provider.js";
import type { UniversityProvider } from "../integrations/university/university-provider.js";
import type { Campus, RankedListing, SearchPreferences } from "../domain/entities.js";
import { rankListings } from "../domain/ranking.js";
import { logger } from "../utils/logger.js";

export interface SearchInput {
  userId: string;
  preferences: SearchPreferences;
  universityId: string | null;
  campusId: string | null;
  /** How many listings to return in this batch. */
  limit?: number;
}

export interface SearchOutput {
  searchRunId: string;
  ranked: RankedListing[];
  campus: Campus | null;
  totalCandidates: number;
}

export const BATCH_SIZE = 3;

export class SearchService {
  constructor(
    private readonly repos: Repositories,
    private readonly housing: HousingProvider,
    private readonly universities: UniversityProvider,
  ) {}

  private resolveCampus(universityId: string | null, campusId: string | null): Campus | null {
    if (!universityId) return null;
    const university = this.universities.getById(universityId);
    if (!university) return null;
    if (campusId) {
      const campus = university.campuses.find((c) => c.id === campusId);
      if (campus) return campus;
    }
    return university.campuses[0] ?? null;
  }

  /**
   * Search, filter, deduplicate, score and persist. Listings the user has already
   * decided on are excluded, so repeated batches never repeat an apartment.
   */
  async run(input: SearchInput): Promise<SearchOutput> {
    const profile = await this.repos.searchProfiles.upsert(input.userId, input.preferences);
    const searchRunId = await this.repos.searchRuns.create(input.userId, profile.id, this.housing.name);

    try {
      const campus = this.resolveCampus(input.universityId, input.campusId);
      const providerResult = await this.housing.search({ preferences: input.preferences, campus });

      // Persist raw listings first so a link opened later still resolves.
      await this.repos.listings.upsertMany(providerResult.listings);

      const excludedListingIds = await this.repos.decisions.excludedListingIds(input.userId);
      const ranked = rankListings(providerResult.listings, {
        preferences: input.preferences,
        campus,
        excludedListingIds,
        now: new Date(),
      });

      const selected = ranked.slice(0, input.limit ?? BATCH_SIZE);
      await this.repos.searchRuns.saveResults(
        searchRunId,
        ranked.map((entry, index) => ({
          listingId: entry.listing.id,
          score: entry.score,
          breakdown: { ...entry.breakdown, reasons: entry.reasons },
          position: index + 1,
        })),
      );
      await this.repos.searchRuns.complete(searchRunId, ranked.length);

      logger.info(
        {
          userId: input.userId,
          provider: this.housing.name,
          candidates: providerResult.listings.length,
          eligible: ranked.length,
          selected: selected.length,
        },
        "search completed",
      );

      return { searchRunId, ranked: selected, campus, totalCandidates: ranked.length };
    } catch (error) {
      await this.repos.searchRuns.fail(searchRunId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
