import type {
  Campus,
  CommuteMode,
  Coordinates,
  HousingListing,
  RankedListing,
  ScoreBreakdown,
  ScoreReason,
  SearchPreferences,
} from "./entities.js";
import { daysBetween, parseIsoDate } from "../utils/dates.js";

export const SCORE_WEIGHTS = {
  commute: 30,
  budget: 25,
  moveIn: 15,
  duration: 10,
  size: 10,
  amenities: 5,
  freshness: 5,
} as const;

export const MAX_SCORE = 100;

/** Average speeds used to turn distance into a commute estimate. */
const SPEED_KMH: Record<CommuteMode, number> = {
  walk: 4.8,
  bicycle: 15,
  transit: 20,
  car: 30,
};

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export interface CommuteEstimate {
  minutes: number;
  mode: CommuteMode;
  distanceKm: number;
}

export function estimateCommute(
  listing: HousingListing,
  campus: Campus,
  modes: CommuteMode[],
): CommuteEstimate | null {
  if (listing.latitude === null || listing.longitude === null) return null;
  const distanceKm = haversineKm(
    { latitude: listing.latitude, longitude: listing.longitude },
    campus.coordinates,
  );
  // Street distance is longer than crow-flies; 1.25 is a conventional detour factor.
  const routedKm = distanceKm * 1.25;
  const candidates = modes.length > 0 ? modes : (["bicycle"] as CommuteMode[]);

  let best: CommuteEstimate | null = null;
  for (const mode of candidates) {
    const minutes = Math.max(1, Math.round((routedKm / SPEED_KMH[mode]) * 60));
    if (!best || minutes < best.minutes) best = { minutes, mode, distanceKm: routedKm };
  }
  return best;
}

export interface FilterContext {
  preferences: SearchPreferences;
  campus: Campus | null;
  /** Listings the user already rejected or already saw. */
  excludedListingIds: Set<string>;
  now: Date;
  /** Hard cap on distance from campus when the user gave no commute limit. */
  maxRadiusKm?: number;
}

export interface FilterOutcome {
  passed: boolean;
  reason?: string;
}

const DEFAULT_RADIUS_KM = 25;

export function applyHardFilters(listing: HousingListing, context: FilterContext): FilterOutcome {
  const { preferences, campus, now } = context;

  if (!listing.isActive) return { passed: false, reason: "listing_inactive" };
  if (context.excludedListingIds.has(listing.id)) return { passed: false, reason: "already_decided" };

  if (preferences.maximumMonthlyRent !== null && listing.monthlyRent > preferences.maximumMonthlyRent) {
    return { passed: false, reason: "over_budget" };
  }

  if (preferences.city && listing.city.toLowerCase() !== preferences.city.toLowerCase()) {
    // A different city is only acceptable if it is still within campus radius.
    if (!campus || listing.latitude === null || listing.longitude === null) {
      return { passed: false, reason: "wrong_city" };
    }
    const distance = haversineKm(
      { latitude: listing.latitude, longitude: listing.longitude },
      campus.coordinates,
    );
    if (distance > (context.maxRadiusKm ?? DEFAULT_RADIUS_KM)) {
      return { passed: false, reason: "outside_radius" };
    }
  }

  const excluded = preferences.excludedAreas.map((a) => a.toLowerCase());
  if (listing.area && excluded.includes(listing.area.toLowerCase())) {
    return { passed: false, reason: "excluded_area" };
  }

  const preferredMoveIn = parseIsoDate(preferences.preferredMoveInDate);
  const availableFrom = parseIsoDate(listing.availableFrom);
  if (preferredMoveIn && availableFrom) {
    // Available more than 45 days after the target date is not a usable match.
    if (daysBetween(preferredMoveIn, availableFrom) > 45) {
      return { passed: false, reason: "available_too_late" };
    }
  }
  const availableTo = parseIsoDate(listing.availableTo);
  if (availableTo && availableTo.getTime() < now.getTime()) {
    return { passed: false, reason: "listing_expired" };
  }

  if (preferences.minimumRentalMonths !== null && listing.minimumRentalMonths !== null) {
    // A listing that forces a *longer* commitment than the user wants is fine;
    // one that only offers a shorter stay is not.
    if (availableFrom && availableTo) {
      const offeredMonths = Math.round(daysBetween(availableFrom, availableTo) / 30.44);
      if (offeredMonths < preferences.minimumRentalMonths) {
        return { passed: false, reason: "rental_period_too_short" };
      }
    }
  }

  if (preferences.minimumRooms !== null && listing.rooms !== null && listing.rooms < preferences.minimumRooms) {
    return { passed: false, reason: "too_few_rooms" };
  }
  if (
    preferences.minimumSizeSquareMeters !== null &&
    listing.sizeSquareMeters !== null &&
    listing.sizeSquareMeters < preferences.minimumSizeSquareMeters
  ) {
    return { passed: false, reason: "too_small" };
  }

  const amenities = listing.amenities.map((a) => a.toLowerCase());
  for (const required of preferences.requiredAmenities) {
    if (!amenities.includes(required.toLowerCase())) {
      return { passed: false, reason: `missing_amenity:${required}` };
    }
  }

  if (preferences.maxCommuteMinutes !== null && campus) {
    const commute = estimateCommute(listing, campus, preferences.commuteModes);
    if (commute && commute.minutes > preferences.maxCommuteMinutes) {
      return { passed: false, reason: "commute_too_long" };
    }
  }

  return { passed: true };
}

