import type { Language } from "../../domain/entities.js";
import { detectLanguageHeuristic, parseCommand } from "../../domain/command-parser.js";
import { parseHumanDate, toIsoDate } from "../../utils/dates.js";
import {
  extractedPreferencesSchema,
  type ExtractedPreferences,
  type LlmProvider,
  type UniversityGuess,
} from "./llm-provider.js";

/**
 * Deterministic stand-in for a real model. Every demo flow works with this, so
 * the app is fully testable with no LLM credentials.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";

  async detectLanguage(text: string): Promise<Language> {
    return detectLanguageHeuristic(text);
  }

  async extractPreferences(text: string, _context: { language: Language }): Promise<ExtractedPreferences> {
    const now = new Date();
    const result = extractedPreferencesSchema.parse({});
    const lower = text.toLowerCase();

    // Reuse the deterministic parser so mock and production paths agree.
    const command = parseCommand(text, now);
    if (command.kind === "change_preference") {
      switch (command.field) {
        case "maximumMonthlyRent":
          result.maximumMonthlyRent = command.value as number;
          break;
        case "maxCommuteMinutes":
          result.maxCommuteMinutes = command.value as number;
          break;
        case "minimumRentalMonths":
          result.minimumRentalMonths = command.value as number;
          break;
        case "minimumRooms":
          result.minimumRooms = command.value as number;
          break;
        case "minimumSizeSquareMeters":
          result.minimumSizeSquareMeters = command.value as number;
          break;
        case "furnishedPreference":
          result.furnishedPreference = command.value as ExtractedPreferences["furnishedPreference"];
          break;
        case "preferredMoveInDate":
          result.preferredMoveInDate = command.value as string;
          break;
      }
    }

    if (result.maximumMonthlyRent === null) {
      const bare = lower.match(/\b(\d[\d\s.,]{2,})\s*(?:sek|kr|kronor)?\b/);
      if (bare?.[1]) {
        const value = Number(bare[1].replace(/[^\d]/g, ""));
        if (value >= 1000 && value <= 60000) result.maximumMonthlyRent = value;
      }
    }
    if (result.preferredMoveInDate === null) {
      const date = parseHumanDate(text, now);
      if (date) result.preferredMoveInDate = toIsoDate(date);
    }
    if (/\bpets?\b|\bhund\b|\bkatt\b/.test(lower)) result.preferredAmenities.push("pets allowed");
    if (/\bbalcon(y|ies)\b|\bbalkong\b/.test(lower)) result.preferredAmenities.push("balcony");
    if (/\blaundry\b|\btvätt\b|\btvatt\b/.test(lower)) result.preferredAmenities.push("laundry");
    if (/\bwifi\b|\binternet\b/.test(lower)) result.preferredAmenities.push("wifi");

    return result;
  }

  async guessUniversity(text: string): Promise<UniversityGuess> {
    const match = text.match(/\b(?:at|to|på|pa|vid)\s+([A-ZÅÄÖ][\wåäöÅÄÖ]*(?:\s+[A-ZÅÄÖ][\w åäöÅÄÖ]*){0,3})/);
    if (match?.[1]) return { universityName: match[1].trim(), confidence: 0.6 };
    return { universityName: null, confidence: 0 };
  }

  async writeReply(input: { intent: string; facts: string[]; language: Language }): Promise<string> {
    return input.facts.join("\n");
  }

  async draftLandlordMessage(input: {
    applicantName: string;
    university: string;
    address: string;
    moveInDate: string;
    durationMonths: number;
    phone: string;
    email: string;
    language: Language;
  }): Promise<string> {
    return buildLandlordMessage(input);
  }
}

/**
 * Deterministic template. Contains only facts the user supplied — never income,
 * employment, references or any other invented background.
 */
export function buildLandlordMessage(input: {
  applicantName: string;
  university: string;
  address: string;
  moveInDate: string;
  durationMonths: number;
  phone: string;
  email: string;
  language: Language;
}): string {
  if (input.language === "sv") {
    return [
      "Hej,",
      "",
      `Jag heter ${input.applicantName} och har blivit antagen till ${input.university}. Jag är intresserad av lägenheten på ${input.address}.`,
      "",
      `Jag hoppas kunna flytta in omkring ${input.moveInDate} och vill hyra i cirka ${input.durationMonths} månader.`,
      "",
      "Hör gärna av dig om lägenheten fortfarande är ledig och om du behöver mer information från mig.",
      "",
      "Du når mig på:",
      input.phone,
      input.email,
      "",
      "Vänliga hälsningar,",
      input.applicantName,
    ].join("\n");
  }

  return [
    "Hello,",
    "",
    `My name is ${input.applicantName} and I have recently been accepted to ${input.university}. I am interested in the apartment at ${input.address}.`,
    "",
    `I am hoping to move in around ${input.moveInDate} and would like to rent for approximately ${input.durationMonths} months.`,
    "",
    "Please let me know if the apartment is still available and if you need any additional information from me.",
    "",
    "You can reach me at:",
    input.phone,
    input.email,
    "",
    "Kind regards,",
    input.applicantName,
  ].join("\n");
}
