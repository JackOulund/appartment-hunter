import { z } from "zod";
import type { Language, SearchPreferences } from "../../domain/entities.js";
import { furnishedPreferenceSchema } from "../../domain/entities.js";

/**
 * Everything the LLM returns is validated with these schemas before it reaches
 * the rest of the app. The LLM never decides state transitions, scores, consent
 * or whether an application may be sent.
 */

export const extractedPreferencesSchema = z.object({
  maximumMonthlyRent: z.number().int().positive().nullable().default(null),
  preferredMoveInDate: z.string().nullable().default(null),
  minimumRentalMonths: z.number().int().positive().nullable().default(null),
  maxCommuteMinutes: z.number().int().positive().nullable().default(null),
  minimumRooms: z.number().positive().nullable().default(null),
  minimumSizeSquareMeters: z.number().int().positive().nullable().default(null),
  furnishedPreference: furnishedPreferenceSchema.nullable().default(null),
  preferredAreas: z.array(z.string()).default([]),
  excludedAreas: z.array(z.string()).default([]),
  requiredAmenities: z.array(z.string()).default([]),
  preferredAmenities: z.array(z.string()).default([]),
  freeTextPreferences: z.string().nullable().default(null),
});
export type ExtractedPreferences = z.infer<typeof extractedPreferencesSchema>;

export const universityGuessSchema = z.object({
  universityName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type UniversityGuess = z.infer<typeof universityGuessSchema>;

export interface LlmProvider {
  readonly name: string;
  detectLanguage(text: string): Promise<Language>;
  extractPreferences(text: string, context: { language: Language }): Promise<ExtractedPreferences>;
  guessUniversity(text: string): Promise<UniversityGuess>;
  /** Rewrites already-computed facts conversationally. Must not invent new facts. */
  writeReply(input: {
    intent: string;
    facts: string[];
    language: Language;
  }): Promise<string>;
  draftLandlordMessage(input: {
    applicantName: string;
    university: string;
    address: string;
    moveInDate: string;
    durationMonths: number;
    phone: string;
    email: string;
    language: Language;
  }): Promise<string>;
}

/**
 * Listing text and any other third-party content is untrusted. Wrapping it makes
 * the boundary explicit and strips the delimiters an injection would rely on.
 */
export function sanitiseUntrusted(text: string, maxLength = 1200): string {
  return text
    .replace(/[<>]/g, " ")
    .replace(/\b(system|assistant|user)\s*:/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