const MODE_LABEL: Record<CommuteMode, string> = {
  walk: "on foot",
  bicycle: "by bicycle",
  transit: "by public transport",
  car: "by car",
};

export function scoreListing(
  listing: HousingListing,
  context: FilterContext,
): RankedListing {
  const { preferences, campus } = context;
  const reasons: ScoreReason[] = [];
  const commute = campus ? estimateCommute(listing, campus, preferences.commuteModes) : null;

  // Commute — full marks at or below half the limit, zero at double it.
  let commuteScore = SCORE_WEIGHTS.commute * 0.5;
  if (commute) {
    const limit = preferences.maxCommuteMinutes ?? 30;
    const ratio = commute.minutes / limit;
    commuteScore =
      ratio <= 0.5 ? SCORE_WEIGHTS.commute
      : ratio >= 2 ? 0
      : SCORE_WEIGHTS.commute * (1 - (ratio - 0.5) / 1.5);
    reasons.push({
      code: "commute",
      label: `${commute.minutes} minutes ${MODE_LABEL[commute.mode]} to campus`,
    });
  }

  // Budget — full marks at 15% or more below budget.
  let budgetScore = SCORE_WEIGHTS.budget * 0.5;
  if (preferences.maximumMonthlyRent !== null) {
    const headroom = preferences.maximumMonthlyRent - listing.monthlyRent;
    const ratio = headroom / preferences.maximumMonthlyRent;
    budgetScore =
      ratio >= 0.15 ? SCORE_WEIGHTS.budget
      : ratio <= 0 ? 0
      : SCORE_WEIGHTS.budget * (ratio / 0.15);
    if (headroom > 0) {
      reasons.push({
        code: "budget",
        label: `${headroom.toLocaleString("en-GB")} ${listing.currency} below your budget`,
      });
    }
  }

  // Move-in — full marks for available on or shortly before the target date.
  let moveInScore = SCORE_WEIGHTS.moveIn * 0.5;
  const preferredMoveIn = parseIsoDate(preferences.preferredMoveInDate);
  const availableFrom = parseIsoDate(listing.availableFrom);
  if (preferredMoveIn && availableFrom) {
    const drift = daysBetween(preferredMoveIn, availableFrom);
    moveInScore =
      drift <= 0 && drift >= -30 ? SCORE_WEIGHTS.moveIn
      : drift > 0 ? Math.max(0, SCORE_WEIGHTS.moveIn * (1 - drift / 45))
      : SCORE_WEIGHTS.moveIn * 0.6;
    if (drift === 0) {
      reasons.push({ code: "move_in", label: "Available exactly on your move-in date" });
    } else if (drift < 0) {
      reasons.push({ code: "move_in", label: `Available ${Math.abs(drift)} days before your move-in date` });
    } else {
      reasons.push({ code: "move_in", label: `Available ${drift} days after your move-in date` });
    }
  }

  // Rental duration.
  let durationScore = SCORE_WEIGHTS.duration * 0.5;
  if (preferences.minimumRentalMonths !== null && availableFrom) {
    const availableTo = parseIsoDate(listing.availableTo);
    if (availableTo) {
      const offered = Math.round(daysBetween(availableFrom, availableTo) / 30.44);
      durationScore =
        offered >= preferences.minimumRentalMonths ? SCORE_WEIGHTS.duration : 0;
      if (offered >= preferences.minimumRentalMonths) {
        reasons.push({ code: "duration", label: `Available for about ${offered} months` });
      }
    } else {
      durationScore = SCORE_WEIGHTS.duration; // open-ended contract
      reasons.push({ code: "duration", label: "No fixed end date" });
    }
  }

  // Rooms and size.
  let sizeScore = SCORE_WEIGHTS.size * 0.5;
  if (preferences.minimumRooms !== null && listing.rooms !== null) {
    sizeScore =
      listing.rooms >= preferences.minimumRooms + 1 ? SCORE_WEIGHTS.size
      : listing.rooms >= preferences.minimumRooms ? SCORE_WEIGHTS.size * 0.8
      : 0;
  }
  if (listing.sizeSquareMeters !== null && preferences.minimumSizeSquareMeters !== null) {
    sizeScore =
      listing.sizeSquareMeters >= preferences.minimumSizeSquareMeters
        ? Math.max(sizeScore, SCORE_WEIGHTS.size * 0.8)
        : 0;
  }

  // Amenities, including the furnished preference.
  const listingAmenities = listing.amenities.map((a) => a.toLowerCase());
  const preferredHits = preferences.preferredAmenities.filter((a) =>
    listingAmenities.includes(a.toLowerCase()),
  );
  let amenityScore =
    preferences.preferredAmenities.length === 0
      ? SCORE_WEIGHTS.amenities * 0.6
      : SCORE_WEIGHTS.amenities * (preferredHits.length / preferences.preferredAmenities.length);

  if (preferences.furnishedPreference !== "no_preference" && listing.furnished !== null) {
    const wantsFurnished = preferences.furnishedPreference === "furnished";
    if (listing.furnished === wantsFurnished) {
      amenityScore = SCORE_WEIGHTS.amenities;
      reasons.push({
        code: "furnished",
        label: wantsFurnished ? "Furnished as requested" : "Unfurnished as requested",
      });
    } else {
      amenityScore = Math.min(amenityScore, SCORE_WEIGHTS.amenities * 0.3);
    }
  }
  if (preferredHits.length > 0) {
    reasons.push({ code: "amenities", label: `Includes ${preferredHits.join(", ")}` });
  }

  // Freshness and data confidence.
  const knownFields = [
    listing.description,
    listing.address,
    listing.rooms,
    listing.sizeSquareMeters,
    listing.availableFrom,
    listing.latitude,
  ].filter((v) => v !== null && v !== undefined && v !== "").length;
  const freshnessScore = SCORE_WEIGHTS.freshness * (knownFields / 6);

  const breakdown: ScoreBreakdown = {
    commute: round(commuteScore),
    budget: round(budgetScore),
    moveIn: round(moveInScore),
    duration: round(durationScore),
    size: round(sizeScore),
    amenities: round(amenityScore),
    freshness: round(freshnessScore),
  };

  const score = round(
    breakdown.commute +
      breakdown.budget +
      breakdown.moveIn +
      breakdown.duration +
      breakdown.size +
      breakdown.amenities +
      breakdown.freshness,
  );

  return {
    listing,
    score,
    breakdown,
    reasons,
    commuteMinutes: commute?.minutes ?? null,
    commuteMode: commute?.mode ?? null,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Two listings from different providers at the same address and rent are the
 * same flat; keep the one with the richer record.
 */
export function deduplicateListings(listings: HousingListing[]): HousingListing[] {
  const byKey = new Map<string, HousingListing>();
  for (const listing of listings) {
    const key = [
      listing.city.toLowerCase(),
      (listing.address ?? listing.title).toLowerCase().replace(/\s+/g, " ").trim(),
      listing.monthlyRent,
      listing.rooms ?? "?",
    ].join("|");

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, listing);
      continue;
    }
    if (completeness(listing) > completeness(existing)) byKey.set(key, listing);
  }
  return [...byKey.values()];
}

function completeness(listing: HousingListing): number {
  return [
    listing.description,
    listing.address,
    listing.area,
    listing.rooms,
    listing.sizeSquareMeters,
    listing.availableFrom,
    listing.availableTo,
    listing.latitude,
    listing.canonicalUrl,
  ].filter((v) => v !== null && v !== undefined && v !== "").length + listing.imageUrls.length;
}

export interface RankOptions {
  limit?: number;
}

export function rankListings(
  listings: HousingListing[],
  context: FilterContext,
  options: RankOptions = {},
): RankedListing[] {
  const eligible = deduplicateListings(listings).filter(
    (listing) => applyHardFilters(listing, context).passed,
  );

  const ranked = eligible.map((listing) => scoreListing(listing, context));

  // Sort is fully deterministic: score, then rent, then id as the final tiebreak.
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.listing.monthlyRent !== b.listing.monthlyRent) {
      return a.listing.monthlyRent - b.listing.monthlyRent;
    }
    return a.listing.id.localeCompare(b.listing.id);
  });

  return options.limit ? ranked.slice(0, options.limit) : ranked;
}
