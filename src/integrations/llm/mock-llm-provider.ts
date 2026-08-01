import type { Language } from "../../domain/entities.js";
import { detectLanguageHeuristic, parseCommand } from "../../domain/command-parser.js";
import { parseHumanDate, toIsoDate } from "../../utils/dates.js";
import {
  extractedPreferencesSchema,
  type ExtractedPreferences,
  type LlmProvider,
  type TurnContext,
  type UniversityGuess,
} from "./llm-provider.js";
import { turnDecisionSchema, type TurnDecision } from "./turn-schema.js";

const ORDINAL_TO_POSITION: Record<string, number> = {
  first: 1, "1st": 1, one: 1, ett: 1, en: 1,
  second: 2, "2nd": 2, two: 2, två: 2, tva: 2,
  third: 3, "3rd": 3, three: 3, tre: 3,
};

const ANY_ORDINAL = /(first|second|third|1st|2nd|3rd|one|two|three)/i;
const REJECT_ORDINAL_FIRST =
  /(first|second|third|1st|2nd|3rd|one|two|three).*(not for me|don't like|dont like|nah|inte)/i;
const REJECT_NEGATIVE_FIRST = /(not for me|don't like).*(first|second|third)/i;
const POSITIVE_SENTIMENT = /(love|like|great|keep|nice)/i;
const MORE_REQUEST = /(more|show me|go on)/i;
const BUDGET_WITH_KEYWORD = /(\d[\d\s,.]*k?)\s*(?:max|tops|budget|max rent)/i;
const LETS_SAY_AMOUNT = /let'?s say\s+(\d[\d\s,.]*k?)/i;
const CONTACT_KEYWORD = /contact/i;

function resolveOrdinalPosition(word: string | undefined): number | null {
  if (!word) return null;
  return ORDINAL_TO_POSITION[word.toLowerCase()] ?? null;
}

/** "8 000", "8,000", "8k" and "8000" all mean the same thing. */
function parseMockAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s,.](?=\d{3}\b)/g, "").replace(/\s/g, "");
  const kMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)k$/i);
  if (kMatch?.[1]) return Math.round(Number(kMatch[1].replace(",", ".")) * 1000);
  const value = Number(cleaned.replace(/[^\d]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function matchReject(text: string): number | null {
  const ordinalFirst = REJECT_ORDINAL_FIRST.exec(text);
  if (ordinalFirst) {
    const position = resolveOrdinalPosition(ordinalFirst[1]);
    if (position !== null) return position;
  }
  const negativeFirst = REJECT_NEGATIVE_FIRST.exec(text);
  if (negativeFirst) {
    const position = resolveOrdinalPosition(negativeFirst[2]);
    if (position !== null) return position;
  }
  return null;
}

function matchLike(text: string): number | null {
  if (!POSITIVE_SENTIMENT.test(text)) return null;
  const ordinal = ANY_ORDINAL.exec(text);
  return resolveOrdinalPosition(ordinal?.[1]);
}

function matchBudget(text: string): number | null {
  const withKeyword = BUDGET_WITH_KEYWORD.exec(text);
  if (withKeyword?.[1]) {
    const value = parseMockAmount(withKeyword[1]);
    if (value !== null) return value;
  }
  const letsSay = LETS_SAY_AMOUNT.exec(text);
  if (letsSay?.[1]) {
    const value = parseMockAmount(letsSay[1]);
    if (value !== null) return value;
  }
  return null;
}

function matchContact(text: string): number[] | null {
  if (!CONTACT_KEYWORD.test(text)) return null;
  const digits = text.match(/\d+/g);
  if (!digits) return null;
  const positions = [...new Set(digits.map(Number))]
    .filter((value) => value >= 1 && value <= 3)
    .sort((a, b) => a - b);
  return positions.length > 0 ? positions : null;
}

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

  /**
   * Deterministic keyword rules standing in for the real model, so the
   * integration suite runs offline. Every branch is parsed through
   * turnDecisionSchema so this can never drift from the shape the real
   * provider must also produce.
   */
  async decideTurn(context: TurnContext): Promise<TurnDecision> {
    const { text } = context;

    if (MORE_REQUEST.test(text)) {
      return turnDecisionSchema.parse({
        command: { kind: "more" },
        preferences: {},
        reply: null,
        confidence: 0.9,
      });
    }

    const rejectPosition = matchReject(text);
    if (rejectPosition !== null) {
      return turnDecisionSchema.parse({
        command: { kind: "reject", positions: [rejectPosition] },
        preferences: {},
        reply: null,
        confidence: 0.85,
      });
    }

    const likePosition = matchLike(text);
    if (likePosition !== null) {
      return turnDecisionSchema.parse({
        command: { kind: "like", positions: [likePosition] },
        preferences: {},
        reply: null,
        confidence: 0.8,
      });
    }

    const budget = matchBudget(text);
    if (budget !== null) {
      return turnDecisionSchema.parse({
        command: { kind: "change_preference", field: "maximumMonthlyRent", value: budget },
        preferences: {},
        reply: null,
        confidence: 0.85,
      });
    }

    const contactPositions = matchContact(text);
    if (contactPositions !== null) {
      return turnDecisionSchema.parse({
        command: { kind: "contact", positions: contactPositions },
        preferences: {},
        reply: null,
        confidence: 0.85,
      });
    }

    const preferences = await this.extractPreferences(text, { language: context.language });
    return turnDecisionSchema.parse({
      command: { kind: "chat" },
      preferences,
      reply: "Okay!",
      confidence: 0.5,
    });
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
