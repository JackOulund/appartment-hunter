import { z } from "zod";

export const furnishedPreferenceSchema = z.enum(["furnished", "unfurnished", "no_preference"]);
export type FurnishedPreference = z.infer<typeof furnishedPreferenceSchema>;

export const commuteModeSchema = z.enum(["walk", "bicycle", "transit", "car"]);
export type CommuteMode = z.infer<typeof commuteModeSchema>;

export const listingDecisionSchema = z.enum([
  "unseen",
  "liked",
  "rejected",
  "shortlisted",
  "contact_requested",
  "contacted",
  "unavailable",
]);
export type ListingDecisionValue = z.infer<typeof listingDecisionSchema>;

export const contactCapabilitySchema = z.enum([
  "provider_api",
  "email",
  "linq_message",
  "authenticated_platform",
  "manual_handoff",
]);
export type ContactCapability = z.infer<typeof contactCapabilitySchema>;

export const applicationStatusSchema = z.enum([
  "draft",
  "awaiting_confirmation",
  "confirmed",
  "sending",
  "sent",
  "failed",
  "cancelled",
  "manual_handoff",
]);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const languageSchema = z.enum(["en", "sv"]);
export type Language = z.infer<typeof languageSchema>;

export const searchPreferencesSchema = z.object({
  city: z.string().nullable().default(null),
  preferredAreas: z.array(z.string()).default([]),
  excludedAreas: z.array(z.string()).default([]),
  maximumMonthlyRent: z.number().int().positive().nullable().default(null),
  currency: z.string().default("SEK"),
  preferredMoveInDate: z.string().nullable().default(null),
  minimumRentalMonths: z.number().int().positive().nullable().default(null),
  minimumRooms: z.number().positive().nullable().default(null),
  minimumSizeSquareMeters: z.number().int().positive().nullable().default(null),
  furnishedPreference: furnishedPreferenceSchema.default("no_preference"),
  maxCommuteMinutes: z.number().int().positive().nullable().default(null),
  commuteModes: z.array(commuteModeSchema).default(["bicycle"]),
  requiredAmenities: z.array(z.string()).default([]),
  preferredAmenities: z.array(z.string()).default([]),
  freeTextPreferences: z.string().nullable().default(null),
});
export type SearchPreferences = z.infer<typeof searchPreferencesSchema>;

export const REQUIRED_PREFERENCE_FIELDS = [
  "maximumMonthlyRent",
  "preferredMoveInDate",
  "minimumRentalMonths",
  "maxCommuteMinutes",
  "minimumRooms",
  "furnishedPreference",
] as const;
export type RequiredPreferenceField = (typeof REQUIRED_PREFERENCE_FIELDS)[number];

/** Drives the onboarding questionnaire — the first missing field is asked next. */
export function missingRequiredFields(
  preferences: Partial<SearchPreferences>,
): RequiredPreferenceField[] {
  return REQUIRED_PREFERENCE_FIELDS.filter((field) => {
    const value = preferences[field];
    if (field === "furnishedPreference") return value === undefined || value === null;
    return value === undefined || value === null;
  });
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Campus {
  id: string;
  name: string;
  address: string;
  coordinates: Coordinates;
}

export interface University {
  id: string;
  officialName: string;
  aliases: string[];
  city: string;
  campuses: Campus[];
}

export interface HousingListing {
  id: string;
  provider: string;
  providerListingId: string;
  canonicalUrl: string | null;
  title: string;
  description: string | null;
  address: string | null;
  city: string;
  area: string | null;
  latitude: number | null;
  longitude: number | null;
  monthlyRent: number;
  currency: string;
  rooms: number | null;
  sizeSquareMeters: number | null;
  furnished: boolean | null;
  availableFrom: string | null;
  availableTo: string | null;
  minimumRentalMonths: number | null;
  amenities: string[];
  imageUrls: string[];
  contactCapability: ContactCapability;
  providerMetadata: Record<string, unknown>;
  isActive: boolean;
}

export interface ScoreReason {
  /** Stable machine-readable key so tests assert on facts, not on prose. */
  code: string;
  label: string;
}

export interface ScoreBreakdown {
  commute: number;
  budget: number;
  moveIn: number;
  duration: number;
  size: number;
  amenities: number;
  freshness: number;
}

export interface RankedListing {
  listing: HousingListing;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: ScoreReason[];
  commuteMinutes: number | null;
  commuteMode: CommuteMode | null;
}
